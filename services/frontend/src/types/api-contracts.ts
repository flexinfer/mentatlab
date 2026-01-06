/**
 * Canonical API Contract Types
 *
 * This file re-exports types from Zod schemas as the single source of truth
 * for API contracts between frontend and backend.
 *
 * IMPORTANT: Always import API types from this file, not from orchestrator.ts
 *
 * Usage:
 *   import { Run, RunStatus, Event, EventType } from '@/types/api-contracts';
 *
 * For runtime validation, import from @/schemas directly:
 *   import { validateRun, RunSchema } from '@/schemas';
 */

// =============================================================================
// Event Types - matches orchestrator-go/pkg/types/event.go
// =============================================================================

export type {
  // Enums
  EventType,
  LogLevel,

  // Event data payloads
  LogEventData,
  CheckpointEventData,
  NodeStatusEventData,
  RunStatusEventData,
  ProgressEventData,
  StreamDataEventData,
  HelloEventData,
  ConditionEvaluatedEventData,
  LoopStartedEventData,
  LoopIterationEventData,
  LoopCompleteEventData,

  // Event wrappers
  BaseEvent,
  RawSSEEvent,
} from '@/schemas/event.schema';

// Re-export NodeStatus and RunStatus with clear names
export type { NodeStatus as APINodeStatus, RunStatus as APIRunStatus } from '@/schemas/event.schema';

// =============================================================================
// Run Types - matches orchestrator-go/pkg/types/run.go
// =============================================================================

export type {
  // Plan structure
  ConditionalConfig,
  ForEachConfig,
  SubflowConfig,
  EdgeSpec,
  NodeSpec,
  Plan,

  // Run state
  NodeState,
  RunMeta,
  Run,

  // API request/response
  CreateRunRequest,
  CreateRunResponse,
  StartRunResponse,
} from '@/schemas/run.schema';

// =============================================================================
// Validation Helpers
// =============================================================================

export {
  // Event validation
  safeParseEvent,
  parseEventData,
  validateSSEEvent,
  safeValidateSSEEvent,

  // Run validation
  validateRun,
  safeValidateRun,
  validateCreateRunResponse,
  safeValidateCreateRunResponse,

  // Type guards
  isTerminalStatus,
  isControlFlowNode,
} from '@/schemas';

// =============================================================================
// Constants - Event type strings for switch statements
// =============================================================================

/** All valid event types from the backend */
export const EVENT_TYPES = [
  'hello',
  'stream_start',
  'stream_end',
  'stream_data',
  'log',
  'checkpoint',
  'node_status',
  'run_status',
  'progress',
  'error',
  'condition_evaluated',
  'branch_selected',
  'branch_skipped',
  'loop_started',
  'loop_iteration',
  'loop_complete',
] as const;

/** All valid run status values */
export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;

/** All valid node status values */
export const NODE_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'skipped'] as const;

/** All valid log levels */
export const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;

/** Terminal run statuses (run is complete) */
export const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;
