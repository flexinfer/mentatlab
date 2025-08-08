import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import http from "http";
import app from "../server";
import { openSSE, SSEEvent } from "./helpers/sseClient";

vi.setTimeout(10000);

describe("runs router + SSE integration", () => {
  let server: http.Server;
  let baseUrl = "";

  beforeAll((done) => {
    server = http.createServer(app);
    server.listen(0, () => {
      // @ts-expect-error: address may be string | AddressInfo
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : addr;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(() => done());
  });

  it("POST /runs?mode=plan returns plan payload", async () => {
    const res = await request(app).post("/runs?mode=plan").send({});
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("mode", "plan");
    expect(res.body).toHaveProperty("plan");
    expect(Array.isArray(res.body.plan.steps)).toBe(true);
  });

  it("create run, seeded status and checkpoint, checkpoint lifecycle, cancel transition", async () => {
    // create run (non-plan)
    const createRes = await request(app).post("/runs").send({});
    expect(createRes.status).toBe(201);
    expect(createRes.body).toHaveProperty("runId");
    const runId: string = createRes.body.runId;
    expect(typeof runId).toBe("string");

    // allow seeding (router seeds after ~10ms)
    await new Promise((r) => setTimeout(r, 80));

    // GET run -> should be running (seed updated status)
    const getRun = await request(app).get(`/runs/${runId}`).send();
    expect(getRun.status).toBe(200);
    expect(getRun.body).toHaveProperty("run");
    expect(getRun.body.run).toHaveProperty("status", "running");

    // GET checkpoints -> include "started"
    const cpRes = await request(app).get(`/runs/${runId}/checkpoints`).send();
    expect(cpRes.status).toBe(200);
    expect(cpRes.body).toHaveProperty("checkpoints");
    const cps = cpRes.body.checkpoints as Array<any>;
    expect(Array.isArray(cps)).toBe(true);
    expect(cps.some((c) => c.type === "started")).toBe(true);

    // POST a progress checkpoint
    const newCp = { type: "progress", data: { percent: 42 } };
    const postCp = await request(app).post(`/runs/${runId}/checkpoints`).send(newCp);
    expect(postCp.status).toBe(201);
    expect(postCp.body).toHaveProperty("checkpointId");
    const checkpointId = postCp.body.checkpointId;
    expect(typeof checkpointId).toBe("string");

    // GET checkpoints again and ensure progress exists
    const cpRes2 = await request(app).get(`/runs/${runId}/checkpoints`).send();
    expect(cpRes2.status).toBe(200);
    const cps2 = cpRes2.body.checkpoints as Array<any>;
    expect(cps2.some((c) => c.type === "progress")).toBe(true);

    // DELETE -> cancel
    const del1 = await request(app).delete(`/runs/${runId}`).send();
    expect(del1.status).toBe(200);
    expect(del1.body).toHaveProperty("ok", true);
    expect(del1.body).toHaveProperty("status", "canceled");

    // DELETE again -> 409
    const del2 = await request(app).delete(`/runs/${runId}`).send();
    expect(del2.status).toBe(409);
    expect(del2.body).toHaveProperty("error", "invalid status transition");
  });

  it("SSE: hello, live checkpoint event, Last-Event-ID resume and ?replay behavior", async () => {
    // create a fresh run for SSE tests
    const createRes = await request(app).post("/runs").send({});
    expect(createRes.status).toBe(201);
    const runId: string = createRes.body.runId;

    // Wait for seeding
    await new Promise((r) => setTimeout(r, 80));

    // Start SSE connection
    const url = `${baseUrl}/runs/${runId}/events`;
    const sse = openSSE(url);
    const events: SSEEvent[] = [];

    const waitForEvent = (pred: (e: SSEEvent) => boolean, timeout = 3000) =>
      new Promise<SSEEvent>((resolve, reject) => {
        const to = setTimeout(() => reject(new Error("timeout waiting for event")), timeout);
        const cb = (ev: SSEEvent) => {
          try {
            if (pred(ev)) {
              sse.onEventCbs; // noop to appease linters if needed
              clearTimeout(to);
              resolve(ev);
            }
          } catch (err) {
            // ignore
          }
        };
        sse.onEvent(cb);
      });

    // Wait for open
    await new Promise<void>((resolve) => {
      sse.onOpen(() => resolve());
    });

    // First event should be hello
    const helloEv = await waitForEvent((e) => e.event === "hello");
    expect(helloEv.event).toBe("hello");
    expect((helloEv.data as any).runId).toBe(runId);

    // Post a checkpoint and wait for checkpoint SSE
    const postCp = await request(app).post(`/runs/${runId}/checkpoints`).send({ type: "progress", data: { v: 1 } });
    expect(postCp.status).toBe(201);

    const cpEv = await waitForEvent((e) => e.event === "checkpoint");
    expect(cpEv.event).toBe("checkpoint");
    // For checkpoint events, server sets SSE id to checkpoint.ts (ISO string)
    expect(typeof cpEv.id).toBe("string");
    const firstCpTs = cpEv.id as string;

    // Post another checkpoint to have a later one
    await new Promise((r) => setTimeout(r, 20));
    const postCp2 = await request(app).post(`/runs/${runId}/checkpoints`).send({ type: "progress", data: { v: 2 } });
    expect(postCp2.status).toBe(201);
    const cpEv2 = await waitForEvent((e) => e.event === "checkpoint" && e.id !== firstCpTs);
    expect(cpEv2.id > firstCpTs).toBe(true);

    // Close current connection
    sse.close();

    // Reconnect with Last-Event-ID set to firstCpTs - expect only later checkpoints (cpEv2)
    const replayUrl = `${baseUrl}/runs/${runId}/events`;
    const sse2 = openSSE(replayUrl, { headers: { "Last-Event-ID": firstCpTs } });

    await new Promise<void>((resolve) => sse2.onOpen(() => resolve()));

    // Collect replayed checkpoint events (ignore hello)
    const replayed: SSEEvent[] = [];
    const collectPromise = new Promise<void>((resolve, reject) => {
      const to = setTimeout(() => {
        // resolve after timeout with what we have
        resolve();
      }, 400);
      sse2.onEvent((ev) => {
        if (ev.event === "checkpoint") {
          replayed.push(ev);
        }
      });
    });

    await collectPromise;
    // Should include only checkpoints with ts > firstCpTs (at least one)
    expect(replayed.length).toBeGreaterThanOrEqual(1);
    expect(replayed.every((r) => (r.id ?? "") > firstCpTs)).toBe(true);
    sse2.close();

    // Test ?replay=1 yields exactly the last checkpoint on connect when no Last-Event-ID
    const sse3 = openSSE(`${baseUrl}/runs/${runId}/events?replay=1`);
    await new Promise<void>((resolve) => sse3.onOpen(() => resolve()));
    const replayOne: SSEEvent[] = [];
    const p = new Promise<void>((resolve) => {
      const to = setTimeout(() => resolve(), 400);
      sse3.onEvent((ev) => {
        if (ev.event === "checkpoint") replayOne.push(ev);
      });
    });
    await p;
    // Should receive at least one (the last checkpoint)
    expect(replayOne.length).toBeGreaterThanOrEqual(1);
    sse3.close();
  });
});