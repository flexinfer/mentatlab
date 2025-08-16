/**
 * Runs API client (Gateway)
 *
 * Configuration:
 * - Uses VITE_GATEWAY_BASE_URL (preferred) or VITE_GATEWAY_URL; falls back to window.location.origin or http://127.0.0.1:8080 for local dev.
 * - All paths are relative to the Gateway base.
 *
 * Endpoints:
 * - POST   /api/v1/runs
 * - GET    /api/v1/runs/{id}
 * - GET    /api/v1/runs           (may return 501 Not Implemented; this client handles gracefully)
 * - POST   /api/v1/runs/{id}/cancel
 *
 * Curl examples (align with backend docs):
 *   Create:
 *     curl -X POST "$GATEWAY/api/v1/runs" \
 *       -H "Content-Type: application/json" \
 *       -d '{"plan":{"nodes":[],"edges":[]}}'
 *
 *   Get:
 *     curl "$GATEWAY/api/v1/runs/<run_id>"
 *
 *   List (if supported):
 *     curl "$GATEWAY/api/v1/runs"
 *
 *   Cancel:
 *     curl -X POST "$GATEWAY/api/v1/runs/<run_id>/cancel"
 */

import { HttpClient, HttpError } from './httpClient';
import { getGatewayBaseUrl } from '@/config/orchestrator';

// Minimal types to keep API surface stable
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled' | string;

export interface NodeStatus {
  id: string;
  status: RunStatus;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export interface PlanNode {
  id: string;
  type?: string;
  label?: string;
  params?: Record<string, any>;
}

export interface PlanEdge {
  from: string;
  to: string;
  label?: string;
}

export interface Plan {
  nodes: PlanNode[];
  edges?: PlanEdge[];
}

export interface Run {
  id: string;
  status: RunStatus;
  created_at?: string;
  updated_at?: string;
  plan?: Plan;
  metadata?: Record<string, any>;
  nodes?: Record<string, NodeStatus>;
}

export interface CreateRunRequest {
  plan: Plan;
  // Optional fields: metadata, labels, etc.
  metadata?: Record<string, any>;
}

export interface CreateRunResponse {
  run: Run;
}

export interface ListRunsResponse {
  runs: Run[];
}

// Local HttpClient instance configured to Gateway base URL
const gatewayHttp = new HttpClient({
  baseUrl: getGatewayBaseUrl(),
});

// One-time logger for 501 listRuns
let didWarnListNotImplemented = false;

/**
 * POST /api/v1/runs
 */
export async function createRun(body: CreateRunRequest): Promise<CreateRunResponse> {
  const url = '/api/v1/runs';
  const res = await gatewayHttp.post<CreateRunResponse>(url, body);
  return res;
}

/**
 * GET /api/v1/runs/{id}
 */
export async function getRun(id: string): Promise<Run> {
  const url = `/api/v1/runs/${encodeURIComponent(id)}`;
  const res = await gatewayHttp.get<Run>(url);
  return res;
}

/**
 * GET /api/v1/runs
 * Gracefully handle 501 Not Implemented by returning an empty list.
 */
export async function listRuns(): Promise<ListRunsResponse> {
  const url = '/api/v1/runs';
  try {
    const res = await gatewayHttp.get<ListRunsResponse>(url);
    // Normalize in case backend returns bare array
    if (Array.isArray((res as unknown) as any)) {
      return { runs: (res as unknown as Run[]) ?? [] };
    }
    return res ?? { runs: [] };
  } catch (err) {
    if (err instanceof HttpError && err.status === 501) {
      if (!didWarnListNotImplemented) {
        console.warn('[runs.listRuns] 501 Not Implemented by Gateway; returning empty list');
        didWarnListNotImplemented = true;
      }
      return { runs: [] };
    }
    throw err;
  }
}

/**
 * POST /api/v1/runs/{id}/cancel
 */
export async function cancelRun(id: string): Promise<{ ok: true; run?: Run }> {
  const url = `/api/v1/runs/${encodeURIComponent(id)}/cancel`;
  const res = await gatewayHttp.post<{ ok: true; run?: Run }>(url, {});
  return res;
}