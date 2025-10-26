from fastapi import APIRouter, HTTPException, status, Query
import json
from pathlib import Path
from typing import Any

from services.gateway.app.models import Flow
# from app.validation import validation_middleware, ValidationMode
from services.gateway.app.streaming import streaming_manager, StreamEventType, StreamMessage

# Temporary mock for validation
class ValidationMode:
    STRICT = "strict"
    PERMISSIVE = "permissive"
    DISABLED = "disabled"
    
    def __init__(self, value):
        self.value = value

async def validation_middleware(flow_dict, mode):
    # Mock validation - always passes
    return True, {"errors": [], "warnings": []}

router = APIRouter()

# Load example flows at startup (optional - only if examples directory exists)
FLOWS_DIR = Path(__file__).resolve().parents[3] / "examples"
_flows = {}

# Try to load example flows if they exist
try:
    if FLOWS_DIR.exists() and (FLOWS_DIR / "hello_chat.json").exists():
        _flows["hello_chat"] = json.loads((FLOWS_DIR / "hello_chat.json").read_text())
except Exception as e:
    # Examples not available - that's okay for production deployments
    import logging
    logging.warning(f"Could not load example flows: {e}")


@router.get("/{flow_id}")
async def get_flow(flow_id: str):
    if flow_id not in _flows:
        raise HTTPException(status_code=404, detail="Flow not found")
    return _flows[flow_id]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_flow(
    flow: Flow,
    mode: str = Query("plan", description="Execution mode: plan, redis, k8s, or streaming"),
    cron: str | None = Query(None, description="Cron schedule for k8s mode"),
    validation_mode: str = Query("strict", description="Validation mode: strict, permissive, or disabled"),
    streaming_enabled: bool = Query(False, description="Enable streaming for compatible agents"),
):
    """Create and execute a flow: plan-only, Redis-based, k8s-based, or streaming execution."""
    
    # Parse validation mode
    try:
        val_mode = ValidationMode(validation_mode.lower())
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid validation mode. Must be one of: {[m.value for m in ValidationMode]}"
        )
    
    # Validate flow before processing
    flow_dict = flow.model_dump()
    is_valid, validation_info = await validation_middleware(flow_dict, val_mode)
    
    # Handle validation results based on mode
    if not is_valid and val_mode == ValidationMode.STRICT:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Flow validation failed",
                "validation_errors": validation_info["errors"],
                "validation_warnings": validation_info["warnings"]
            }
        )
    
    # Mock execution plan for now
    execution_plan = [node.id for node in flow.graph.nodes]
    result: dict[str, Any] = {
        "execution_plan": execution_plan,
        "validation": validation_info
    }

    if mode == "redis":
        # Lightweight execution: publish tasks to Redis and UI events channel
        import redis.asyncio as redis
        from app.websockets import UI_NOTIFICATION_CHANNEL

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
        # K8s-based scheduling - mock for now
        result["scheduled_job_id"] = f"mock-job-{flow.meta.id}"
        return result
    
    if mode == "streaming":
        # Streaming execution mode
        streaming_sessions = []
        
        # Identify streaming-capable agents in the flow
        node_map = {node.id: node for node in flow.graph.nodes}
        for node_id in execution_plan:
            node = node_map.get(node_id)
            if not node or node.type.startswith("ui."):
                continue
            
            # Check if agent supports streaming (simplified check)
            # In a real implementation, this would check agent manifest
            supports_streaming = streaming_enabled and not node.type.startswith("static.")
            
            if supports_streaming:
                try:
                    # Create streaming session for this agent
                    session = await streaming_manager.create_stream_session(
                        agent_id=node_id,
                        pin_name="output"
                    )
                    streaming_sessions.append({
                        "node_id": node_id,
                        "stream_id": session.stream_id,
                        "ws_url": f"/ws/streams/{session.stream_id}",
                        "sse_url": f"/api/v1/streams/{session.stream_id}/sse"
                    })
                except Exception as e:
                    # Log error but continue with other nodes
                    pass
        
        result["streaming_sessions"] = streaming_sessions
        result["execution_mode"] = "streaming"
        
        # Also publish to UI events for traditional flow monitoring
        import redis.asyncio as redis
        client = redis.from_url("redis://localhost", decode_responses=True)
        await client.publish(
            "orchestrator_ui_events",
            json.dumps({
                "type": "streaming_flow_start",
                "flow_id": flow.meta.id,
                "streaming_sessions": streaming_sessions
            })
        )
        await client.close()
        
        return result

    return result

# Validation endpoints for the gateway
@router.post("/validate", status_code=status.HTTP_200_OK)
async def validate_flow(
    flow: Flow,
    validation_mode: str = Query("strict", description="Validation mode: strict, permissive, or disabled"),
):
    """Validate a flow without executing it."""
    
    # Parse validation mode
    try:
        val_mode = ValidationMode(validation_mode.lower())
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid validation mode. Must be one of: {[m.value for m in ValidationMode]}"
        )
    
    # Validate flow
    flow_dict = flow.model_dump()
    is_valid, validation_info = await validation_middleware(flow_dict, val_mode)
    
    return {
        "valid": is_valid,
        "validation_mode": validation_mode,
        "validation_info": validation_info
    }
