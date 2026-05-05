from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Union
import contextvars

# Correlation ID storage (per-process default; can be overridden per-call)
_correlation_id_ctx: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "correlation_id", default=None
)


def set_correlation_id(correlation_id: Optional[str]) -> None:
    """
    Set a default correlation_id for all subsequent emits in this process context.
    Pass None to clear it.
    """
    _correlation_id_ctx.set(correlation_id)


def _now_iso8601() -> str:
    # Always UTC; avoid leap seconds and tz issues
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def emit_event(
    *,
    type: str,
    data: Optional[Dict[str, Any]] = None,
    level: Optional[str] = None,
    message: Optional[str] = None,
    correlation_id: Optional[str] = None,
    ts: Optional[str] = None,
) -> None:
    """
    Emit a single NDJSON event line to stdout and flush immediately.

    Event contract (minimum viable):
    {
      "type": "log" | "checkpoint" | "metric" | "node_status" | "custom_type",
      "level": "debug" | "info" | "warn" | "error" (optional, for log),
      "message": "...", (optional for log)
      "data": { ... },  (arbitrary JSON payload)
      "correlation_id": "...", (optional)
      "ts": ISO8601 string (optional)
    }
    """
    evt: Dict[str, Any] = {
        "type": type,
    }
    if level is not None:
        evt["level"] = level
    if message is not None:
        evt["message"] = message
    if data is not None:
        evt["data"] = data
    cid = correlation_id if correlation_id is not None else _correlation_id_ctx.get()
    if cid:
        evt["correlation_id"] = cid
    evt["ts"] = ts if ts is not None else _now_iso8601()

    try:
        sys.stdout.write(
            json.dumps(evt, separators=(",", ":"), ensure_ascii=False) + "\n"
        )
        sys.stdout.flush()
    except Exception:
        # Do not raise; agent should keep running even if an emit fails
        pass


def log_info(
    message: str,
    data: Optional[Dict[str, Any]] = None,
    *,
    correlation_id: Optional[str] = None,
) -> None:
    emit_event(
        type="log",
        level="info",
        message=message,
        data=data,
        correlation_id=correlation_id,
    )


def log_error(
    message: str,
    data: Optional[Dict[str, Any]] = None,
    *,
    correlation_id: Optional[str] = None,
) -> None:
    emit_event(
        type="log",
        level="error",
        message=message,
        data=data,
        correlation_id=correlation_id,
    )


def checkpoint(
    stage: str,
    progress: Union[int, float],
    extra: Optional[Dict[str, Any]] = None,
    *,
    correlation_id: Optional[str] = None,
) -> None:
    payload = {"stage": stage, "progress": float(progress)}
    if extra:
        payload.update(extra)
    emit_event(type="checkpoint", data=payload, correlation_id=correlation_id)


def emit_error(
    code: str,
    message: str,
    *,
    retryable: bool = False,
    details: Optional[Dict[str, Any]] = None,
    correlation_id: Optional[str] = None,
) -> None:
    """Emit a structured error event.

    The orchestrator parses type="error" events and uses the `retryable` hint
    to decide whether to retry the node (transient) or fail permanently.

    Args:
        code: Machine-readable error code (e.g. MODEL_NOT_READY, TIMEOUT).
        message: Human-readable description.
        retryable: If True, scheduler treats this as a transient failure.
        details: Optional additional context.
        correlation_id: Override default correlation ID.
    """
    payload: Dict[str, Any] = {
        "code": code,
        "message": message,
        "retryable": retryable,
    }
    if details:
        payload["details"] = details
    emit_event(
        type="error",
        level="error",
        message=message,
        data=payload,
        correlation_id=correlation_id,
    )


def emit_progress(
    current: Optional[int] = None,
    total: Optional[int] = None,
    *,
    percent: Optional[Union[int, float]] = None,
    message: Optional[str] = None,
    eta_seconds: Optional[Union[int, float]] = None,
    correlation_id: Optional[str] = None,
) -> None:
    """Emit a progress event.

    Args:
        current: Optional current step number. Kept for compatibility.
        total: Optional total steps. Kept for compatibility.
        percent: Completion percent from 0 to 100. If omitted, computed from current/total.
        message: Optional human-readable status (e.g. "Processing batch 3/10").
        eta_seconds: Optional estimated seconds remaining.
        correlation_id: Override default correlation ID.
    """
    computed_percent: Union[int, float]
    if percent is not None:
        computed_percent = percent
    elif current is not None and total is not None and total > 0:
        computed_percent = current / total * 100
    else:
        computed_percent = 0

    payload: Dict[str, Any] = {
        "percent": max(0, min(100, round(float(computed_percent), 1))),
    }
    if current is not None:
        payload["current"] = current
    if total is not None:
        payload["total"] = total
    if message is not None:
        payload["message"] = message
    if eta_seconds is not None:
        payload["eta_seconds"] = max(0, float(eta_seconds))

    display_message = message
    if display_message is None:
        if current is not None and total is not None:
            display_message = f"Progress: {current}/{total}"
        else:
            display_message = f"Progress: {payload['percent']}%"

    emit_event(
        type="progress",
        level="info",
        message=display_message,
        data=payload,
        correlation_id=correlation_id,
    )


def emit_heartbeat(*, correlation_id: Optional[str] = None) -> None:
    """Emit a heartbeat event indicating the agent is alive.

    The orchestrator uses heartbeat absence to detect stalled agents.
    """
    emit_event(type="heartbeat", correlation_id=correlation_id)
