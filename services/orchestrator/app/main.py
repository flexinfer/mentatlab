from typing import List, Dict, Any
from graphlib import TopologicalSorter
import asyncio
from datetime import datetime
from fastapi import FastAPI, HTTPException

from services.gateway.app.models import Flow, Node, Edge, Meta, Graph, Position
from services.orchestrator.app.execution import ExecutionEngine, ExecutionResult
from services.orchestrator.app.scheduling import SchedulingService
from services.orchestrator.app.resources import ResourceManager

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

    try:
        sorter = TopologicalSorter(graph_dependencies)
        execution_plan = list(sorter.static_order())
        return execution_plan
    except Exception as e:
        # graphlib.TopologicalSorter raises ValueError for cycles
        raise ValueError(f"Flow graph contains a cycle or is invalid: {e}")

app = FastAPI(
    title="Orchestrator Service",
    description="Service for managing and executing AI workflows.",
    version="0.1.0",
)

# Initialize services
execution_engine = ExecutionEngine()
scheduling_service = SchedulingService()
resource_manager = ResourceManager()

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
async def schedule_workflow_endpoint(workflow_id: str, cron_schedule: str):
    """
    Schedules a workflow to run periodically using a cron schedule.
    """
    job_id = scheduling_service.scheduleWorkflow(workflow_id, cron_schedule)
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