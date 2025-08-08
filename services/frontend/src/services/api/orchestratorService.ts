import apiService from './apiService';
import { getOrchestratorBaseUrl } from '@/config/orchestrator';
import type { Run, Checkpoint, RunMode, RunStatus } from '@/types/orchestrator';

/**
 * Orchestrator API client for frontend usage.
 * Uses the existing apiService.httpClient (axios-like / fetch wrapper) for requests.
 *
 * Exposes:
 * - createRun(mode?: 'plan'|'redis'|'k8s')
 * - getRun(runId)
 * - listRuns()
 * - listCheckpoints(runId)
 * - postCheckpoint(runId, { type, data })
 * - cancelRun(runId)
 */

export interface CreateRunResult {
  runId?: string;
  mode?: string;
  plan?: unknown;
}

class OrchestratorService {
  private client = apiService.httpClient;

  // helper to be tolerant of different http client response shapes
  private extract<T = any>(res: any): T {
    return res && typeof res === 'object' && 'data' in res ? res.data as T : (res as T);
  }

  private baseUrl(): string {
    return getOrchestratorBaseUrl().replace(/\/$/, '');
  }

  async createRun(mode?: RunMode): Promise<CreateRunResult> {
    const params: Record<string, string> = {};
    if (mode) params.mode = mode;
    const res = await this.client.post(`${this.baseUrl()}/runs`, null, { params });
    return this.extract<CreateRunResult>(res);
  }

  async getRun(runId: string): Promise<Run> {
    const res = await this.client.get(`${this.baseUrl()}/runs/${encodeURIComponent(runId)}`);
    const payload = this.extract<any>(res);
    // server might return { run: {...} } or the run object directly
    return (payload.run ?? payload) as Run;
  }

  async listRuns(): Promise<Run[]> {
    const res = await this.client.get(`${this.baseUrl()}/runs`);
    const payload = this.extract<any>(res);
    // expect { runs: Run[] } or raw array
    return (payload.runs ?? payload) as Run[];
  }

  async listCheckpoints(runId: string): Promise<Checkpoint[]> {
    const res = await this.client.get(`${this.baseUrl()}/runs/${encodeURIComponent(runId)}/checkpoints`);
    const payload = this.extract<any>(res);
    return (payload.checkpoints ?? payload) as Checkpoint[];
  }

  async postCheckpoint(runId: string, payload: { type: string; data?: unknown }): Promise<{ checkpointId: string }> {
    const res = await this.client.post(`${this.baseUrl()}/runs/${encodeURIComponent(runId)}/checkpoints`, payload);
    return this.extract<{ checkpointId: string }>(res);
  }

  /**
   * Cancel a run.
   * Calls DELETE /runs/:runId and returns the parsed result { status: RunStatus }.
   * Errors (404/409/etc) are NOT swallowed and will propagate to the caller.
   */
  async cancelRun(runId: string): Promise<{ status: RunStatus }> {
    const res = await this.client.delete(`${this.baseUrl()}/runs/${encodeURIComponent(runId)}`);
    return this.extract<{ status: RunStatus }>(res);
  }

  // Convenience: create a "plan" locally (not necessary since server supports it);
  makeLocalPlan(): { mode: 'plan'; plan: { steps: string[] } } {
    return { mode: 'plan', plan: { steps: ['validate', 'schedule', 'execute'] } };
  }
}

export const orchestratorService = new OrchestratorService();
export default orchestratorService;