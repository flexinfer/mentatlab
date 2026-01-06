/**
 * Orchestrator Types (Legacy)
 *
 * @deprecated For API contract types, import from '@/types/api-contracts' instead.
 * This file is maintained for backwards compatibility.
 *
 * New code should use:
 *   import { Run, RunStatus, EventType } from '@/types/api-contracts';
 *
 * For runtime validation:
 *   import { validateRun, RunSchema } from '@/schemas';
 */

// --- Run Modes & Status ---
export type RunMode = "plan" | "redis" | "k8s";

/**
 * RunStatus - matches backend orchestrator-go/pkg/types/run.go exactly.
 *
 * IMPORTANT: This enum must stay in sync with the Go backend.
 * Backend values: queued, running, succeeded, failed, cancelled
 *
 * Note: Frontend code should use asRunStatus() from useRunGraph.ts to normalize
 * any legacy or variant status strings (e.g., "pending" -> "queued").
 */
export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

// --- Control Flow Types ---
export interface ConditionalBranch {
  condition?: string;  // For switch cases
  targets: string[];   // Downstream node IDs
}

export interface ConditionalConfig {
  type: 'if' | 'switch';
  expression: string;
  branches: Record<string, ConditionalBranch>;
  default?: string;
}

export interface ForEachConfig {
  collection: string;      // Expression yielding array
  item_var: string;        // Variable name for each item
  index_var?: string;      // Optional index variable
  max_parallel?: number;   // 0 = sequential
  body: string[];          // Node IDs in the loop body
}

export interface SubflowConfig {
  flow_id: string;
  input_mapping?: Record<string, string>;
  output_mapping?: Record<string, string>;
}

// --- Plan Definitions ---

/**
 * PlanNode - single node in an execution plan.
 *
 * IMPORTANT: Backend uses snake_case field names.
 * Match backend types.NodeSpec (orchestrator-go/pkg/types/run.go)
 */
export interface PlanNode {
  id: string;
  type?: string; // Node type (e.g., 'task', 'conditional', 'for_each')
  label?: string; // Display label (UI)

  // Agent configuration (use agent_id for backend compatibility)
  agent_id?: string; // Agent ID to run (matches backend)
  /** @deprecated Use agent_id instead */
  agent?: string; // Legacy field - maps to agent_id

  // Execution configuration
  image?: string; // Container image (backend: NodeSpec.Image)
  command?: string[]; // Command to run (backend: NodeSpec.Command)
  env?: Record<string, string>; // Environment variables
  inputs?: string[]; // Node IDs this depends on
  timeout?: number; // Timeout in nanoseconds (Go duration)
  retries?: number; // Max retry attempts (backend: NodeSpec.Retries)

  // Legacy fields (UI-specific, may not be sent to backend)
  params?: Record<string, unknown>;
  max_retries?: number; // Alias for retries
  timeoutMs?: number; // Alias for timeout (in ms, needs conversion)
  backoff_seconds?: number;

  // Control flow (only one should be set)
  conditional?: ConditionalConfig;
  for_each?: ForEachConfig;
  subflow?: SubflowConfig;
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

/**
 * CreateRunResponse - matches backend api.CreateRunResponse.
 *
 * Backend fields (orchestrator-go/internal/api/handlers.go):
 *   - runId: string (present when run is created)
 *   - status: string (e.g., "created", "running")
 *   - sse_url: string (optional, present when auto_start=true)
 *
 * IMPORTANT: Capture sse_url when present - it provides the SSE endpoint
 */
export interface CreateRunResponse {
  runId?: string;
  status?: string;
  sse_url?: string;
  // Legacy compatibility fields
  run_id?: string;
  id?: string;
  // Plan mode response (when mode='plan', returns generated plan)
  mode?: string;
  plan?: unknown;
}

// --- Artifacts ---
export interface Artifact {
  id: string;
  runId: string;
  name: string;
  uri: string;
  type?: string; // e.g., 'file', 'image', 'log'
  size?: number; // bytes
  createdAt: string;
  metadata?: Record<string, unknown>;
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
