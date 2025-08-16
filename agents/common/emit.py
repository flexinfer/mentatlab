from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Union
import contextvars

# Correlation ID storage (per-process default; can be overridden per-call)
_correlation_id_ctx: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("correlation_id", default=None)


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
        sys.stdout.write(json.dumps(evt, separators=(",", ":"), ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception:
        # Do not raise; agent should keep running even if an emit fails
        pass


def log_info(message: str, data: Optional[Dict[str, Any]] = None, *, correlation_id: Optional[str] = None) -> None:
    emit_event(type="log", level="info", message=message, data=data, correlation_id=correlation_id)


def log_error(message: str, data: Optional[Dict[str, Any]] = None, *, correlation_id: Optional[str] = None) -> None:
    emit_event(type="log", level="error", message=message, data=data, correlation_id=correlation_id)


def checkpoint(stage: str, progress: Union[int, float], extra: Optional[Dict[str, Any]] = None, *, correlation_id: Optional[str] = None) -> None:
    payload = {"stage": stage, "progress": float(progress)}
    if extra:
        payload.update(extra)
    emit_event(type="checkpoint", data=payload, correlation_id=correlation_id)