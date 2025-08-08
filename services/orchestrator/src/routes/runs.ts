import { Router } from "express";
import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import { validateCheckpoint } from "../validation/schemas";
import {
  RunMode,
  Run,
  Checkpoint,
  OrchestratorEvent,
  RunStatus
} from "../types";
import { createRepository, RunRepository } from "../repo";

const runEvents = new Map<string, EventEmitter>();
const repo: RunRepository = createRepository();

const router = Router();

router.post("/", async (req, res) => {
  const mode = (req.query.mode as RunMode) || "plan";

  if (mode === "plan") {
    const plan = { steps: ["validate", "schedule", "execute"] };
    return res.status(200).json({ mode, plan });
  }

  const id = nanoid(10);
  const now = new Date().toISOString();

  const owner = (req.header("x-actor-id") ?? req.query.owner) as string | undefined;

  let metadata: Record<string, unknown> | undefined;
  if (req.body && typeof req.body === "object" && req.body !== null && !Array.isArray(req.body)) {
    const maybeMeta = (req.body as any).metadata;
    if (maybeMeta && typeof maybeMeta === "object" && maybeMeta !== null && !Array.isArray(maybeMeta)) {
      metadata = maybeMeta as Record<string, unknown>;
    }
  }

  const run: Run = { id, mode, createdAt: now, status: "pending", owner, metadata };
  const events = new EventEmitter();

  // Keep EventEmitter in-process only
  runEvents.set(id, events);

  // Persist run via repository
  await repo.createRun(run);

  // Seed first checkpoint/event after a tiny delay.
  setTimeout(() => {
    // Use an async IIFE so we can await repo calls inside the timeout
    void (async () => {
      // Transition run to running and emit status event before sending first checkpoint
      run.status = "running" as RunStatus;
      try {
        await repo.setStatus(id, run.status);
      } catch (err) {
        // ignore persistence error for seeding; still emit local event
      }
      const statusEvent: OrchestratorEvent = { type: "status", data: { runId: id, status: run.status } };
      events.emit("event", statusEvent);

      const cp: Checkpoint = {
        id: nanoid(6),
        runId: id,
        ts: new Date().toISOString(),
        type: "started"
      };

      try {
        await repo.addCheckpoint(id, cp);
      } catch (err) {
        // ignore persistence error for seeding; still emit local event
      }

      const cpEvent: OrchestratorEvent = { type: "checkpoint", data: cp };
      events.emit("event", cpEvent);
    })();
  }, 10);

  return res.status(201).json({ runId: id });
});

router.get("/:runId/checkpoints", async (req, res) => {
  const { runId } = req.params;
  const run = await repo.getRun(runId);
  if (!run) return res.status(404).json({ error: "run not found" });

  const checkpoints = await repo.listCheckpoints(runId);
  return res.json({ runId, checkpoints });
});

 // POST /runs/:runId/checkpoints
 // Accepts a minimal semantic checkpoint payload { type: string, data?: any }
 // Server generates id, ts, runId and validates using validateCheckpoint().
 router.post("/:runId/checkpoints", async (req, res) => {
   const { runId } = req.params;
   const run = await repo.getRun(runId);
   if (!run) return res.status(404).json({ error: "run not found" });

   const body: unknown = req.body;

   // Basic structural validation: must be an object
   if (typeof body !== "object" || body === null || Array.isArray(body)) {
     return res.status(400).json({ error: "invalid checkpoint type" });
   }

   const maybeType = (body as any).type;
   if (typeof maybeType !== "string" || maybeType.trim() === "") {
     return res.status(400).json({ error: "invalid checkpoint type" });
   }

   const checkpoint: Checkpoint = {
     id: nanoid(6),
     runId,
     ts: new Date().toISOString(),
     type: maybeType.trim()
   };

   const maybeData = (body as any).data;
   if (typeof maybeData !== "undefined") {
     checkpoint.data = maybeData;
   }

   const validation = validateCheckpoint(checkpoint);
   if (!validation.valid) {
     return res.status(400).json({ error: "validation failed", details: validation.errors ?? [] });
   }

   await repo.addCheckpoint(runId, checkpoint);

   // Emit to in-process listeners if present
   const events = runEvents.get(runId);
   if (events) {
     events.emit("event", { type: "checkpoint", data: checkpoint } as OrchestratorEvent);
   }

   return res.status(201).json({ checkpointId: checkpoint.id });
 });

router.get("/:runId/events", async (req, res) => {
  const { runId } = req.params;
  const run = await repo.getRun(runId);
  if (!run) return res.status(404).end();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  // @ts-expect-error: flushHeaders exists when using compression/compatible middleware
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  // Ensure an EventEmitter exists for this run (in-process only)
  let events = runEvents.get(runId);
  if (!events) {
    events = new EventEmitter();
    runEvents.set(runId, events);
  }

  // send helper: include an SSE id line when the event is a checkpoint and an id is provided
  const send = (event: OrchestratorEvent, id?: string) => {
    if (event.type === "checkpoint" && typeof id === "string" && id !== "") {
      res.write(`id: ${id}\n`);
    }
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data ?? {})}\n\n`);
  };

  // Attach listener BEFORE sending hello/replays so we don't miss events emitted during replay.
  const onEvent = (e: OrchestratorEvent) => {
    if (e.type === "checkpoint") {
      const cp = e.data as Checkpoint;
      send(e, cp?.ts);
    } else {
      send(e);
    }
  };
  events.on("event", onEvent);

  const heartbeat = setInterval(() => {
    res.write(`: keep-alive ${Date.now()}\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    events.off("event", onEvent);
  });

  // Initial hello (wire format unchanged) - still sent first
  const helloEvent: OrchestratorEvent = { type: "hello", data: { runId } };
  send(helloEvent);

  //
  // Resume (Last-Event-ID) or replay logic
  //
  const lastEventIdRaw = String(req.header("Last-Event-ID") ?? "");
  let hasValidLastEventId = false;
  let lastEventDate: Date | null = null;

  if (lastEventIdRaw) {
    const parsed = new Date(lastEventIdRaw);
    if (parsed.toString() !== "Invalid Date") {
      hasValidLastEventId = true;
      lastEventDate = parsed;
    }
  }

  // Fetch persisted checkpoints for replay from repository
  const persistedCheckpoints = await repo.listCheckpoints(runId);

  if (hasValidLastEventId && lastEventDate) {
    // Replay all checkpoints with ts strictly greater than Last-Event-ID
    const toReplay = persistedCheckpoints.filter(cp => new Date(cp.ts) > lastEventDate);
    // Ensure ascending chronological order (checkpoints are appended chronologically)
    toReplay.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    for (const cp of toReplay) {
      send({ type: "checkpoint", data: cp }, cp.ts);
    }
  } else {
    // No valid Last-Event-ID -> use replay query param
    const rawReplay = String(req.query.replay ?? "");
    const parsed = Number.parseInt(rawReplay, 10);
    let replayN: number;
    if (Number.isNaN(parsed)) {
      replayN = 10; // default
    } else {
      replayN = Math.min(100, Math.max(0, parsed));
    }

    if (replayN > 0) {
      const start = Math.max(0, persistedCheckpoints.length - replayN);
      const toReplay = persistedCheckpoints.slice(start); // already in ascending order
      for (const cp of toReplay) {
        send({ type: "checkpoint", data: cp }, cp.ts);
      }
    }
  }
});

   // GET /runs/:runId -> return only the run object or 404
   router.get("/:runId", async (req, res) => {
     const { runId } = req.params;
     const state = await repo.getRun(runId);
     if (!state) return res.status(404).json({ error: "run not found" });
     return res.status(200).json({ run: state });
   });

   // DELETE /runs/:runId -> attempt to cancel the run with enforced transitions
   router.delete("/:runId", async (req, res) => {
     const { runId } = req.params;
     const run = await repo.getRun(runId);
     if (!run) return res.status(404).json({ error: "run not found" });
  
     const currentStatus: RunStatus = run.status;
  
     // Allowed transitions: pending|running -> canceled
     if (currentStatus === "pending" || currentStatus === "running") {
       // update persisted status
       await repo.setStatus(runId, "canceled");
       // update local object for event emission
       run.status = "canceled";
       const events = runEvents.get(runId);
       if (events) {
         const evt: OrchestratorEvent = { type: "status", data: { runId, status: run.status } };
         events.emit("event", evt);
       }
       return res.status(200).json({ ok: true, status: run.status });
     }
  
     // Disallowed transitions: already terminal (completed, failed, canceled)
     return res.status(409).json({
       error: "invalid status transition",
       from: currentStatus,
       to: "canceled"
     });
   });

export default router;