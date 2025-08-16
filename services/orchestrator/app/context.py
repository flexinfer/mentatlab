import logging
import uuid
import contextvars
from typing import Optional

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from opentelemetry.trace import get_current_span

# Execution ID contextvar, accessible across logging and business logic
execution_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("execution_id", default=None)


def get_execution_id() -> Optional[str]:
    return execution_id_var.get()


class ExecutionIdLogFilter(logging.Filter):
    """
    Logging filter that injects 'execution_id' onto every LogRecord.
    Formatters can include %(execution_id)s to emit the value.
    """
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.execution_id = get_execution_id() or "-"
        except Exception:
            record.execution_id = "-"
        return True


def add_execution_id_log_filter() -> None:
    """
    Attach the ExecutionIdLogFilter to common loggers.
    Safe to call multiple times; adding an identical filter multiple times is avoided by logging framework.
    """
    filt = ExecutionIdLogFilter()
    # Root logger
    logging.getLogger().addFilter(filt)
    # Common web loggers
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error", "fastapi"):
        logging.getLogger(name).addFilter(filt)


class ExecutionIdMiddleware(BaseHTTPMiddleware):
    """
    ASGI middleware that:
    - Reads an execution_id from the incoming request header (configurable name)
    - Optionally generates one if missing (UUIDv7 preferred, UUID4 fallback)
    - Stores it on request.state and contextvar for logging and downstream code
    - Adds the execution_id to the current server span (if tracing is active)
    - Echoes the execution_id back in the response header
    """

    def __init__(self, app, header_name: str = "X-Execution-Id", generate_if_missing: bool = True):
        super().__init__(app)
        self.header_name = header_name
        self.generate_if_missing = generate_if_missing

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = request.headers.get(self.header_name)
        execution_id = incoming

        token: Optional[contextvars.Token] = None

        if not execution_id and self.generate_if_missing:
            try:
                # Python 3.13 provides uuid.uuid7()
                execution_id = str(uuid.uuid7())
            except AttributeError:
                execution_id = str(uuid.uuid4())

        if execution_id:
            # Attach to request state and contextvar
            setattr(request.state, "execution_id", execution_id)
            token = execution_id_var.set(execution_id)

            # Enrich current server span if present
            try:
                span = get_current_span()
                if span and span.is_recording():
                    span.set_attribute("execution_id", execution_id)
            except Exception:
                # Tracing may not be initialized; ignore
                pass

        try:
            response = await call_next(request)
        finally:
            # Restore contextvar
            if token is not None:
                try:
                    execution_id_var.reset(token)
                except Exception:
                    pass

        # Always propagate back if we have one
        if execution_id:
            response.headers[self.header_name] = execution_id

        return response