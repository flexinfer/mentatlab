/**
 * Frontend types for orchestrator objects
 */

export type RunMode = 'plan' | 'redis' | 'k8s';

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled';

export interface Run {
  id: string;
  mode: RunMode;
  createdAt: string; // ISO date
  status: RunStatus;
  owner?: string;
  metadata?: Record<string, unknown>;
}

export interface Checkpoint {
  id: string;
  runId: string;
  ts: string; // ISO date string used as SSE id
  type: string;
  data?: unknown;
}

export type OrchestratorEvent =
  | { type: 'hello'; data: { runId: string } }
  | { type: 'checkpoint'; data: Checkpoint }
  | { type: 'status'; data: { runId: string; status: RunStatus } };