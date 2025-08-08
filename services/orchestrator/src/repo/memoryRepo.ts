import { Run, RunStatus, Checkpoint } from "../types";

/**
 * Simple in-memory repository implementation used as a fallback.
 * Uses module-level Maps to persist runs and checkpoints.
 */
export default class MemoryRepo {
  private runs: Map<string, Run> = new Map();
  private checkpoints: Map<string, Checkpoint[]> = new Map();

  async createRun(run: Run): Promise<void> {
    this.runs.set(run.id, run);
    if (!this.checkpoints.has(run.id)) {
      this.checkpoints.set(run.id, []);
    }
  }

  async getRun(runId: string): Promise<Run | null> {
    const r = this.runs.get(runId);
    return r ?? null;
  }

  async setStatus(runId: string, status: RunStatus): Promise<void> {
    const r = this.runs.get(runId);
    if (!r) return;
    r.status = status;
    this.runs.set(runId, r);
  }

  async addCheckpoint(runId: string, cp: Checkpoint): Promise<void> {
    const list = this.checkpoints.get(runId) ?? [];
    list.push(cp);
    this.checkpoints.set(runId, list);
  }

  async listCheckpoints(runId: string): Promise<Checkpoint[]> {
    const list = this.checkpoints.get(runId) ?? [];
    // Return shallow copy sorted ascending by ts (ISO)
    return [...list].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  }
}