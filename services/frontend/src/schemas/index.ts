/**
 * Zod schemas for runtime API contract validation
 *
 * These schemas provide:
 * - Runtime type validation for API responses
 * - Type inference for TypeScript
 * - Contract testing utilities
 *
 * Usage:
 *   import { RunSchema, validateRun } from '@/schemas';
 *   const run = validateRun(apiResponse); // Throws on invalid
 *   const run = safeValidateRun(apiResponse); // Returns undefined on invalid
 */

// Event schemas
export {
  // Enums
  EventTypeSchema,
  LogLevelSchema,
  NodeStatusSchema,
  RunStatusSchema,
  // Event data payloads
  LogEventDataSchema,
  CheckpointEventDataSchema,
  NodeStatusEventDataSchema,
  RunStatusEventDataSchema,
  ProgressEventDataSchema,
  StreamDataEventDataSchema,
  HelloEventDataSchema,
  ConditionEvaluatedEventDataSchema,
  LoopStartedEventDataSchema,
  LoopIterationEventDataSchema,
  LoopCompleteEventDataSchema,
  // Main event schemas
  BaseEventSchema,
  RawSSEEventSchema,
  // Helpers
  safeParseEvent,
  parseEventData,
  validateSSEEvent,
  safeValidateSSEEvent,
  // Types
  type EventType,
  type LogLevel,
  type NodeStatus as EventNodeStatus, // Renamed to avoid conflict
  type RunStatus as EventRunStatus,
  type LogEventData,
  type CheckpointEventData,
  type NodeStatusEventData,
  type RunStatusEventData,
  type ProgressEventData,
  type StreamDataEventData,
  type HelloEventData,
  type ConditionEvaluatedEventData,
  type LoopStartedEventData,
  type LoopIterationEventData,
  type LoopCompleteEventData,
  type BaseEvent,
  type RawSSEEvent,
} from './event.schema';

// Run schemas
export {
  // Configs
  ConditionalConfigSchema,
  ForEachConfigSchema,
  SubflowConfigSchema,
  EdgeSpecSchema,
  NodeSpecSchema,
  PlanSchema,
  NodeStateSchema,
  // Run types
  RunMetaSchema,
  RunSchema,
  // API types
  CreateRunRequestSchema,
  CreateRunResponseSchema,
  StartRunResponseSchema,
  // Helpers
  validateRun,
  safeValidateRun,
  validateCreateRunResponse,
  safeValidateCreateRunResponse,
  isTerminalStatus,
  isControlFlowNode,
  // Types
  type ConditionalConfig,
  type ForEachConfig,
  type SubflowConfig,
  type EdgeSpec,
  type NodeSpec,
  type Plan,
  type NodeState,
  type RunMeta,
  type Run,
  type CreateRunRequest,
  type CreateRunResponse,
  type StartRunResponse,
} from './run.schema';
