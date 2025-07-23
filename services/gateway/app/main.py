from fastapi import FastAPI
from . import router_flows
from . import websockets
from . import router_agents

app = FastAPI(title="MentatLab Gateway")

app.include_router(websockets.router)
app.include_router(router_agents.router, prefix="/api/v1")

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

app.include_router(router_flows.router, prefix="/flows")
