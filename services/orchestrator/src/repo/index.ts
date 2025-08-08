import { Run, RunStatus, Checkpoint } from "../types";
import MemoryRepo from "./memoryRepo";
import RedisRepo from "./redisRepo";

/**
 * Repository interface for run persistence.
 */
export interface RunRepository {
  createRun(run: Run): Promise<void>;
  getRun(runId: string): Promise<Run | null>;
  setStatus(runId: string, status: RunStatus): Promise<void>;
  addCheckpoint(runId: string, cp: Checkpoint): Promise<void>;
  listCheckpoints(runId: string): Promise<Checkpoint[]>;
}

/**
 * Factory that returns Redis-backed repo when REDIS_URL is set and non-empty,
 * otherwise falls back to the in-memory implementation.
 */
export function createRepository(): RunRepository {
  if (process.env.REDIS_URL && process.env.REDIS_URL.trim() !== "") {
    return new RedisRepo();
  }
  return new MemoryRepo();
}

// Re-export commonly used types for convenience
export { Run, RunStatus, Checkpoint };