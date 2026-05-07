/**
 * NDJSON event emitters for MentatLab agents.
 *
 * Mirrors the Python agents/common/emit.py contract. Events are written to
 * stdout as single JSON lines and flushed immediately.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

let _correlationId: string | undefined;

/** Set a default correlation ID for subsequent emits. */
export function setCorrelationId(id: string | null | undefined): void {
  _correlationId = id ?? undefined;
}

function nowISO(): string {
  return new Date().toISOString();
}

export interface EmitOptions {
  type: string;
  level?: string;
  message?: string;
  data?: JsonObject;
  correlationId?: string;
  ts?: string;
}

/** Emit a single NDJSON event line to stdout. */
export function emitEvent(opts: EmitOptions): void {
  const evt: JsonObject = { type: opts.type };
  if (opts.level !== undefined) evt.level = opts.level;
  if (opts.message !== undefined) evt.message = opts.message;
  if (opts.data !== undefined) evt.data = opts.data;
  const cid = opts.correlationId ?? _correlationId;
  if (cid) evt.correlation_id = cid;
  evt.ts = opts.ts ?? nowISO();

  try {
    process.stdout.write(JSON.stringify(evt) + "\n");
  } catch {
    // Do not throw; agent should keep running even if an emit fails.
  }
}

export function logInfo(
  message: string,
  data?: JsonObject,
  correlationId?: string,
): void {
  emitEvent({ type: "log", level: "info", message, data, correlationId });
}

export function logError(
  message: string,
  data?: JsonObject,
  correlationId?: string,
): void {
  emitEvent({ type: "log", level: "error", message, data, correlationId });
}

export function checkpoint(
  stage: string,
  progress: number,
  extra?: JsonObject,
  correlationId?: string,
): void {
  const payload: JsonObject = { stage, progress };
  if (extra) Object.assign(payload, extra);
  emitEvent({ type: "checkpoint", data: payload, correlationId });
}

export function emitOutput(key: string, value: JsonValue, correlationId?: string): void {
  emitEvent({ type: "output", data: { key, value }, correlationId });
}

export function emitError(
  code: string,
  message: string,
  opts?: {
    retryable?: boolean;
    details?: JsonObject;
    correlationId?: string;
  },
): void {
  const payload: JsonObject = {
    code,
    message,
    retryable: opts?.retryable ?? false,
  };
  if (opts?.details) payload.details = opts.details;
  emitEvent({
    type: "error",
    level: "error",
    message,
    data: payload,
    correlationId: opts?.correlationId,
  });
}

export interface ProgressOptions {
  current?: number;
  total?: number;
  percent?: number;
  message?: string;
  etaSeconds?: number;
  eta_seconds?: number;
  correlationId?: string;
}

export function emitProgress(
  currentOrOptions?: number | ProgressOptions,
  total?: number,
  opts?: ProgressOptions,
): void {
  const progress =
    typeof currentOrOptions === "object"
      ? currentOrOptions
      : { ...(opts ?? {}), current: currentOrOptions, total };

  const computedPercent =
    progress.percent ??
    (progress.current !== undefined && progress.total !== undefined && progress.total > 0
      ? (progress.current / progress.total) * 100
      : 0);
  const percent = clampPercent(computedPercent);
  const etaSeconds = progress.eta_seconds ?? progress.etaSeconds;

  const data: JsonObject = { percent };
  if (progress.current !== undefined) data.current = progress.current;
  if (progress.total !== undefined) data.total = progress.total;
  if (progress.message !== undefined) data.message = progress.message;
  if (etaSeconds !== undefined) data.eta_seconds = Math.max(0, etaSeconds);

  const message =
    progress.message ??
    (progress.current !== undefined && progress.total !== undefined
      ? `Progress: ${progress.current}/${progress.total}`
      : `Progress: ${percent}%`);

  emitEvent({
    type: "progress",
    level: "info",
    message,
    data,
    correlationId: progress.correlationId,
  });
}

export function emitHeartbeat(correlationId?: string): void {
  emitEvent({ type: "heartbeat", correlationId });
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
