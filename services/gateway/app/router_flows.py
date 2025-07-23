from fastapi import APIRouter, HTTPException, status
import json
from pathlib import Path

from services.gateway.app.models import Flow
from services.orchestrator.app.main import create_execution_plan

router = APIRouter()

# Load example flow at startup
FLOWS_DIR = Path(__file__).resolve().parents[3] / "examples"
_flows = {
    "hello_chat": json.loads((FLOWS_DIR / "hello_chat.json").read_text())
}


@router.get("/{flow_id}")
async def get_flow(flow_id: str):
    if flow_id not in _flows:
        raise HTTPException(status_code=404, detail="Flow not found")
    return _flows[flow_id]


@router.post("/flows", status_code=status.HTTP_201_CREATED)
async def create_flow(flow: Flow):
    execution_plan = create_execution_plan(flow)
    return execution_plan
