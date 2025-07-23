from fastapi import FastAPI
from . import router_flows
from . import websockets

app = FastAPI(title="MentatLab Gateway")

app.include_router(websockets.router)

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

app.include_router(router_flows.router, prefix="/flows")
