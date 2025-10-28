from typing import List, Dict, Any, Optional, AsyncIterator
from graphlib import TopologicalSorter
import asyncio
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import os
import logging
from kubernetes.client.rest import ApiException as K8sApiException
import threading
import subprocess
import json
import requests
import time as _time
from fastapi.responses import StreamingResponse
from collections import deque
import uuid
# New: pluggable RunStore
from services.orchestrator.app.runstore import RunStore, Event, get_store_from_env
# ADD: subprocess driver
from services.orchestrator.app.subprocess_driver import LocalSubprocessDriver
# NEW: scheduler integration
from services.orchestrator.app.scheduler import (
    Scheduler,
    RunSpec as _SchedRunSpec,
    NodeSpec as _SchedNodeSpec,
    EdgeSpec as _SchedEdgeSpec,
)

from services.gateway.app.models import Flow, Node, Edge, Meta, Graph, Position
from services.orchestrator.app.execution import ExecutionEngine, ExecutionResult
from services.orchestrator.app.scheduling import SchedulingService
from services.orchestrator.app.resources import ResourceManager
from services.orchestrator.app.manifest_validator import (
    validate_agent_manifest,
    ManifestValidator,
    ValidationMode,
    ValidationResult
)
from services.orchestrator.app.telemetry import setup_telemetry, span, otel_enabled, enrich_current_span
from services.orchestrator.app.context import ExecutionIdMiddleware, add_execution_id_log_filter

# Request/Response models for new endpoints
class AgentScheduleRequest(BaseModel):
    agent_manifest: Dict[str, Any]
    inputs: Dict[str, Any] = {}
    execution_id: Optional[str] = None
    skip_validation: bool = False

class JobStatusResponse(BaseModel):
    job_id: str
    status: Dict[str, Any]

class ValidationRequest(BaseModel):
    agent_manifest: Dict[str, Any]
    validation_mode: Optional[str] = None

class ValidationResponse(BaseModel):
    valid: bool
    errors: List[str] = []
    warnings: List[str] = []
    validation_mode: str

def create_execution_plan(flow: Flow) -> List[str]:
    """
    Generates an execution plan (topologically sorted list of node IDs)
    from a given Flow object.

    Args:
        flow: The Flow object containing the graph definition.

    Returns:
        A list of node IDs in the correct execution order.

    Raises:
        ValueError: If the flow graph contains a cycle.
    """
    graph_dependencies = {}

    # Initialize graph with all nodes and no dependencies
    for node in flow.graph.nodes:
        graph_dependencies[node.id] = set()

    # Populate dependencies from edges
    for edge in flow.graph.edges:
        from_node_id = edge.from_node.split('.')[0]
        to_node_id = edge.to_node.split('.')[0]
        
        # Ensure both nodes exist in the graph (they should, if flow is valid)
        if from_node_id not in graph_dependencies:
            graph_dependencies[from_node_id] = set()
        if to_node_id not in graph_dependencies:
            graph_dependencies[to_node_id] = set()

        # Add dependency: to_node depends on from_node
        graph_dependencies[to_node_id].add(from_node_id)

    # Trace plan creation with useful attributes when telemetry is enabled
    with span(
        "orchestrator.create_execution_plan",
        {
            "node_count": len(flow.graph.nodes),
            "edge_count": len(flow.graph.edges),
        },
    ):
        try:
            sorter = TopologicalSorter(graph_dependencies)
            execution_plan = list(sorter.static_order())
            return execution_plan
        except Exception as e:
            # graphlib.TopologicalSorter raises ValueError for cycles
            raise ValueError(f"Flow graph contains a cycle or is invalid: {e}")

_ORCH_EXEC_ID_HEADER = os.getenv("ORCH_EXECUTION_ID_HEADER", "X-Execution-Id")
_ORCH_GEN_EXEC_ID = os.getenv("ORCH_GENERATE_EXECUTION_ID_IF_MISSING", "true").lower() in ("1", "true", "yes")

# New: global store instance
STORE: RunStore | None = None
# New: global driver instance
DRIVER: LocalSubprocessDriver | None = None
# NEW: global scheduler instance
SCHEDULER: Scheduler | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI app startup and shutdown"""
    global STORE, DRIVER, SCHEDULER

    # Startup
    STORE = await get_store_from_env()
    # Initialize LocalSubprocessDriver with repo_root as cwd for module resolution
    try:
        DRIVER = LocalSubprocessDriver(STORE, env_passthrough={}, cwd=str(repo_root))
    except Exception:
        DRIVER = None
    # NEW: initialize Scheduler with command resolution callback
    def _resolve_cmd_for_scheduler(ns: _SchedNodeSpec) -> list[str]:
        p = ns.params or {}
        # 1) explicit cmd list
        cmd = p.get("cmd")
        if isinstance(cmd, list) and cmd:
            return [str(x) for x in cmd]
        # 2) agent presets
        if ns.agent == "echo":
            args = p.get("args") or []
            return ["echo", *[str(a) for a in args]]
        if ns.agent == "python":
            # Prefer args list if provided, else support inline code via 'code'
            args = p.get("args") or []
            if args:
                return ["python", *[str(a) for a in args]]
            code = p.get("code")
            if code:
                return ["python", "-c", str(code)]
        # 3) generic fallback: if args appears to be a command vector
        args = p.get("args") or []
        if isinstance(args, list) and args:
            return [str(args[0]), *[str(a) for a in args[1:]]]
        raise ValueError(f"Cannot resolve command for node {ns.id} (agent={ns.agent})")
    if STORE is not None and DRIVER is not None:
        SCHEDULER = Scheduler(
            STORE,
            DRIVER,
            resolve_cmd=_resolve_cmd_for_scheduler,
        )
    else:
        SCHEDULER = None

    yield

    # Shutdown (cleanup if needed)
    pass

app = FastAPI(
    title="Orchestrator Service",
    description="Service for managing and executing AI workflows.",
    version="0.1.0",
    lifespan=lifespan,
)

def _ensure_store() -> RunStore:
    if STORE is None:
        raise RuntimeError("RunStore not initialized")
    return STORE

# Add CORS middleware configuration
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
    allow_headers=["*"],
    expose_headers=["*"],
)

# Serve agent UI assets (agents/*/ui/*) so remoteEntry.js can be fetched from the browser.
# Resolve the agents directory relative to the repository root (two parents up from this file).
repo_root = Path(__file__).resolve().parents[3]
agents_dir = repo_root / "agents"
if agents_dir.exists():
    app.mount("/agents", StaticFiles(directory=str(agents_dir), html=False), name="agents")
else:
    logger = logging.getLogger("uvicorn.error")
    logger.warning(f"Agents directory not found at {agents_dir}; static agent UIs will not be served.")

# Initialize services
execution_engine = ExecutionEngine()
resource_manager = ResourceManager()

# Lazy initialization of scheduling service
_scheduling_service = None

def get_scheduling_service() -> SchedulingService:
    """Get or create the scheduling service instance."""
    global _scheduling_service
    if _scheduling_service is None:
        _scheduling_service = SchedulingService()
    return _scheduling_service

# Helper: run local agent process and forward NDJSON stdout to Gateway streaming API.
def _run_local_agent_and_forward(agent_manifest: dict, inputs: dict, execution_id: Optional[str], resource_id: str, precreated_stream: Optional[Dict[str, Any]] = None) -> None:
    """
    Best-effort local dev helper:
    - Creates a gateway stream via POST /api/v1/streams/init
    - Spawns the agent process (assumes source checkout available at agents/<agent>/src/main.py)
    - Forwards each JSON line from stdout to /api/v1/streams/{stream_id}/publish
    - Deletes/ends the stream when the agent exits
    This function is intentionally forgiving and logs failures without raising.
    """
    try:
        agent_id = agent_manifest.get("id", "unknown-agent")
        gw_base = os.getenv("GATEWAY_BASE_URL", "http://127.0.0.1:8080")  # default to local gateway used by run-local-dev.sh
        logger = logging.getLogger("orchestrator.local-forward")

        logger.info(f"Local forward: initializing gateway stream for agent {agent_id} (resource={resource_id})")

        try:
            if precreated_stream and precreated_stream.get("stream_id"):
                stream_info = precreated_stream
                stream_id = stream_info.get("stream_id")
                ws_url = stream_info.get("ws_url")
                sse_url = stream_info.get("sse_url")
                logger.info(f"Local forward: using precreated stream {stream_id}")
            else:
                resp = requests.post(f"{gw_base}/api/v1/streams/init", json={"agent_id": agent_id, "pin_name": "output"}, timeout=5)
                resp.raise_for_status()
                stream_info = resp.json()
                stream_id = stream_info.get("stream_id")
                ws_url = stream_info.get("ws_url")
                sse_url = stream_info.get("sse_url")
                logger.info(f"Local forward: created stream {stream_id} (ws={ws_url} sse={sse_url})")
        except Exception as e:
            logger.warning(f"Local forward: failed to init gateway stream: {e}")
            return

        # Prepare payload for agent stdin
        stdin_payload = {
            "spec": inputs.get("spec", {}),
            "context": inputs.get("context", {}),
            "execution_id": execution_id
        }

        # Resolve local agent runner path (best-effort)
        agent_id_safe = agent_manifest.get("id", "").replace(".", "-")
        # Prefer local source in repository: resolve paths relative to repo_root
        # Use repo_root (defined at module top) to construct absolute candidate paths.
        agent_runner = None
        possible_paths = [
            repo_root / "agents" / agent_manifest.get("id") / "src" / "main.py",
            repo_root / "agents" / "psyche-sim" / "src" / "main.py",
            repo_root / "agents" / "ctm-cogpack" / "src" / "main.py",
        ]
        for p in possible_paths:
            p_str = str(p)
            if os.path.isfile(p_str):
                agent_runner = p_str
                break

        if not agent_runner:
            logger.warning(f"Local forward: agent runner not found in repository for {agent_id}; expected one of {possible_paths}")
            return

        # Spawn the agent process
        try:
            proc = subprocess.Popen(
                ["python3", agent_runner],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1  # line buffered
            )
            # Write JSON input to stdin (single-line)
            try:
                proc.stdin.write(json.dumps(stdin_payload) + "\n")
                proc.stdin.flush()
                proc.stdin.close()
            except Exception:
                # If writing fails, continue and attempt to read stdout anyway
                pass

            logger.info(f"Local forward: spawned agent process pid={proc.pid} for {agent_id}")
        except Exception as e:
            logger.error(f"Local forward: failed to spawn agent process: {e}")
            return

        # Read stdout line-by-line and forward to gateway publish endpoint
        publish_url = f"{gw_base}/api/v1/streams/{stream_id}/publish"
        try:
            # Use iterator to avoid blocking forever
            for raw_line in proc.stdout:
                if raw_line is None:
                    break
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except Exception:
                    # If not JSON, wrap it
                    payload = {"text": line}
                try:
                    # Best-effort POST; do not block scheduler
                    resp = requests.post(publish_url, json=payload, timeout=2)
                    # Log non-2xx/3xx responses for better diagnostics in local-dev
                    if resp is not None and resp.status_code >= 400:
                        try:
                            text = resp.text
                        except Exception:
                            text = "<no body>"
                        logger.warning(f"Local forward: publish returned {resp.status_code}: {text[:200]}")
                except Exception as e:
                    logger.debug(f"Local forward: failed to publish stream data (ignored): {e}")
            # Drain remaining stdout if any
        except Exception as e:
            logger.error(f"Local forward: error while reading agent stdout: {e}")
        finally:
            # Ensure process termination and read stderr for diagnostics
            try:
                # Give process a short grace to exit
                proc.wait(timeout=1)
            except Exception:
                try:
                    proc.terminate()
                except Exception:
                    pass
            try:
                stderr = proc.stderr.read() if proc.stderr is not None else ""
                if stderr:
                    logger.debug(f"Local forward: agent stderr: {stderr}")
            except Exception:
                pass

            # End the stream on gateway. Add a short grace so UI can subscribe after /schedule returns.
            try:
                _time.sleep(0.5)
                requests.delete(f"{gw_base}/api/v1/streams/{stream_id}", timeout=2)
            except Exception:
                # If delete not available, attempt to publish a final stream_end envelope
                try:
                    requests.post(publish_url, json={"type": "stream_end", "data": {"message": "agent process ended"}}, timeout=2)
                except Exception:
                    pass

        logger.info(f"Local forward: finished forwarding for stream {stream_id}")

    except Exception as exc:
        # Never raise from background thread
        logging.getLogger("orchestrator.local-forward").exception(f"Local forward unexpected error: {exc}")

@app.post("/execute/{workflow_id}", response_model=ExecutionResult)
async def execute_workflow_endpoint(workflow_id: str, inputs: Dict[str, Any]):
    """
    Executes a workflow with the given ID and inputs.
    """
    result = execution_engine.executeWorkflow(workflow_id, inputs)
    return result

@app.post("/pause/{execution_id}", response_model=ExecutionResult)
async def pause_execution_endpoint(execution_id: str):
    """
    Pauses a running workflow execution.
    """
    result = execution_engine.pauseExecution(execution_id)
    return result

@app.post("/resume/{execution_id}", response_model=ExecutionResult)
async def resume_execution_endpoint(execution_id: str):
    """
    Resumes a paused workflow execution.
    """
    result = execution_engine.resumeExecution(execution_id)
    return result

@app.post("/abort/{execution_id}", response_model=ExecutionResult)
async def abort_execution_endpoint(execution_id: str):
    """
    Aborts a running workflow execution.
    """
    result = execution_engine.abortExecution(execution_id)
    return result

@app.get("/status/{execution_id}", response_model=ExecutionResult)
async def get_execution_status_endpoint(execution_id: str):
    """
    Gets the current status of a workflow execution.
    """
    result = execution_engine.getExecutionStatus(execution_id)
    return result

@app.post("/schedule/{workflow_id}")
async def schedule_workflow_endpoint(workflow_id: str, cron_schedule: str, request: Request):
    """
    Schedules a workflow to run periodically using a cron schedule.
    """
    # Ensure the current server span (from instrumentation) is enriched with execution_id
    if otel_enabled():
        exec_id = getattr(request.state, "execution_id", None)
        if exec_id:
            enrich_current_span({"execution_id": exec_id})

    # Trace scheduling when enabled
    with span("orchestrator.schedule_workflow", {"workflow_id": workflow_id}):
        job_id = get_scheduling_service().scheduleWorkflow(workflow_id, cron_schedule)
    return {"scheduled_job_id": job_id}

@app.post("/resources/allocate/{workflow_id}")
async def allocate_resources_endpoint(workflow_id: str, requirements: Dict[str, Any]):
    """
    Allocates resources for a workflow.
    """
    result = resource_manager.allocateResources(workflow_id, requirements)
    return result

@app.get("/resources/monitor/{resource_id}")
async def monitor_usage_endpoint(resource_id: str):
    """
    Monitors resource usage for a given resource ID.
    """
    result = resource_manager.monitorUsage(resource_id)
    return result

@app.post("/resources/scale/{resource_id}")
async def scale_resources_endpoint(resource_id: str, scale_factor: float):
    """
    Scales resources for a given resource ID.
    """
    result = resource_manager.scaleResources(resource_id, scale_factor)
    return result

@app.post("/resources/quotas/{user_id}")
async def enforce_quotas_endpoint(user_id: str):
    """
    Enforces resource quotas for a given user ID.
    """
    result = resource_manager.enforceQuotas(user_id)
    return result

# New Kubernetes scheduling endpoints
@app.post("/api/v1/agents/schedule")
async def schedule_agent_endpoint(request: AgentScheduleRequest, _req: Request):
    """
    Schedule an individual agent as a Kubernetes Job or Deployment.
    """
    # Ensure the current server span (from instrumentation) is enriched with execution_id
    if otel_enabled():
        exec_id = getattr(_req.state, "execution_id", None)
        if exec_id:
            enrich_current_span({"execution_id": exec_id})

    try:
        agent_id = request.agent_manifest.get("id", "unknown-agent")
        is_long_running = bool(request.agent_manifest.get("longRunning", False))
        with span(
            "orchestrator.schedule_agent",
            {"agent_id": agent_id, "long_running": is_long_running},
        ):
            # Pre-create a stream for UI to attach to
            stream_info: Dict[str, Any] = {}
            try:
                gw_base = os.getenv("GATEWAY_BASE_URL", "http://gateway:8080")
                r = requests.post(f"{gw_base}/api/v1/streams/init", json={"agent_id": agent_id, "pin_name": "output"}, timeout=5)
                r.raise_for_status()
                stream_info = r.json() or {}
            except Exception as e:
                logging.getLogger("orchestrator.schedule_agent").warning(f"Failed to pre-create stream: {e}")
            try:
                resource_id = get_scheduling_service().scheduleAgent(
                    request.agent_manifest,
                    request.inputs,
                    request.execution_id,
                    request.skip_validation
                )
            except K8sApiException as k8s_e:
                logging.getLogger("orchestrator.schedule_agent").warning(
                    f"K8s scheduling failed ({getattr(k8s_e, 'status', 'unknown')}): {getattr(k8s_e, 'reason', '')}. Falling back to local run."
                )
                # Create a synthetic resource id for the local run
                local_res_id = f"{agent_id}-local-{uuid.uuid4().hex[:8]}"
                try:
                    t = threading.Thread(
                        target=_run_local_agent_and_forward,
                        args=(request.agent_manifest, request.inputs, request.execution_id, local_res_id, stream_info if stream_info else None),
                        daemon=True
                    )
                    t.start()
                except Exception:
                    logging.getLogger("orchestrator.local-forward").exception("Local forward fallback failed")
                return {"resource_id": local_res_id, "status": "scheduled-local", "stream_id": stream_info.get("stream_id"), "ws_url": stream_info.get("ws_url"), "sse_url": stream_info.get("sse_url")}            
        # If this is the local psyche-sim agent, spawn a background thread to run it locally
        try:
            if agent_id in ("mentatlab.psyche-sim", "mentatlab.ctm-cogpack"):
                t = threading.Thread(
                    target=_run_local_agent_and_forward,
                    args=(request.agent_manifest, request.inputs, request.execution_id, resource_id, stream_info if stream_info else None),
                    daemon=True
                )
                t.start()
                logging.getLogger("orchestrator.local-forward").info(f"Started local forward thread for {resource_id}")
        except Exception:
            logging.getLogger("orchestrator.local-forward").exception("Failed to start local forwarding thread")
        return {"resource_id": resource_id, "status": "scheduled", "stream_id": stream_info.get("stream_id"), "ws_url": stream_info.get("ws_url"), "sse_url": stream_info.get("sse_url")}
    except ValueError as e:
        # Validation errors
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to schedule agent: {str(e)}")

@app.get("/jobs/{job_id}/status", response_model=JobStatusResponse)
async def get_job_status_endpoint(job_id: str):
    """
    Get the status of a scheduled job or deployment.
    """
    try:
        status = get_scheduling_service().getJobStatus(job_id)
        return JobStatusResponse(job_id=job_id, status=status)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get job status: {str(e)}")

@app.delete("/jobs/{job_id}")
async def cleanup_job_endpoint(job_id: str):
    """
    Clean up a completed or failed job.
    """
    try:
        success = get_scheduling_service().cleanupJob(job_id)
        if success:
            return {"message": f"Job {job_id} cleaned up successfully"}
        else:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to cleanup job: {str(e)}")

# Manifest validation endpoints
@app.post("/agents/validate", response_model=ValidationResponse)
async def validate_agent_manifest_endpoint(request: ValidationRequest):
    """
    Validate an agent manifest against the schema.
    """
    try:
        # Parse validation mode if provided
        validation_mode = None
        if request.validation_mode:
            try:
                validation_mode = ValidationMode(request.validation_mode.lower())
            except ValueError:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid validation mode. Must be one of: {[m.value for m in ValidationMode]}"
                )
        
        # Get the validator and set the mode if provided
        from services.orchestrator.app.manifest_validator import get_validator
        validator = get_validator()
        
        if validation_mode:
            validator.set_validation_mode(validation_mode)
        
        # Perform validation
        result = validate_agent_manifest(request.agent_manifest)
        
        # Get the actual mode used
        actual_mode = validator.validation_mode.value
        
        return ValidationResponse(
            valid=result.is_valid,
            errors=result.errors,
            warnings=result.warnings,
            validation_mode=actual_mode
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Validation failed: {str(e)}")

@app.get("/agents/validation/config")
async def get_validation_config():
    """
    Get current validation configuration.
    """
    try:
        validator = ManifestValidator.from_config()
        return {
            "validation_mode": validator.validation_mode.value,
            "available_modes": [mode.value for mode in ValidationMode],
            "schema_loaded": validator.schema is not None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get validation config: {str(e)}")

@app.put("/agents/validation/config")
async def update_validation_config(
    validation_mode: str = Query(..., description="Validation mode to set")
):
    """
    Update validation configuration.
    """
    try:
        # Validate the mode
        try:
            mode = ValidationMode(validation_mode.lower())
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid validation mode. Must be one of: {[m.value for m in ValidationMode]}"
            )
        
        # Update global validator
        from services.orchestrator.app.manifest_validator import get_validator
        validator = get_validator()
        validator.set_validation_mode(mode)
        
        return {
            "message": f"Validation mode updated to {mode.value}",
            "validation_mode": mode.value
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update validation config: {str(e)}")

@app.get("/healthz")
async def healthz():
    """Health check endpoint."""
    return {"status": "healthy"}

# New: Local agent catalog endpoint - scans agents/*/manifest.yaml and returns a list for the frontend
import glob
from pathlib import Path
import yaml as _yaml  # local alias to avoid collision with pydantic's yaml usage

@app.get("/api/v1/agents")
async def list_local_agents():
    """
    Return a list of locally-available agent manifests for the frontend catalog.
    Scans agents/*/manifest.yaml and returns a simplified representation.
    """
    agents_root = repo_root / "agents"
    manifests = []
    try:
        for manifest_path in sorted(agents_root.glob("*/manifest.yaml")):
            try:
                with open(manifest_path, "r") as f:
                    manifest = _yaml.safe_load(f)
                # Normalize manifest to a frontend-friendly shape
                agent_entry = {
                    "id": manifest.get("id"),
                    "version": manifest.get("version"),
                    "image": manifest.get("image"),
                    "description": manifest.get("description"),
                    "runtime": manifest.get("runtime"),
                    "longRunning": manifest.get("longRunning", False),
                    "ui": manifest.get("ui", {}),
                    "inputs": manifest.get("inputs", []),
                    "outputs": manifest.get("outputs", []),
                    "manifest_path": str(manifest_path)
                }
                manifests.append(agent_entry)
            except Exception:
                # skip invalid manifests but continue scanning
                continue
        return manifests
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list local agents: {exc}")

# ========== Minimal Orchestrator: Models, Store, SSE Hub, Executor, Endpoints (/api/v1) ==========

# Pydantic models for a lightweight plan/run API
class PlanNode(BaseModel):
    id: str
    agent: str
    params: Dict[str, Any] | None = None
    retry: Dict[str, Any] | None = None
    timeoutMs: int | None = None
    # NEW: accept scheduler-related overrides directly at node level
    max_retries: int | None = None
    backoff_seconds: int | None = None

class PlanEdge(BaseModel):
    from_node: str
    to_node: str

class RunPlan(BaseModel):
    nodes: List[PlanNode]
    edges: List[PlanEdge] = []

class CreateRunRequest(BaseModel):
    name: str
    plan: RunPlan
    options: Dict[str, Any] | None = None

class NodeState(BaseModel):
    status: str  # queued|running|succeeded|failed|cancelled
    attempts: int = 0
    startedAt: Optional[str] = None
    finishedAt: Optional[str] = None
    durationMs: Optional[int] = None
    error: Optional[str] = None

class RunSnapshot(BaseModel):
    runId: str
    status: str
    startedAt: Optional[str] = None
    finishedAt: Optional[str] = None
    nodes: Dict[str, NodeState] = {}

# Basic executor: simulate node execution sequentially (topological order naive)
# NOTE: legacy executor retained but not used by new endpoints; keeping for compatibility.
async def _execute_run(run_id: str, plan: RunPlan) -> None:
    store = _ensure_store()
    # Mark run as running
    started_iso = datetime.utcnow().isoformat() + "Z"
    await store.update_run_status(run_id, "running", started_at=started_iso)
    await store.append_event(run_id, "hello", {"runId": run_id})
    await store.append_event(run_id, "status", {"runId": run_id, "status": "running"})

    # Build simple adjacency & indegree from edges (ids only)
    indegree: Dict[str, int] = {n.id: 0 for n in plan.nodes}
    graph: Dict[str, List[str]] = {n.id: [] for n in plan.nodes}
    for e in plan.edges:
        if e.from_node in graph and e.to_node in indegree:
            graph[e.from_node].append(e.to_node)
            indegree[e.to_node] += 1

    ready = [nid for nid, deg in indegree.items() if deg == 0]
    node_by_id = {n.id: n for n in plan.nodes}

    try:
        while ready:
            # Cancellation check via status (best-effort)
            meta = await store.get_run_meta(run_id)
            if meta.get("status") == "cancelled":
                await store.append_event(run_id, "status", {"runId": run_id, "status": "cancelled"})
                break

            nid = ready.pop(0)
            n = node_by_id[nid]

            # Start node: update node state (driver will emit node_status events)
            started = datetime.utcnow().isoformat() + "Z"
            node_state = {
                "status": "running",
                "attempts": int((meta.get("nodes", {}).get(nid, {}) or {}).get("attempts", 0)) + 1,
                "startedAt": started,
                "finishedAt": None,
                "durationMs": None,
                "error": None,
            }
            await store.update_node_state(run_id, nid, node_state)

            # Resolve command and invoke driver
            cmd: List[str] = _resolve_node_command(n)
            timeout_s: Optional[float] = None
            if n.timeoutMs and n.timeoutMs > 0:
                try:
                    timeout_s = float(n.timeoutMs) / 1000.0
                except Exception:
                    timeout_s = None

            exit_code = 1
            try:
                if DRIVER is None:
                    # Failsafe: if driver not initialized, log and treat as failure
                    await store.append_event(run_id, "log", {"runId": run_id, "nodeId": nid, "level": "error", "message": "driver not initialized"})
                else:
                    exit_code = await DRIVER.run_node(run_id, nid, cmd, timeout=timeout_s)
            except Exception as exc:
                await store.append_event(run_id, "log", {"runId": run_id, "nodeId": nid, "level": "error", "message": f"node execution error: {exc}"})
                exit_code = 1

            # Complete node: update state (driver already emitted node_status)
            finished = datetime.utcnow().isoformat() + "Z"
            duration_ms = None
            try:
                start_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
                end_dt = datetime.fromisoformat(finished.replace("Z", "+00:00"))
                duration_ms = int((end_dt - start_dt).total_seconds() * 1000)
            except Exception:
                pass

            status_str = "succeeded" if exit_code == 0 else "failed"
            error_msg = None if exit_code == 0 else f"exit_code={exit_code}"
            node_state.update({"status": status_str, "finishedAt": finished, "durationMs": duration_ms, "error": error_msg})
            await store.update_node_state(run_id, nid, node_state)

            # Unlock neighbors (keep minimal semantics as before)
            for m in graph.get(nid, []):
                indegree[m] -= 1
                if indegree[m] == 0:
                    ready.append(m)

        # Final status
        meta = await store.get_run_meta(run_id)
        if meta.get("status") not in ("cancelled", "failed"):
            any_failed = any((ns or {}).get("status") == "failed" for ns in (meta.get("nodes") or {}).values())
            final = "failed" if any_failed else "succeeded"
            finished_iso = datetime.utcnow().isoformat() + "Z"
            await store.update_run_status(run_id, final, finished_at=finished_iso)
            await store.append_event(run_id, "status", {"runId": run_id, "status": final})
    except Exception as exc:
        finished_iso = datetime.utcnow().isoformat() + "Z"
        await store.update_run_status(run_id, "failed", finished_at=finished_iso)
        await store.append_event(run_id, "log", {"runId": run_id, "level": "error", "message": f"run executor error: {exc}"})
        await store.append_event(run_id, "status", {"runId": run_id, "status": "failed"})

# SSE stream utilities
async def _sse_event_stream(run_id: str, resume_from_id: Optional[str]) -> AsyncIterator[bytes]:
    store = _ensure_store()

    # Backfill using RunStore
    if resume_from_id:
        try:
            backfill = await store.get_events_since(run_id, resume_from_id)
            for evt in backfill:
                yield evt.to_sse()
        except KeyError:
            return
    else:
        # Emit immediate hello event to preserve previous behavior
        evt = await store.append_event(run_id, "hello", {"runId": run_id})
        yield evt.to_sse()

    # Live subscribe
    try:
        async for evt in store.subscribe(run_id):
            yield evt.to_sse()
    except asyncio.CancelledError:
        return

# Endpoints
@app.get("/ready")
async def ready():
    return {"ok": True}

# New: adapter info/debug route
@app.get("/api/v1/runstore/info")
async def runstore_info():
    store = _ensure_store()
    return await store.adapter_info()

# New: lightweight self-check to verify adapter works end-to-end
@app.get("/api/v1/runstore/selfcheck")
async def runstore_selfcheck():
    store = _ensure_store()
    # create ephemeral run and append a couple of events
    run_id = await store.create_run("selfcheck", {"nodes": [], "edges": []})
    await store.append_event(run_id, "status", {"runId": run_id, "status": "queued"})
    last_evt = await store.append_event(run_id, "log", {"runId": run_id, "message": "selfcheck"})
    # backfill from seq 0 (full)
    backfill = await store.get_events_since(run_id, "0")
    return {
        "adapter": (await store.adapter_info()).get("adapter"),
        "runId": run_id,
        "events_backfilled": len(list(backfill)),
        "last_event_id": last_evt.id,
    }

# ADD: Debug endpoint to kick off a trivial NDJSON-emitting run
@app.post("/api/v1/debug/runs/ndjson")
async def debug_run_ndjson():
    """
    Start a run with a single node that emits a few NDJSON lines to stdout and an error to stderr.
    Returns: { runId }
    """
    store = _ensure_store()
    # One-liner Python program that emits NDJSON on stdout and a line on stderr
    py = (
        "import json,sys,time;"
        "print(json.dumps({'type':'log','level':'info','message':'hello from debug node'}));"
        "sys.stdout.flush();"
        "time.sleep(0.05);"
        "print(json.dumps({'type':'checkpoint','label':'mid','data':{'progress':50}}));"
        "sys.stdout.flush();"
        "time.sleep(0.05);"
        "print(json.dumps({'type':'log','level':'info','message':'almost done'}));"
        "sys.stdout.flush();"
        "time.sleep(0.02);"
        "sys.stderr.write('this is stderr\\n');"
        "sys.stderr.flush();"
    )
    node = PlanNode(id="demo", agent="python", params={"cmd": ["python", "-c", py]})
    plan = RunPlan(nodes=[node], edges=[])
    run_id = await store.create_run("debug-ndjson", plan.model_dump())
    # Initial status event (queued)
    await store.append_event(run_id, "status", {"runId": run_id, "status": "queued"})
    # Legacy background run for this endpoint (kept as-is)
    asyncio.create_task(_execute_run(run_id, plan))
    return {"runId": run_id}

# New: Debug endpoint for a small DAG with retry behavior
@app.post("/api/v1/debug/runs/dag")
async def debug_dag_run():
    """
    Enqueue a simple 3-node DAG:
      n1 -> n2, n1 -> n3
    - n2 always succeeds
    - n3 fails once then succeeds on retry (based on ATTEMPT env)
    Returns: { runId }
    """
    store = _ensure_store()
    if SCHEDULER is None:
        raise HTTPException(status_code=503, detail="scheduler not initialized")
    # Node commands
    py_success = "import sys, json; print(json.dumps({'type':'log','message':'n2 ok'})); sys.exit(0)"
    # n3: fail on first attempt, succeed on second+
    py_flaky = (
        "import os,sys,json;"
        "att=int(os.getenv('ATTEMPT','1'));"
        "print(json.dumps({'type':'log','message':f'n3 attempt {att}'}));"
        "sys.stdout.flush();"
        "sys.exit(1 if att==1 else 0)"
    )
    # Build plan compatible with existing PlanNode/PlanEdge (frontend/gateway format)
    plan = RunPlan(
        nodes=[
            PlanNode(id="n1", agent="echo", params={"args": ["A"]}, max_retries=0, backoff_seconds=2),
            PlanNode(id="n2", agent="python", params={"cmd": ["python", "-c", py_success]}, max_retries=0, backoff_seconds=2),
            PlanNode(id="n3", agent="python", params={"cmd": ["python", "-c", py_flaky]}, max_retries=1, backoff_seconds=1),
        ],
        edges=[
            PlanEdge(from_node="n1.out", to_node="n2.in"),
            PlanEdge(from_node="n1.out", to_node="n3.in"),
        ],
    )
    run_id = await store.create_run("dag-debug", plan.model_dump())
    # Emit queued
    await store.append_event(run_id, "status", {"runId": run_id, "status": "queued"})
    # Convert to scheduler RunSpec
    created_at = datetime.utcnow().isoformat() + "Z"
    sched_nodes = [
        _SchedNodeSpec(id="n1", agent="echo", params={"args": ["A"]}, max_retries=0, backoff_seconds=2),
        _SchedNodeSpec(id="n2", agent="python", params={"cmd": ["python", "-c", py_success]}, max_retries=0, backoff_seconds=2),
        _SchedNodeSpec(id="n3", agent="python", params={"cmd": ["python", "-c", py_flaky]}, max_retries=1, backoff_seconds=1),
    ]
    sched_edges = [
        _SchedEdgeSpec(src="n1", dst="n2"),
        _SchedEdgeSpec(src="n1", dst="n3"),
    ]
    run_spec = _SchedRunSpec(
        run_id=run_id,
        name="dag-debug",
        created_at=created_at,
        plan_nodes=sched_nodes,
        plan_edges=sched_edges,
    )
    await SCHEDULER.enqueue_run(run_spec)
    asyncio.create_task(SCHEDULER.start_run(run_id))
    return {"runId": run_id}

@app.post("/api/v1/runs")
async def create_run(req: CreateRunRequest):
    """
    Create a run, enqueue it with the scheduler, and start execution promptly.
    """
    store = _ensure_store()
    # Dry run: return plan as-is
    if req.options and req.options.get("dryRun"):
        return {"plan": req.plan.model_dump()}
    # Ensure scheduler available
    if SCHEDULER is None:
        raise HTTPException(status_code=503, detail="scheduler not initialized")
    # Persist run record
    run_id = await store.create_run(req.name, req.plan.model_dump())
    # Emit queued status immediately (compat)
    await store.append_event(run_id, "status", {"runId": run_id, "status": "queued"})
    # Build RunSpec for scheduler
    created_at = datetime.utcnow().isoformat() + "Z"
    sched_nodes: list[_SchedNodeSpec] = []
    for n in req.plan.nodes:
        sched_nodes.append(
            _SchedNodeSpec(
                id=n.id,
                agent=n.agent,
                params=n.params or {},
                max_retries=n.max_retries if n.max_retries is not None else ((n.params or {}).get("maxRetries") or 0),
                backoff_seconds=n.backoff_seconds if n.backoff_seconds is not None else ((n.params or {}).get("backoffSeconds") or 2),
                timeout_ms=n.timeoutMs,
            )
        )
    sched_edges: list[_SchedEdgeSpec] = []
    for e in req.plan.edges:
        # Convert from_node/to_node ("A.output") to base ids ("A")
        src = e.from_node.split(".")[0]
        dst = e.to_node.split(".")[0]
        sched_edges.append(_SchedEdgeSpec(src=src, dst=dst))
    run_spec = _SchedRunSpec(
        run_id=run_id,
        name=req.name,
        created_at=created_at,
        plan_nodes=sched_nodes,
        plan_edges=sched_edges,
    )
    # Enqueue + start (background)
    await SCHEDULER.enqueue_run(run_spec)
    asyncio.create_task(SCHEDULER.start_run(run_id))
    return {"runId": run_id}

@app.get("/api/v1/runs/{run_id}")
async def get_run(run_id: str):
    store = _ensure_store()
    try:
        meta = await store.get_run_meta(run_id)
        # Coerce to RunSnapshot (Pydantic will convert dicts for NodeState)
        return RunSnapshot(
            runId=meta.get("runId", run_id),
            status=meta.get("status", "queued"),
            startedAt=meta.get("startedAt"),
            finishedAt=meta.get("finishedAt"),
            nodes=meta.get("nodes", {}),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="run not found")

@app.get("/api/v1/runs/{run_id}/events")
async def run_events(request: Request, run_id: str):
    store = _ensure_store()
    # Verify run exists
    try:
        await store.get_run_meta(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="run not found")
    # Support Last-Event-ID for resume
    last_event_id = request.headers.get("last-event-id") or request.headers.get("Last-Event-ID")
    generator = _sse_event_stream(run_id, last_event_id)
    return StreamingResponse(generator, media_type="text/event-stream; charset=utf-8")

# Back-compat: existing DELETE endpoint cancels via store, keep it
@app.delete("/api/v1/runs/{run_id}")
async def cancel_run(run_id: str):
    store = _ensure_store()
    try:
        await store.cancel_run(run_id)
        await store.append_event(run_id, "status", {"runId": run_id, "status": "cancelled"})
        return {"ok": True}
    except KeyError:
        raise HTTPException(status_code=404, detail="run not found")
# NEW: explicit cancel endpoint that uses Scheduler for coordinated cancellation
@app.post("/api/v1/runs/{run_id}/cancel")
async def cancel_run_via_scheduler(run_id: str):
    if SCHEDULER is None:
        raise HTTPException(status_code=503, detail="scheduler not initialized")
    try:
        await SCHEDULER.cancel_run(run_id)
        return {"ok": True}
    except KeyError:
        raise HTTPException(status_code=404, detail="run not found")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

    async def main():
        # Example usage for testing AgentRunner
        # runner = AgentRunner() # AgentRunner is no longer directly used in main.py for this phase
        # await runner.connect()

        # A dummy flow plan for testing with the EchoAgent
        dummy_flow_plan = {
            "apiVersion": "v1alpha1",
            "kind": "Flow",
            "meta": {
                "id": "test.orchestrator-echo-flow",
                "name": "Orchestrator Echo Test Flow",
                "version": "0.1.0",
                "createdAt": datetime.now().isoformat() + "Z"
            },
            "graph": {
                "nodes": [
                    {"id": "start_prompt", "type": "ui.prompt", "position": {"x": 100, "y": 100}, "outputs": {"text": "Hello from Orchestrator!"}},
                    {"id": "echo_agent_node", "type": "flexinfer.echo", "position": {"x": 300, "y": 100}, "outputs": {"text": "This text will be echoed."}},
                    {"id": "end_console", "type": "ui.console", "position": {"x": 500, "y": 100}}
                ],
                "edges": [
                    {"from": "start_prompt.text", "to": "echo_agent_node.text"},
                    {"from": "echo_agent_node.output", "to": "end_console.input"}
                ]
            }
        }

        print("--- Testing AgentRunner with Echo Flow ---")
        await runner.process_flow_plan(dummy_flow_plan)
        await runner.disconnect()

        print("\n--- Testing TopologicalSorter (original functionality) ---")
        node_a = Node(id="A", type="agent", position=Position(x=0, y=0))
        node_b = Node(id="B", type="agent", position=Position(x=100, y=100))
        node_c = Node(id="C", type="agent", position=Position(x=100, y=-100))
        node_d = Node(id="D", type="agent", position=Position(x=200, y=0))

        edge_ab = Edge(from_node="A.output", to_node="B.input")
        edge_ac = Edge(from_node="A.output", to_node="C.input")
        edge_bd = Edge(from_node="B.output", to_node="D.input")
        edge_cd = Edge(from_node="C.output", to_node="D.input")

        test_flow = Flow(
            apiVersion="v1",
            kind="Flow",
            meta=Meta(id="test-flow", name="Test Flow", version="1.0.0", createdAt=datetime.now()),
            graph=Graph(
                nodes=[node_a, node_b, node_c, node_d],
                edges=[edge_ab, edge_ac, edge_bd, edge_cd]
            )
        )

        print(f"Test Flow Nodes: {[n.id for n in test_flow.graph.nodes]}")
        print(f"Test Flow Edges: {[f'{e.from_node} -> {e.to_node}' for e in test_flow.graph.edges]}")

        try:
            plan = create_execution_plan(test_flow)
            print(f"Generated Execution Plan: {plan}")
        except ValueError as e:
            print(f"Error generating plan: {e}")

        print("\nTesting flow with a cycle:")
        node_cycle_a = Node(id="CA", type="agent", position=Position(x=0, y=0))
        node_cycle_b = Node(id="CB", type="agent", position=Position(x=100, y=0))
        node_cycle_c = Node(id="CC", type="agent", position=Position(x=200, y=0))

        edge_cycle_ab = Edge(from_node="CA.output", to_node="CB.input")
        edge_cycle_bc = Edge(from_node="CB.output", to_node="CC.input")
        edge_cycle_ca = Edge(from_node="CC.output", to_node="CA.input")

        test_flow_cycle = Flow(
            apiVersion="v1",
            kind="Flow",
            meta=Meta(id="cycle-flow", name="Cycle Flow", version="1.0.0", createdAt=datetime.now()),
            graph=Graph(
                nodes=[node_cycle_a, node_cycle_b, node_cycle_c],
                edges=[edge_cycle_ab, edge_cycle_bc, edge_cycle_ca]
            )
        )

        try:
            plan_cycle = create_execution_plan(test_flow_cycle)
            print(f"Generated Execution Plan (cycle): {plan_cycle}")
        except ValueError as e:
            print(f"Error generating plan (cycle): {e}")

    asyncio.run(main())
