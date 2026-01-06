/**
 * Zod schemas for SSE Event validation
 *
 * These schemas match the backend orchestrator-go/pkg/types/event.go exactly.
 * Use these for runtime validation of incoming SSE events.
 */
import { z } from 'zod';

// --- Enums matching backend constants ---

/**
 * EventType - all event types from backend EventType constants
 */
export const EventTypeSchema = z.enum([
  // Stream lifecycle
  'stream_start',
  'stream_end',
  'stream_data',
  // Core events
  'log',
  'checkpoint',
  'node_status',
  'run_status',
  'progress',
  'error',
  // Control flow
  'condition_evaluated',
  'branch_selected',
  'branch_skipped',
  'loop_started',
  'loop_iteration',
  'loop_complete',
  // Special
  'hello',
  'message', // fallback type
]);
export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * LogLevel - matches backend LogLevel constants
 * Note: Backend uses "warning" not "warn"
 */
export const LogLevelSchema = z.enum(['debug', 'info', 'warning', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * NodeStatus - matches backend NodeStatus constants
 */
export const NodeStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

/**
 * RunStatus - matches backend RunStatus constants
 */
export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

// --- Event Data Payloads ---

/**
 * LogEvent - data payload for log events
 * Backend: types.LogEvent
 */
export const LogEventDataSchema = z.object({
  level: LogLevelSchema,
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
export type LogEventData = z.infer<typeof LogEventDataSchema>;

/**
 * CheckpointEvent - data payload for checkpoint events
 * Backend: types.CheckpointEvent
 */
export const CheckpointEventDataSchema = z.object({
  label: z.string(),
  artifact_ref: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CheckpointEventData = z.infer<typeof CheckpointEventDataSchema>;

/**
 * NodeStatusEvent - data payload for node status change events
 * Backend: types.NodeStatusEvent
 */
export const NodeStatusEventDataSchema = z.object({
  status: NodeStatusSchema,
  exit_code: z.number().int().optional().nullable(),
  error: z.string().optional(),
});
export type NodeStatusEventData = z.infer<typeof NodeStatusEventDataSchema>;

/**
 * RunStatusEvent - data payload for run status change events
 * Backend: types.RunStatusEvent
 */
export const RunStatusEventDataSchema = z.object({
  status: RunStatusSchema,
  error: z.string().optional(),
});
export type RunStatusEventData = z.infer<typeof RunStatusEventDataSchema>;

/**
 * ProgressEvent - data payload for progress events
 * Backend: types.ProgressEvent
 */
export const ProgressEventDataSchema = z.object({
  current: z.number().int(),
  total: z.number().int(),
  message: z.string().optional(),
});
export type ProgressEventData = z.infer<typeof ProgressEventDataSchema>;

/**
 * StreamDataEvent - generic streaming data from agent
 * Backend: types.StreamDataEvent
 */
export const StreamDataEventDataSchema = z.object({
  content_type: z.string().optional(),
  text: z.string().optional(),
  raw: z.unknown().optional(),
});
export type StreamDataEventData = z.infer<typeof StreamDataEventDataSchema>;

/**
 * HelloEvent - sent when SSE connection is established
 */
export const HelloEventDataSchema = z.object({
  runId: z.string().optional(),
  run_id: z.string().optional(),
  server_time: z.string().optional(),
});
export type HelloEventData = z.infer<typeof HelloEventDataSchema>;

/**
 * ConditionEvaluatedEvent - control flow: condition was evaluated
 */
export const ConditionEvaluatedEventDataSchema = z.object({
  selected_branch: z.string().optional(),
  branch: z.string().optional(),
  expression: z.string().optional(),
  result: z.unknown().optional(),
});
export type ConditionEvaluatedEventData = z.infer<typeof ConditionEvaluatedEventDataSchema>;

/**
 * LoopStartedEvent - control flow: loop began
 */
export const LoopStartedEventDataSchema = z.object({
  item_count: z.number().int().optional(),
  collection: z.string().optional(),
});
export type LoopStartedEventData = z.infer<typeof LoopStartedEventDataSchema>;

/**
 * LoopIterationEvent - control flow: loop iteration
 */
export const LoopIterationEventDataSchema = z.object({
  index: z.number().int(),
  total: z.number().int().optional(),
  item: z.unknown().optional(),
});
export type LoopIterationEventData = z.infer<typeof LoopIterationEventDataSchema>;

/**
 * LoopCompleteEvent - control flow: loop finished
 */
export const LoopCompleteEventDataSchema = z.object({
  iterations: z.number().int().optional(),
  error: z.string().optional(),
});
export type LoopCompleteEventData = z.infer<typeof LoopCompleteEventDataSchema>;

// --- Main Event Schema ---

/**
 * BaseEvent - the envelope for all SSE events
 * Backend: types.Event
 *
 * Note: The `data` field contains the type-specific payload.
 * Use discriminated parsing based on `type` field.
 */
export const BaseEventSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  type: EventTypeSchema,
  node_id: z.string().optional(),
  timestamp: z.string(), // ISO 8601 datetime
  data: z.unknown().optional(), // Parsed separately based on type
});
export type BaseEvent = z.infer<typeof BaseEventSchema>;

/**
 * Loosely-typed event for initial parsing before type discrimination
 * Accepts any shape and extracts common fields
 */
export const RawSSEEventSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  event: z.string().optional(),
  type: z.string().optional(),
  run_id: z.string().optional(),
  node_id: z.string().optional(),
  timestamp: z.string().optional(),
  data: z.unknown().optional(),
}).passthrough(); // Allow additional fields

export type RawSSEEvent = z.infer<typeof RawSSEEventSchema>;

// --- Validation Helpers ---

/**
 * Safe parse that returns undefined on failure instead of throwing
 */
export function safeParseEvent<T>(schema: z.ZodType<T>, data: unknown): T | undefined {
  const result = schema.safeParse(data);
  return result.success ? result.data : undefined;
}

/**
 * Parse event data based on event type
 */
export function parseEventData(type: string, data: unknown): unknown {
  switch (type) {
    case 'log':
      return safeParseEvent(LogEventDataSchema, data);
    case 'checkpoint':
      return safeParseEvent(CheckpointEventDataSchema, data);
    case 'node_status':
      return safeParseEvent(NodeStatusEventDataSchema, data);
    case 'run_status':
      return safeParseEvent(RunStatusEventDataSchema, data);
    case 'progress':
      return safeParseEvent(ProgressEventDataSchema, data);
    case 'stream_data':
      return safeParseEvent(StreamDataEventDataSchema, data);
    case 'hello':
      return safeParseEvent(HelloEventDataSchema, data);
    case 'condition_evaluated':
      return safeParseEvent(ConditionEvaluatedEventDataSchema, data);
    case 'loop_started':
      return safeParseEvent(LoopStartedEventDataSchema, data);
    case 'loop_iteration':
      return safeParseEvent(LoopIterationEventDataSchema, data);
    case 'loop_complete':
      return safeParseEvent(LoopCompleteEventDataSchema, data);
    default:
      return data; // Return as-is for unknown types
  }
}

/**
 * Validate and parse a raw SSE event
 * Returns the parsed event or throws ZodError
 */
export function validateSSEEvent(raw: unknown): BaseEvent {
  return BaseEventSchema.parse(raw);
}

/**
 * Safe validation that returns undefined on failure
 */
export function safeValidateSSEEvent(raw: unknown): BaseEvent | undefined {
  const result = BaseEventSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}
