import { Router } from "express";
import { EventEmitter } from "events";
import { nanoid } from "nanoid";

type RunMode = "plan" | "redis" | "k8s";

interface Run {
  id: string;
  mode: RunMode;
  createdAt: string;
}

interface Checkpoint {
  id: string;
  runId: string;
  ts: string;
  type: string;
  data?: unknown;
}

const runs = new Map<string, { run: Run; checkpoints: Checkpoint[]; events: EventEmitter }>();

const router = Router();

router.post("/", (req, res) => {
  const mode = (req.query.mode as RunMode) || "plan";

  if (mode === "plan") {
    const plan = { steps: ["validate", "schedule", "execute"] };
    return res.status(200).json({ mode, plan });
  }

  const id = nanoid(10);
  const now = new Date().toISOString();
  const run: Run = { id, mode, createdAt: now };
  const events = new EventEmitter();
  const checkpoints: Checkpoint[] = [];

  runs.set(id, { run, checkpoints, events });

  // Seed first checkpoint/event
  setTimeout(() => {
    const cp: Checkpoint = {
      id: nanoid(6),
      runId: id,
      ts: new Date().toISOString(),
      type: "started"
    };
    checkpoints.push(cp);
    events.emit("event", { type: "checkpoint", data: cp });
  }, 10);

  return res.status(201).json({ runId: id });
});

router.get("/:runId/checkpoints", (req, res) => {
  const { runId } = req.params;
  const state = runs.get(runId);
  if (!state) return res.status(404).json({ error: "run not found" });
  return res.json({ runId, checkpoints: state.checkpoints });
});

router.get("/:runId/events", (req, res) => {
  const { runId } = req.params;
  const state = runs.get(runId);
  if (!state) return res.status(404).end();

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  // @ts-expect-error: flushHeaders exists when using compression/compatible middleware
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const send = (event: { type: string; data?: unknown }) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data ?? {})}\n\n`);
  };

  const onEvent = (e: { type: string; data?: unknown }) => send(e);
  state.events.on("event", onEvent);

  const heartbeat = setInterval(() => {
    res.write(`: keep-alive ${Date.now()}\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    state.events.off("event", onEvent);
  });

  // Initial hello
  send({ type: "hello", data: { runId } });
});

export default router;