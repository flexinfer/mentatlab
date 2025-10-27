from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from typing import Dict
import os
import httpx

router = APIRouter()

ORCHESTRATOR_BASE_URL = os.getenv("ORCHESTRATOR_BASE_URL", "http://localhost:7070").rstrip("/")

def _get_http_client(request: Request) -> httpx.AsyncClient:
    client = getattr(request.app.state, "http_client", None)
    if not client:
        raise RuntimeError("HTTP client not initialized on app.state.http_client")
    return client

def _forward_headers(req: Request) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    for name in ("authorization", "accept"):
        v = req.headers.get(name)
        if v:
            headers[name] = v
    return headers

@router.get("/agents")
async def proxy_agents(request: Request) -> Response:
    """Proxy agents catalog to Orchestrator /api/v1/agents."""
    try:
        client = _get_http_client(request)
        headers = _forward_headers(request)
        url = f"{ORCHESTRATOR_BASE_URL}/api/v1/agents"
        resp = await client.get(url, headers=headers)
        return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get("content-type", "application/json"))
    except httpx.RequestError as e:
        return JSONResponse(status_code=502, content={"error": "orchestrator_unreachable", "detail": str(e)})

@router.get("/agents/{agent_type}/schema")
async def agent_schema_not_implemented(agent_type: str):
    return JSONResponse(status_code=501, content={"error": "not_implemented", "detail": "Agent schema endpoint not implemented"})

@router.post("/agents/schedule")
async def proxy_agents_schedule(request: Request) -> Response:
    """Proxy agent schedule to Orchestrator /api/v1/agents/schedule."""
    try:
        client = _get_http_client(request)
        headers = _forward_headers(request)
        body = await request.body()
        url = f"{ORCHESTRATOR_BASE_URL}/api/v1/agents/schedule"
        resp = await client.post(url, headers=headers, content=body)
        return Response(content=resp.content, status_code=resp.status_code, media_type=resp.headers.get("content-type", "application/json"))
    except httpx.RequestError as e:
        return JSONResponse(status_code=502, content={"error": "orchestrator_unreachable", "detail": str(e)})
