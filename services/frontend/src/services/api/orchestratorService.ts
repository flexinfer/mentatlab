import apiService from './apiService';
import { nanoid } from 'nanoid';

/**
 * Orchestrator API client for frontend usage.
 * Uses the existing apiService.httpClient (axios-like) for requests.
 *
 * Exports a small class with the minimal methods needed by the UI:
 * - createRun(mode?: 'plan'|'redis'|'k8s')
 * - getRun(runId)
 * - listCheckpoints(runId)
 * - postCheckpoint(runId, { type, data })
 */
export type RunMode = 'plan' | 'redis' | 'k8s';

export interface CreateRunResult {
  runId?: string;
  mode?: string;
  plan?: unknown;
}

/** Checkpoint shape returned from the server */
export interface Checkpoint {
  id: string;
  runId: string;
  ts: string;
  type: string;
  data?: unknown;
}

/** Run object */
export interface Run {
  id: string;
  mode: RunMode;
  createdAt: string;
  status: string;
  owner?: string;
  metadata?: Record<string, unknown>;
}

class OrchestratorService {
  private client = apiService.httpClient;

  async createRun(mode?: RunMode): Promise<CreateRunResult> {
    // plan mode handled server-side via query param
    const params: Record<string, string> = {};
    if (mode) params.mode = mode;
    const res = await this.client.post('/runs', null, { params });
    return res.data;
  }

  async getRun(runId: string): Promise<Run> {
    const res = await this.client.get(`/runs/${runId}`);
    return res.data.run as Run;
  }

  async listCheckpoints(runId: string): Promise<Checkpoint[]> {
    const res = await this.client.get(`/runs/${runId}/checkpoints`);
    return res.data.checkpoints as Checkpoint[];
  }

  async postCheckpoint(runId: string, payload: { type: string; data?: unknown }): Promise<{ checkpointId: string }> {
    // The server generates id/ts; client sends semantic payload only
    const res = await this.client.post(`/runs/${runId}/checkpoints`, payload);
    return res.data as { checkpointId: string };
  }

  // Convenience: create a "plan" locally (not necessary since server supports it);
  makeLocalPlan(): { mode: 'plan'; plan: { steps: string[] } } {
    return { mode: 'plan', plan: { steps: ['validate', 'schedule', 'execute'] } };
  }
}

export const orchestratorService = new OrchestratorService();
export default orchestratorService;