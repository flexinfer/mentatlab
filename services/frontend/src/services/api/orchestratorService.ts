import apiService from "./apiService";
import { getOrchestratorBaseUrl } from "@/config/orchestrator";
import {
  Run,
  Checkpoint,
  RunMode,
  RunStatus,
  CreateRunRequest,
  CreateRunResponse,
  RunPlan,
  Artifact,
} from "@/types/orchestrator";
import OrchestratorSSE from "./streaming/orchestratorSSE";

/**
 * Orchestrator API client.
 * Unified service for all Run/Plan/Checkpoint operations.
 */

class OrchestratorService {
  private client = apiService.httpClient;

  // helper to be tolerant of different http client response shapes
  private extract<T = any>(res: any): T {
    return res && typeof res === "object" && "data" in res
      ? (res.data as T)
      : (res as T);
  }

  private baseUrl(): string {
    return getOrchestratorBaseUrl().replace(/\/$/, "");
  }

  /**
   * Create a run (or plan).
   * Supports both legacy (mode arg) and new (request body) signatures.
   */
  async createRun(
    requestOrMode?: CreateRunRequest | RunMode
  ): Promise<CreateRunResponse> {
    if (typeof requestOrMode === "string") {
      // Legacy: just mode
      const params = { mode: requestOrMode };
      const res = await this.client.post(`${this.baseUrl()}/runs`, null, {
        params,
      });
      return this.extract<CreateRunResponse>(res);
    } else {
      // New: structured request
      const req = requestOrMode || { plan: { nodes: [], edges: [] } };
      const res = await this.client.post(`${this.baseUrl()}/runs`, req);
      return this.extract<CreateRunResponse>(res);
    }
  }

  async getRun(runId: string): Promise<Run> {
    const res = await this.client.get(
      `${this.baseUrl()}/runs/${encodeURIComponent(runId)}`
    );
    const payload = this.extract<any>(res);
    // server might return { run: {...} } or the run object directly
    return (payload.run ?? payload) as Run;
  }

  async listRuns(): Promise<Run[]> {
    try {
      const res = await this.client.get(`${this.baseUrl()}/runs`);
      const payload = this.extract<any>(res);
      // expect { runs: Run[] } or raw array
      const runs = payload.runs ?? payload;
      return Array.isArray(runs) ? (runs as Run[]) : [];
    } catch (err: any) {
      if (err.status === 501) return []; // Not implemented gracefully
      throw err;
    }
  }

  async listCheckpoints(runId: string): Promise<Checkpoint[]> {
    const res = await this.client.get(
      `${this.baseUrl()}/runs/${encodeURIComponent(runId)}/checkpoints`
    );
    const payload = this.extract<any>(res);
    return (payload.checkpoints ?? payload) as Checkpoint[];
  }

  async postCheckpoint(
    runId: string,
    payload: { type: string; data?: unknown }
  ): Promise<{ checkpointId: string }> {
    const res = await this.client.post(
      `${this.baseUrl()}/runs/${encodeURIComponent(runId)}/checkpoints`,
      payload
    );
    return this.extract<{ checkpointId: string }>(res);
  }

  /**
   * Retry failed nodes in a run.
   */
  async retryNodes(
    runId: string,
    nodeIds: string[]
  ): Promise<{ status: RunStatus; retriedNodes: string[] }> {
    const res = await this.client.post(
      `${this.baseUrl()}/runs/${encodeURIComponent(runId)}/retry`,
      { nodeIds }
    );
    return this.extract<{ status: RunStatus; retriedNodes: string[] }>(res);
  }

  /**
   * List artifacts for a run.
   */
  async listArtifacts(runId: string): Promise<Artifact[]> {
    const res = await this.client.get(
      `${this.baseUrl()}/runs/${encodeURIComponent(runId)}/artifacts`
    );
    const payload = this.extract<any>(res);
    return (payload.artifacts ?? payload) as Artifact[];
  }

  /**
   * Upload an artifact to a run (multipart form).
   */
  async uploadArtifact(
    runId: string,
    file: File,
    metadata?: { name?: string; type?: string }
  ): Promise<Artifact> {
    const formData = new FormData();
    formData.append("file", file);
    if (metadata?.name) formData.append("name", metadata.name);
    if (metadata?.type) formData.append("type", metadata.type);

    const res = await this.client.post(
      `${this.baseUrl()}/runs/${encodeURIComponent(runId)}/artifacts`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return this.extract<Artifact>(res);
  }

  /**
   * Delete an artifact by URI.
   */
  async deleteArtifact(uri: string): Promise<void> {
    await this.client.delete(`${this.baseUrl()}/artifacts`, {
      params: { uri },
    });
  }

  /**
   * Get a presigned download URL for an artifact.
   */
  async getArtifactDownloadUrl(uri: string): Promise<{ url: string }> {
    const res = await this.client.post(
      `${this.baseUrl()}/artifacts/download-url`,
      { uri }
    );
    return this.extract<{ url: string }>(res);
  }

  /**
   * Cancel a run.
   */
  async cancelRun(runId: string): Promise<{ status: RunStatus }> {
    // Try separate cancel endpoint first (gateway pattern), fall back to DELETE
    try {
      const res = await this.client.post(
        `${this.baseUrl()}/runs/${encodeURIComponent(runId)}/cancel`,
        {}
      );
      return this.extract<{ status: RunStatus }>(res);
    } catch (e: any) {
      if (e.status === 404 || e.status === 405) {
        const res = await this.client.delete(
          `${this.baseUrl()}/runs/${encodeURIComponent(runId)}`
        );
        return this.extract<{ status: RunStatus }>(res);
      }
      throw e;
    }
  }

  // --- Streaming Helpers ---

  /**
   * Stream events for a run.
   * Returns an OrchestratorSSE wrapper instance.
   */
  streamRunEvents(runId: string, handlers: any): OrchestratorSSE {
    const sse = new OrchestratorSSE();
    sse.connect(runId, handlers).catch((err) => handlers.onError?.(err));
    return sse;
  }

  /**
   * Demo Helper: Create a dummy plan and stream it.
   * Used by MissionControlLayout for visual testing.
   */
  async startDemoRunAndStream(
    handlers: any
  ): Promise<{ runId: string; stop: () => void }> {
    const plan: RunPlan = {
      nodes: [
        { id: "Perception" },
        { id: "Ego" },
        { id: "Planning" },
        { id: "Memory" },
        { id: "Actuator" },
      ],
      edges: [
        { from: "Perception.out", to: "Ego.in" },
        { from: "Ego.out", to: "Planning.in" },
        { from: "Planning.out", to: "Memory.in" },
        { from: "Planning.out", to: "Actuator.in" },
      ],
      metadata: { kind: "demo" },
    };

    const { runId, run_id } = await this.createRun({ plan });
    const id = runId || run_id;
    if (!id) throw new Error("Failed to create demo run");

    const sse = this.streamRunEvents(id, handlers);
    return { runId: id, stop: () => sse.close() };
  }
}

export const orchestratorService = new OrchestratorService();
export default orchestratorService;
