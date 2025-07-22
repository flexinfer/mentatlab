from fastapi import FastAPI
from . import router_flows

app = FastAPI(title="MentatLab Gateway")

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

app.include_router(router_flows.router, prefix="/flows")
