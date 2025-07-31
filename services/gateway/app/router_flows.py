from fastapi import APIRouter, HTTPException, status, Query
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


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_flow(
    flow: Flow,
    mode: str = Query("plan", description="Execution mode: plan, redis, or k8s"),
    cron: str | None = Query(None, description="Cron schedule for k8s mode"),
):
    """Create and execute a flow: plan-only, Redis-based, or k8s-based execution."""
    execution_plan = create_execution_plan(flow)
    result: dict[str, Any] = {"execution_plan": execution_plan}

    if mode == "redis":
        # Lightweight execution: publish tasks to Redis and UI events channel
        import redis.asyncio as redis
        from services.gateway.app.websockets import UI_NOTIFICATION_CHANNEL

        client = redis.from_url("redis://localhost", decode_responses=True)
        # 1) Notify UI of the execution plan
        await client.publish(
            UI_NOTIFICATION_CHANNEL,
            json.dumps({"type": "plan", "plan": execution_plan}),
        )
        # 2) Dispatch tasks for each non-UI node in plan
        node_map = {node.id: node for node in flow.graph.nodes}
        for node_id in execution_plan:
            node = node_map.get(node_id)
            if not node or node.type.startswith("ui."):
                continue
            task_channel = f"agent_tasks:{node.type}"
            task_data = {"input": node.outputs or {}, "node_id": node_id}
            message = {"task_data": task_data, "response_channel": UI_NOTIFICATION_CHANNEL}
            await client.publish(task_channel, json.dumps(message))
        await client.close()
        return result

    if mode == "k8s":
        # K8s-based scheduling via orchestrator scheduling service
        from services.orchestrator.app.scheduling import SchedulingService

        scheduler = SchedulingService()
        job_id = scheduler.scheduleWorkflow(flow.meta.id, cron or "")
        result["scheduled_job_id"] = job_id
        return result

    return result
