# Architecture

MentatLab separates workflow design, orchestration, and execution into clear service boundaries.

## High-Level Components

- **Frontend (`services/frontend`)**
  - React + ReactFlow Mission Control canvas
  - Panels for console, timeline, and issues
  - Interacts with Gateway over HTTP/SSE/WebSocket
- **Gateway (`services/gateway-go`)**
  - API proxy to Orchestrator
  - WebSocket/SSE fanout and middleware (auth, rate limits, headers)
- **Orchestrator (`services/orchestrator-go`)**
  - DAG scheduler and run lifecycle
  - Agent registry, flow store, run store
  - Execution backends (memory/redis/k8s)
- **Redis**
  - Shared run state and messaging backend (when configured)
- **Agents (`agents/`)**
  - External processes or workloads following stdin/stdout NDJSON contract

## Request/Run Lifecycle

1. User creates or updates a flow in Mission Control.
2. Frontend calls Gateway (`/api/v1/flows`, `/api/v1/runs`).
3. Gateway forwards to Orchestrator and streams events back.
4. Orchestrator schedules nodes according to DAG dependencies.
5. Node execution emits events; run status is persisted in runstore.
6. Frontend updates timeline/console with live run events.

## Orchestrator Internal Packages

- `internal/api` - HTTP handlers and routing
- `internal/scheduler` - DAG scheduling/execution
- `internal/registry` - agent registration and lookup
- `internal/flowstore` - flow persistence
- `internal/runstore` - run state persistence
- `internal/k8s` - Kubernetes job driver

## Execution Modes

- `memory` - in-memory state for local dev
- `redis` - Redis-backed run state for durable dev/prod
- `k8s` - Kubernetes Jobs for agent execution in cluster

## Key Design Goals

- Deterministic DAG execution for repeatable runs
- Observable run lifecycle (events + metrics)
- Pluggable execution backends and storage
- Agent-language agnostic integration via NDJSON
