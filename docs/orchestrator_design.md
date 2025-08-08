# MentatLab Orchestrator Service: Core Architecture

*Last updated: 2025-07-23*

## 1. Introduction

This document outlines the core architectural design for the MentatLab Orchestrator service. The Orchestrator is a critical component responsible for interpreting a `flow.mlab` file, understanding its dependency graph, and generating a concrete execution plan.

The design is based on the specifications laid out in the [`docs/flows.md`](docs/flows.md:1) document, specifically the `graph` data structure and the runtime lifecycle.

## 2. Core Components

The Orchestrator is composed of a pipeline of four main components that progressively transform the raw `Flow` definition into an executable plan.



### 2.1. Parser/Loader

*   **Responsibility:** Ingest and validate the `flow.mlab` data structure.
*   **Input:** A raw `Flow` object (JSON/YAML), typically received from the Gateway via a `POST /runs` request.
*   **Process:**
    1.  Deserializes the incoming JSON or YAML into an internal `Flow` data structure.
    2.  Validates the structure against the `schemas/flow.schema.json`. This ensures all required fields (`apiVersion`, `kind`, `meta`, `graph`) are present and correctly typed.
    3.  Performs initial sanity checks, such as verifying that node IDs are unique.
*   **Output:** A validated, in-memory `Flow` object.

### 2.2. DAG Processor

*   **Responsibility:** Represent the flow's node and edge relationships as a formal Directed Acyclic Graph (DAG).
*   **Input:** The validated `Flow` object from the Parser/Loader.
*   **Process:**
    1.  Iterates through the `graph.nodes` list, creating a vertex in the DAG for each node.
    2.  Iterates through the `graph.edges` list. For each edge, it creates a directed link from the `from` node to the `to` node. The edge definition (`from: prompt1.text` to `to: llm1.text`) is simplified to a node-to-node relationship (`prompt1` -> `llm1`).
    3.  While processing, it detects cycles in the graph (e.g., `A -> B -> A`). If a cycle is found, the flow is invalid, and the process is aborted with an error.
*   **Output:** An in-memory DAG data structure (e.g., using a library like Python's `networkx` or a custom graph implementation) representing the flow's execution dependencies.

### 2.3. Topological Sorter

*   **Responsibility:** Determine the correct, dependency-aware execution order of the nodes.
*   **Input:** The DAG from the DAG Processor.
*   **Process:**
    1.  Applies a topological sorting algorithm (e.g., Kahn's algorithm or depth-first search) to the DAG.
    2.  The algorithm identifies nodes with no incoming edges (source nodes) and adds them to the sorted list.
    3.  It then "removes" these nodes and their outgoing edges from the graph, and repeats the process until all nodes have been visited.
*   **Output:** A linearly ordered list of node IDs, representing the sequence in which nodes can be executed. Parallelizable branches will appear adjacent in the list but can be identified by analyzing their dependencies.

### 2.4. Execution Planner

*   **Responsibility:** Generate a simple, step-by-step execution plan from the sorted graph.
*   **Input:** The topologically sorted list of node IDs.
*   **Process:**
    1.  Transforms the sorted list into a simple, serializable data structure. This plan is the final artifact the Orchestrator produces before handing off to the execution engine (e.g., Kubernetes Job creator).
    2.  The plan could be a simple array of steps, where each step contains one or more node IDs that can be executed in parallel.
*   **Output:** An execution plan. For example:
    ```json
    {
      "plan": [
        ["prompt1"],
        ["llm1"],
        ["console1"]
      ]
    }
    ```
    In a more complex graph with parallel branches, it might look like:
    ```json
    {
      "plan": [
        ["inputA", "inputB"],
        ["processA", "processB"],
        ["aggregator"]
      ]
    }
    ```

## 3. Process Flow Diagram

The following diagram illustrates how a `Flow` object is processed through the Orchestrator's components to produce an execution plan.

```mermaid
graph TD
    subgraph Orchestrator Service
        A[1. Parser/Loader] --> B[2. DAG Processor];
        B --> C[3. Topological Sorter];
        C --> D[4. Execution Planner];
    end

    subgraph Inputs
        FlowFile["flow.mlab <br/>(JSON/YAML)"];
    end

    subgraph Outputs
        ExecPlan["Execution Plan <br/>(e.g., [['A'], ['B', 'C'], ['D']])"];
    end

    FlowFile --> A;
    D --> ExecPlan;

    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#f9f,stroke:#333,stroke-width:2px
    style C fill:#f9f,stroke:#333,stroke-width:2px
    style D fill:#f9f,stroke:#333,stroke-width:2px

## 4. Execution Plan API Surface

Endpoints (examples):
- POST /runs
  - Query param: mode=plan|redis|k8s
  - If mode=plan: returns execution plan JSON (topologically grouped steps)
  - If mode=redis or k8s: enqueues run and returns runId; events stream via WS/SSE
- GET /runs/{runId}/checkpoints
  - Returns list of checkpoints for run
- GET /runs/{runId}/events
  - Stream of Recorder/Orchestrator events (SSE or WS)

Notes:
- plan mode is intended for dry-run planning & preflight validation
- redis mode publishes tasks to Redis stream `agent_tasks:<agent_id>`
- k8s mode schedules Jobs / Deployments (production)

Status: If code stubs exist, add anchor(s) to [`docs/status/anchors.json`](docs/status/anchors.json:1) (current status: planned; see `schemas.flow` and orchestrator stubs in [`docs/status/project-status.yaml`](docs/status/project-status.yaml:1))