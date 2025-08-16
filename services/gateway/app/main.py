from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from services.gateway.app import router_flows
from services.gateway.app import websockets
from services.gateway.app import router_agents
from services.gateway.app import streaming
import os
# NEW: Imports for proxying
from typing import Optional, Dict, Any
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse, Response
import httpx

app = FastAPI(
    title="Gateway Service",
    description="Gateway for MentatLab streaming",
    version="0.1.0",
)

# Security: CORS Configuration
origins = [
    "http://localhost:3000",  # React dev server
    "http://localhost:5173",  # Vite dev server
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
]

# Add environment-specific origins
if os.getenv("FRONTEND_URL"):
    origins.append(os.getenv("FRONTEND_URL"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*", "Cache-Control", "Connection"],  # Add streaming headers
    expose_headers=["*"],
)

# Security: Trusted Host Middleware
trusted_hosts = ["localhost", "127.0.0.1", "*.localhost"]
if os.getenv("TRUSTED_HOSTS"):
    trusted_hosts.extend(os.getenv("TRUSTED_HOSTS").split(","))

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=trusted_hosts
)

# Security Headers Middleware
@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    return response

# NEW: Orchestrator base URL configuration and helpers
ORCHESTRATOR_BASE_URL = os.getenv("ORCHESTRATOR_BASE_URL", "http://localhost:7070").rstrip("/")


def get_orch_base() -> str:
    """
    Return base URL for the Python Orchestrator.
    Reads ORCHESTRATOR_BASE_URL env (default http://localhost:7070).
    """
    return ORCHESTRATOR_BASE_URL


def _orch_url(path: str) -> str:
    """Join orchestrator base with the given API path."""
    base = get_orch_base()
    if not path.startswith("/"):
        path = "/" + path
    return f"{base}{path}"


def _forward_auth_and_content_headers(req: Request) -> Dict[str, str]:
    """
    Minimal header propagation for proxying:
    - Authorization (if present)
    - Content-Type (if present)
    - Accept (pass through when useful, e.g., SSE)
    """
    headers: Dict[str, str] = {}
    auth = req.headers.get("authorization")
    if auth:
        headers["authorization"] = auth
    ctype = req.headers.get("content-type")
    if ctype:
        headers["content-type"] = ctype
    accept = req.headers.get("accept")
    if accept:
        headers["accept"] = accept
    # Forward Last-Event-ID when applicable (SSE handled in streaming.py; harmless here)
    last_event_id = req.headers.get("last-event-id")
    if last_event_id:
        headers["last-event-id"] = last_event_id
    return headers


def _get_http_client(request: Optional[Request] = None) -> httpx.AsyncClient:
    """
    Return shared httpx.AsyncClient stored on app.state.
    Fallback: raise if not initialized.
    """
    # Prefer request.app.state when available
    if request is not None:
        client = getattr(request.app.state, "http_client", None)
        if client:
            return client
    # Fallback to global app variable (same FastAPI instance)
    client = getattr(app.state, "http_client", None)
    if client:
        return client
    raise RuntimeError("HTTP client not initialized on app.state.http_client")

app.include_router(websockets.router)
app.include_router(router_agents.router, prefix="/api/v1")
app.include_router(streaming.router, tags=["streaming"])  # Include streaming router without prefix so WebSocket endpoints work

# NEW: Runs proxy router
runs_router = APIRouter(prefix="/api/v1/runs", tags=["runs"])


@runs_router.post("")
async def create_run(request: Request) -> Response:
    """
    Proxy: POST /api/v1/runs -> Orchestrator
    Forwards JSON body and minimal headers; returns orchestrator JSON/status unchanged.
    """
    try:
        body = await request.body()
        headers = _forward_auth_and_content_headers(request)
        client = _get_http_client(request)
        resp = await client.post(_orch_url("/api/v1/runs"), content=body, headers=headers)
        # Return status and body transparently
        return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get("content-type", "application/json"))
    except httpx.RequestError as e:
        return JSONResponse(status_code=502, content={"error": "orchestrator_unreachable", "detail": str(e)})


@runs_router.get("")
async def list_runs(request: Request) -> Response:
    """
    Proxy: GET /api/v1/runs -> Orchestrator list endpoint (if available).
    If orchestrator returns 404, respond 501 Not Implemented per spec.
    """
    try:
        headers = _forward_auth_and_content_headers(request)
        client = _get_http_client(request)
        resp = await client.get(_orch_url("/api/v1/runs"), headers=headers, params=dict(request.query_params))
        if resp.status_code == 404:
            return JSONResponse(status_code=501, content={"error": "not_implemented", "detail": "List runs not available on orchestrator"})
        return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get("content-type", "application/json"))
    except httpx.RequestError as e:
        return JSONResponse(status_code=502, content={"error": "orchestrator_unreachable", "detail": str(e)})


@runs_router.get("/{run_id}")
async def get_run(run_id: str, request: Request) -> Response:
    """
    Proxy: GET /api/v1/runs/{run_id} -> Orchestrator
    """
    try:
        headers = _forward_auth_and_content_headers(request)
        client = _get_http_client(request)
        resp = await client.get(_orch_url(f"/api/v1/runs/{run_id}"), headers=headers, params=dict(request.query_params))
        return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get("content-type", "application/json"))
    except httpx.RequestError as e:
        return JSONResponse(status_code=502, content={"error": "orchestrator_unreachable", "detail": str(e)})


@runs_router.post("/{run_id}/cancel")
async def cancel_run(run_id: str, request: Request) -> Response:
    """
    Proxy: POST /api/v1/runs/{run_id}/cancel -> Orchestrator
    """
    try:
        body = await request.body()
        headers = _forward_auth_and_content_headers(request)
        client = _get_http_client(request)
        resp = await client.post(_orch_url(f"/api/v1/runs/{run_id}/cancel"), content=body, headers=headers)
        return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get("content-type", "application/json"))
    except httpx.RequestError as e:
        return JSONResponse(status_code=502, content={"error": "orchestrator_unreachable", "detail": str(e)})

# Register runs router
app.include_router(runs_router)

# NEW: Orchestrator info/health proxy
@app.get("/api/v1/orchestrator/info")
async def orchestrator_info(request: Request) -> Response:
    """
    Proxy a simple health/info request to orchestrator (GET /healthz by default).
    """
    try:
        headers = _forward_auth_and_content_headers(request)
        client = _get_http_client(request)
        resp = await client.get(_orch_url("/healthz"), headers=headers)
        return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get("content-type", "application/json"))
    except httpx.RequestError as e:
        return JSONResponse(status_code=502, content={"error": "orchestrator_unreachable", "detail": str(e)})

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup."""
    # Initialize streaming manager
    await streaming.streaming_manager.initialize()
    # NEW: Initialize shared httpx.AsyncClient
    # Connection pool with sane defaults and timeouts
    timeout = httpx.Timeout(connect=5.0, read=60.0, write=30.0, pool=60.0)
    limits = httpx.Limits(max_keepalive_connections=20, max_connections=100, keepalive_expiry=60.0)
    app.state.http_client = httpx.AsyncClient(timeout=timeout, limits=limits, follow_redirects=False)

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup services on shutdown."""
    # Cleanup streaming manager
    await streaming.streaming_manager.shutdown()
    # NEW: Close shared httpx.AsyncClient
    client = getattr(app.state, "http_client", None)
    if client:
        await client.aclose()

@app.get("/healthz")
async def healthz():
    return {"status": "ok", "streaming_enabled": True}

@app.get("/")
async def root():
    return {
        "message": "MentatLab Gateway API with Streaming Support",
        "version": "0.2.0",
        "features": ["flows", "agents", "websockets", "streaming", "sse"]
    }

app.include_router(router_flows.router, prefix="/flows")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
