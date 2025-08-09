// Validation utilities for orchestrator domain schemas
// This module compiles JSON Schemas (resolved via resolveJsonModule) with Ajv
import Ajv, { ErrorObject, ValidateFunction } from "ajv";
// Import schemas from the local service-level schemas directory (populated during Docker build)
// This avoids importing files outside the TS project root which can cause tsc resolution failures.
import runSchema from "../../schemas/orchestrator/run.schema.json";
import checkpointSchema from "../../schemas/orchestrator/checkpoint.schema.json";
import eventSchema from "../../schemas/orchestrator/event.schema.json";

const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true });

const validateRunFn: ValidateFunction = ajv.compile(runSchema as object);
const validateCheckpointFn: ValidateFunction = ajv.compile(checkpointSchema as object);
const validateEventFn: ValidateFunction = ajv.compile(eventSchema as object);

export type ValidationResult = { valid: boolean; errors?: string[] };

function formatErrors(errors: ErrorObject[] | null | undefined): string[] | undefined {
  if (!errors || errors.length === 0) return undefined;
  return errors.map((e) => {
    // Ajv v8 uses `instancePath`; older versions used `dataPath`.
    const instancePath = (e.instancePath ?? (e as any).dataPath) as string;
    const path = instancePath && instancePath.length ? instancePath : "(root)";
    const message = e.message ?? JSON.stringify(e);
    return `${path} ${message}`.trim();
  });
}

export { ajv };

/**
 * validateRun
 * Validate an unknown payload against the Run schema.
 */
export function validateRun(data: unknown): ValidationResult {
  const valid = Boolean(validateRunFn(data));
  return { valid, errors: valid ? undefined : formatErrors(validateRunFn.errors) };
}

/**
 * validateCheckpoint
 * Validate an unknown payload against the Checkpoint schema.
 */
export function validateCheckpoint(data: unknown): ValidationResult {
  const valid = Boolean(validateCheckpointFn(data));
  return { valid, errors: valid ? undefined : formatErrors(validateCheckpointFn.errors) };
}

/**
 * validateEvent
 * Validate an unknown payload against the OrchestratorEvent schema.
 */
export function validateEvent(data: unknown): ValidationResult {
  const valid = Boolean(validateEventFn(data));
  return { valid, errors: valid ? undefined : formatErrors(validateEventFn.errors) };
}