import os
from contextlib import contextmanager, nullcontext
from typing import Dict, Optional

from fastapi import FastAPI

# OpenTelemetry imports are intentionally local to avoid side effects if disabled
from opentelemetry import trace
from opentelemetry.trace import Tracer, Span
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor

# OTLP exporter (over HTTP/proto) when selected
try:
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter  # type: ignore
except Exception:  # pragma: no cover - available when package is installed
    OTLPSpanExporter = None  # type: ignore

# Optional instrumentation helpers
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.starlette import StarletteInstrumentor

# Local context: execution_id propagation support
from services.orchestrator.app.context import get_execution_id


_OTEL_ENABLED_ENV = "ORCH_OTEL_ENABLED"
_OTEL_EXPORTER_ENV = "ORCH_OTEL_EXPORTER"  # "stdout" (default) | "otlp"
_OTLP_ENDPOINT_ENV = "OTEL_EXPORTER_OTLP_ENDPOINT"

_SERVICE_NAME = "mentatlab-orchestrator"

_provider: Optional[TracerProvider] = None
_tracer: Optional[Tracer] = None


def otel_enabled() -> bool:
    """
    Returns True when telemetry is enabled via env (default False).
    """
    return os.getenv(_OTEL_ENABLED_ENV, "false").lower() in ("1", "true", "yes")


def _init_provider() -> None:
    global _provider, _tracer

    resource = Resource.create({"service.name": _SERVICE_NAME})
    provider = TracerProvider(resource=resource)

    exporter_selection = os.getenv(_OTEL_EXPORTER_ENV, "stdout").lower()
    if exporter_selection == "otlp" and OTLPSpanExporter is not None:
        endpoint = os.getenv(_OTLP_ENDPOINT_ENV)
        if endpoint:
            exporter = OTLPSpanExporter(endpoint=endpoint)
            processor = BatchSpanProcessor(exporter)
            provider.add_span_processor(processor)
        else:
            # Fallback to stdout if endpoint not set
            provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
    else:
        # Default dev-friendly stdout exporter
        provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))

    trace.set_tracer_provider(provider)
    _provider = provider
    _tracer = trace.get_tracer(_SERVICE_NAME)


def setup_telemetry(app: FastAPI) -> None:
    """
    Registers startup/shutdown handlers and instruments FastAPI/Starlette if enabled.
    Safe no-op when telemetry is disabled.
    """
    if not otel_enabled():
        return

    @app.on_event("startup")
    async def _on_startup() -> None:
        # Initialize provider/exporter and instrument frameworks
        _init_provider()
        try:
            # Starlette instrumentation captures ASGI pipeline; FastAPI adds route attributes
            StarletteInstrumentor().instrument()
            FastAPIInstrumentor.instrument_app(app)
        except Exception:
            # Do not fail startup if instrumentation raises
            pass

    @app.on_event("shutdown")
    async def _on_shutdown() -> None:
        global _provider
        try:
            if _provider is not None:
                _provider.shutdown()
        finally:
            _provider = None


def get_tracer() -> Optional[Tracer]:
    """
    Returns the tracer when telemetry is enabled, else None.
    """
    return _tracer if otel_enabled() else None


@contextmanager
def span(name: str, attributes: Optional[Dict[str, object]] = None):
    """
    Context manager that starts a span if telemetry is enabled; otherwise acts as a no-op.
    Automatically adds execution_id attribute when available.
    """
    if not otel_enabled():
        yield None
        return

    tracer = get_tracer()
    if tracer is None:
        yield None
        return

    # Merge provided attributes with execution_id when present
    attrs: Dict[str, object] = {}
    if attributes:
        attrs.update(attributes)
    exec_id = get_execution_id()
    if exec_id and "execution_id" not in attrs:
        attrs["execution_id"] = exec_id

    with tracer.start_as_current_span(name) as s:
        if attrs:
            for k, v in attrs.items():
                try:
                    s.set_attribute(k, v)
                except Exception:
                    pass
        yield s


def enrich_current_span(attributes: Dict[str, object]) -> None:
    """
    Adds attributes onto the current span when enabled and recording.
    """
    if not otel_enabled():
        return
    try:
        current: Span = trace.get_current_span()
        if current and current.is_recording():
            for k, v in attributes.items():
                try:
                    current.set_attribute(k, v)
                except Exception:
                    pass
    except Exception:
        # Swallow to avoid affecting app flow
        pass