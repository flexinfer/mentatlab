/**
 * Zod schemas for Run API validation
 *
 * These schemas match the backend orchestrator-go types exactly.
 * Use these for runtime validation of API responses.
 */
import { z } from 'zod';
import { RunStatusSchema, NodeStatusSchema } from './event.schema';

// Re-export for convenience
export { RunStatusSchema, NodeStatusSchema };

// --- Node/Plan Specs ---

/**
 * ConditionalConfig - control flow: if/switch branching
 * Backend: types.ConditionalConfig
 */
export const ConditionalConfigSchema = z.object({
  type: z.enum(['if', 'switch']),
  expression: z.string(),
  branches: z.record(z.string(), z.object({
    condition: z.string().optional(),
    targets: z.array(z.string()),
  })),
  default: z.string().optional(),
});
export type ConditionalConfig = z.infer<typeof ConditionalConfigSchema>;

/**
 * ForEachConfig - control flow: loop over collection
 * Backend: types.ForEachConfig
 */
export const ForEachConfigSchema = z.object({
  collection: z.string(),
  item_var: z.string(),
  index_var: z.string().optional(),
  max_parallel: z.number().int().optional(),
  body: z.array(z.string()),
});
export type ForEachConfig = z.infer<typeof ForEachConfigSchema>;

/**
 * SubflowConfig - control flow: nested flow execution
 * Backend: types.SubflowConfig
 */
export const SubflowConfigSchema = z.object({
  flow_id: z.string(),
  input_mapping: z.record(z.string(), z.string()).optional(),
  output_mapping: z.record(z.string(), z.string()).optional(),
});
export type SubflowConfig = z.infer<typeof SubflowConfigSchema>;

/**
 * EdgeSpec - connection between nodes
 * Backend: types.EdgeSpec
 */
export const EdgeSpecSchema = z.object({
  from: z.string(),
  to: z.string(),
});
export type EdgeSpec = z.infer<typeof EdgeSpecSchema>;

/**
 * NodeSpec - single node in execution plan
 * Backend: types.NodeSpec
 *
 * IMPORTANT: Backend uses `agent_id` (snake_case), not `agent`
 */
export const NodeSpecSchema = z.object({
  id: z.string(),
  type: z.string(),
  agent_id: z.string().optional(),
  command: z.array(z.string()).optional(),
  image: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  inputs: z.array(z.string()).optional(),
  timeout: z.number().optional(), // Duration in nanoseconds from Go
  retries: z.number().int().optional(),
  // Control flow (only one should be set)
  conditional: ConditionalConfigSchema.optional(),
  for_each: ForEachConfigSchema.optional(),
  subflow: SubflowConfigSchema.optional(),
});
export type NodeSpec = z.infer<typeof NodeSpecSchema>;

/**
 * Plan - execution plan for a run
 * Backend: types.Plan
 */
export const PlanSchema = z.object({
  nodes: z.array(NodeSpecSchema),
  edges: z.array(EdgeSpecSchema).optional(),
});
export type Plan = z.infer<typeof PlanSchema>;

// --- Node State ---

/**
 * NodeState - runtime state of a node within a run
 * Backend: types.NodeState
 */
export const NodeStateSchema = z.object({
  node_id: z.string(),
  status: NodeStatusSchema,
  started_at: z.string().optional().nullable(),
  finished_at: z.string().optional().nullable(),
  exit_code: z.number().int().optional().nullable(),
  error: z.string().optional(),
  retries: z.number().int(),
});
export type NodeState = z.infer<typeof NodeStateSchema>;

// --- Run Types ---

/**
 * RunMeta - lightweight run representation for listings
 * Backend: types.RunMeta
 */
export const RunMetaSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  status: RunStatusSchema,
  started_at: z.string().optional().nullable(),
  finished_at: z.string().optional().nullable(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type RunMeta = z.infer<typeof RunMetaSchema>;

/**
 * Run - full run object with plan
 * Backend: types.Run
 */
export const RunSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  status: RunStatusSchema,
  plan: PlanSchema.optional().nullable(),
  started_at: z.string().optional().nullable(),
  finished_at: z.string().optional().nullable(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Run = z.infer<typeof RunSchema>;

// --- API Request/Response Types ---

/**
 * CreateRunRequest - request body for POST /api/v1/runs
 * Backend: api.CreateRunRequest
 */
export const CreateRunRequestSchema = z.object({
  name: z.string(),
  plan: PlanSchema,
  auto_start: z.boolean().optional(),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

/**
 * CreateRunResponse - response from POST /api/v1/runs
 * Backend: api.CreateRunResponse
 *
 * IMPORTANT: Contains `sse_url` field that should be captured
 */
export const CreateRunResponseSchema = z.object({
  runId: z.string(),
  status: z.string(),
  sse_url: z.string().optional(),
});
export type CreateRunResponse = z.infer<typeof CreateRunResponseSchema>;

/**
 * StartRunResponse - response from POST /api/v1/runs/{id}/start
 */
export const StartRunResponseSchema = z.object({
  status: z.string(),
  sse_url: z.string().optional(),
});
export type StartRunResponse = z.infer<typeof StartRunResponseSchema>;

// --- Validation Helpers ---

/**
 * Validate a Run response
 */
export function validateRun(data: unknown): Run {
  return RunSchema.parse(data);
}

/**
 * Safe validation that returns undefined on failure
 */
export function safeValidateRun(data: unknown): Run | undefined {
  const result = RunSchema.safeParse(data);
  return result.success ? result.data : undefined;
}

/**
 * Validate CreateRunResponse
 */
export function validateCreateRunResponse(data: unknown): CreateRunResponse {
  return CreateRunResponseSchema.parse(data);
}

/**
 * Safe validation that returns undefined on failure
 */
export function safeValidateCreateRunResponse(data: unknown): CreateRunResponse | undefined {
  const result = CreateRunResponseSchema.safeParse(data);
  return result.success ? result.data : undefined;
}

// --- Type Guards ---

/**
 * Check if a status is terminal (run is complete)
 */
export function isTerminalStatus(status: string): boolean {
  return ['succeeded', 'failed', 'cancelled'].includes(status);
}

/**
 * Check if a node is a control flow node
 */
export function isControlFlowNode(node: NodeSpec): boolean {
  return !!(node.conditional || node.for_each || node.subflow);
}
