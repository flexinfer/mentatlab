import { describe, it, expect } from "vitest";
import MemoryRepo from "../repo/memoryRepo";
import RedisRepo from "../repo/redisRepo";
import { Run, Checkpoint, RunStatus } from "../types";

describe("MemoryRepo", () => {
  it("createRun/getRun roundtrip and status/update/checkpoints ordering", async () => {
    const repo = new MemoryRepo();

    const run: Run = {
      id: "mem-test-run-1",
      mode: "plan",
      createdAt: new Date().toISOString(),
      status: "pending"
    };

    await repo.createRun(run);
    const got = await repo.getRun(run.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(run.id);

    // update status
    await repo.setStatus(run.id, "running");
    const updated = await repo.getRun(run.id);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("running");

    // add checkpoints out of order ts to ensure sorting by ts ascending
    const now = Date.now();
    const cp1: Checkpoint = {
      id: "c1",
      runId: run.id,
      ts: new Date(now + 50).toISOString(),
      type: "progress",
      data: { v: 1 }
    };
    const cp2: Checkpoint = {
      id: "c2",
      runId: run.id,
      ts: new Date(now).toISOString(),
      type: "started"
    };

    await repo.addCheckpoint(run.id, cp1);
    await repo.addCheckpoint(run.id, cp2);

    const list = await repo.listCheckpoints(run.id);
    expect(list.length).toBeGreaterThanOrEqual(2);
    // ensure ascending by ts: cp2 (earlier) then cp1
    expect(list[0].ts <= list[1].ts).toBe(true);
    expect(list.some((c) => c.type === "started")).toBe(true);
  });
});

const hasRedis = typeof process.env.REDIS_URL === "string" && process.env.REDIS_URL.trim() !== "";

(if (hasRedis) {
  describe("RedisRepo (requires REDIS_URL)", () => {
    it("createRun/getRun roundtrip and status/update/checkpoints ordering", async () => {
      const repo = new RedisRepo();

      const run: Run = {
        id: "redis-test-run-1",
        mode: "plan",
        createdAt: new Date().toISOString(),
        status: "pending"
      };

      await repo.createRun(run);
      const got = await repo.getRun(run.id);
      expect(got).not.toBeNull();
      expect(got!.id).toBe(run.id);

      // update status
      await repo.setStatus(run.id, "running");
      const updated = await repo.getRun(run.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe("running");

      // add checkpoints and verify ordering
      const now = Date.now();
      const cp1: Checkpoint = {
        id: "r-c1",
        runId: run.id,
        ts: new Date(now).toISOString(),
        type: "started"
      };
      const cp2: Checkpoint = {
        id: "r-c2",
        runId: run.id,
        ts: new Date(now + 10).toISOString(),
        type: "progress"
      };

      await repo.addCheckpoint(run.id, cp1);
      await repo.addCheckpoint(run.id, cp2);

      const list = await repo.listCheckpoints(run.id);
      expect(list.length).toBeGreaterThanOrEqual(2);
      expect(list[0].ts <= list[1].ts).toBe(true);
    });
  });
} else {
  describe.skip("RedisRepo (skipped) - REDIS_URL not set, set REDIS_URL to run these tests", () => {
    it("skipped", () => {
      expect(true).toBe(true);
    });
  });
})