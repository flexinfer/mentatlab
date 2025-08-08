import { createClient, RedisClientType } from "redis";
import { Run, RunStatus, Checkpoint } from "../types";

/**
 * Redis-backed repository implementation using node-redis v4.
 * Connects using process.env.REDIS_URL. Lazy-connects on first use.
 */
export default class RedisRepo {
  private static client: RedisClientType | null = null;

  private async clientReady(): Promise<RedisClientType> {
    if (RedisRepo.client && RedisRepo.client.isOpen) return RedisRepo.client;
    const url = process.env.REDIS_URL ?? "";
    const client = createClient({ url });
    // set up minimal error handlers
    client.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("Redis client error:", err);
    });
    await client.connect();
    RedisRepo.client = client;
    return client;
  }

  private runKey(runId: string) {
    return `run:${runId}`;
  }

  private checkpointsKey(runId: string) {
    return `run:${runId}:checkpoints`;
  }

  async createRun(run: Run): Promise<void> {
    const client = await this.clientReady();
    const key = this.runKey(run.id);
    try {
      // set run key (overwrite or set). Use JSON.stringify for storage.
      await client.set(key, JSON.stringify(run));
      // ensure checkpoints list exists (no-op if not needed)
      // We won't create an empty list explicitly; RPUSH will create it when first checkpoint is added.
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Redis createRun error:", err);
      throw err;
    }
  }

  async getRun(runId: string): Promise<Run | null> {
    const client = await this.clientReady();
    const key = this.runKey(runId);
    try {
      const raw = await client.get(key);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as Run;
        return parsed;
      } catch {
        // invalid JSON stored, treat as missing
        return null;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Redis getRun error:", err);
      throw err;
    }
  }

  async setStatus(runId: string, status: RunStatus): Promise<void> {
    const client = await this.clientReady();
    const key = this.runKey(runId);
    try {
      const raw = await client.get(key);
      if (!raw) return;
      try {
        const run = JSON.parse(raw) as Run;
        run.status = status;
        await client.set(key, JSON.stringify(run));
      } catch (parseErr) {
        // skip if invalid
        // eslint-disable-next-line no-console
        console.error("Redis setStatus parse error:", parseErr);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Redis setStatus error:", err);
      throw err;
    }
  }

  async addCheckpoint(runId: string, cp: Checkpoint): Promise<void> {
    const client = await this.clientReady();
    const key = this.checkpointsKey(runId);
    try {
      await client.rPush(key, JSON.stringify(cp));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Redis addCheckpoint error:", err);
      throw err;
    }
  }

  async listCheckpoints(runId: string): Promise<Checkpoint[]> {
    const client = await this.clientReady();
    const key = this.checkpointsKey(runId);
    try {
      const rows = await client.lRange(key, 0, -1);
      const out: Checkpoint[] = [];
      for (const r of rows) {
        try {
          const cp = JSON.parse(r) as Checkpoint;
          out.push(cp);
        } catch {
          // skip invalid entries
          // eslint-disable-next-line no-console
          console.warn("Skipping invalid checkpoint entry for run", runId);
        }
      }
      // sort ascending by ts
      out.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
      return out;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Redis listCheckpoints error:", err);
      throw err;
    }
  }
}