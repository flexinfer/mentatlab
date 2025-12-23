// Consolidated Orchestrator Types

// --- Run Modes & Status ---
export type RunMode = "plan" | "redis" | "k8s";
export type RunStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "succeeded"
  | "failed"
  | "canceled"
  | "cancelled";

// --- Plan Definitions ---
export interface PlanNode {
  id: string;
  agent?: string; // Agent type/image to run
  type?: string; // Component type (UI legacy)
  label?: string; // Display label
  params?: Record<string, unknown>;
  max_retries?: number;
  timeoutMs?: number;
  backoff_seconds?: number;
}

export interface PlanEdge {
  from: string; // "nodeId" or "nodeId.pin"
  to: string; // "nodeId" or "nodeId.pin"
  label?: string;
  from_node?: string; // Backend compat
  to_node?: string; // Backend compat
}

export interface RunPlan {
  nodes: PlanNode[];
  edges: PlanEdge[];
  metadata?: Record<string, unknown>;
}

// --- Run Objects ---
export interface Run {
  id: string;
  mode?: RunMode;
  status: RunStatus;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  owner?: string;
  plan?: RunPlan;
  metadata?: Record<string, unknown>;
  nodes?: Record<string, NodeStatus>;
  summary?: Record<string, unknown>;
}

export interface NodeStatus {
  id: string;
  status: RunStatus;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

// --- API Requests/Responses ---
export interface CreateRunRequest {
  name?: string;
  plan: RunPlan;
  mode?: RunMode;
  options?: {
    dryRun?: boolean;
    [key: string]: unknown;
  };
  metadata?: Record<string, unknown>;
}

export interface CreateRunResponse {
  runId?: string;
  run_id?: string;
  id?: string;
  mode?: string;
  plan?: unknown;
}

// --- Events & Checkpoints ---
export interface Checkpoint {
  id: string;
  runId: string;
  ts: string; // ISO date string used as SSE id
  type: string;
  data?: any;
  label?: string;
}

export type OrchestratorEvent =
  | { type: "hello"; data: { runId: string; server_time?: string } }
  | { type: "checkpoint"; data: Checkpoint }
  | { type: "status"; data: { runId: string; status: RunStatus } }
  | {
      type: "node_status";
      data: { run_id: string; node_id: string; state: string };
    }
  | {
      type: "log";
      data: {
        run_id: string;
        level: string;
        message: string;
        node_id?: string;
        ts?: string;
      };
    }
  | { type: "artifact"; data: Record<string, unknown> };
