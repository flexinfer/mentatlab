/**
 * NDJSON event emitters for MentatLab agents.
 *
 * Mirrors the Python agents/common/emit.py contract. Events are written to
 * stdout as single JSON lines and flushed immediately.
 */

let _correlationId: string | undefined;

/** Set a default correlation ID for subsequent emits. */
export function setCorrelationId(id: string | undefined): void {
  _correlationId = id;
}

function nowISO(): string {
  return new Date().toISOString().replace("+00:00", "Z");
}

interface EmitOptions {
  type: string;
  level?: string;
  message?: string;
  data?: Record<string, unknown>;
  correlationId?: string;
  ts?: string;
}

/** Emit a single NDJSON event line to stdout. */
export function emitEvent(opts: EmitOptions): void {
  const evt: Record<string, unknown> = { type: opts.type };
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
  data?: Record<string, unknown>,
  correlationId?: string,
): void {
  emitEvent({ type: "log", level: "info", message, data, correlationId });
}

export function logError(
  message: string,
  data?: Record<string, unknown>,
  correlationId?: string,
): void {
  emitEvent({ type: "log", level: "error", message, data, correlationId });
}

export function checkpoint(
  stage: string,
  progress: number,
  extra?: Record<string, unknown>,
  correlationId?: string,
): void {
  const payload: Record<string, unknown> = { stage, progress };
  if (extra) Object.assign(payload, extra);
  emitEvent({ type: "checkpoint", data: payload, correlationId });
}

export function emitError(
  code: string,
  message: string,
  opts?: {
    retryable?: boolean;
    details?: Record<string, unknown>;
    correlationId?: string;
  },
): void {
  const payload: Record<string, unknown> = {
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

export function emitProgress(
  current: number,
  total: number,
  opts?: { message?: string; correlationId?: string },
): void {
  const percent = total > 0 ? Math.round((current / total) * 1000) / 10 : 0;
  emitEvent({
    type: "progress",
    level: "info",
    message: opts?.message ?? `Progress: ${current}/${total}`,
    data: { current, total, percent },
    correlationId: opts?.correlationId,
  });
}

export function emitHeartbeat(correlationId?: string): void {
  emitEvent({ type: "heartbeat", correlationId });
}
