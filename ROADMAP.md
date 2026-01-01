# MentatLab Revamp Plan

## Objective

Transform MentatLab into a high-performance, "super responsive" graph agent orchestration machine with a premium aesthetic and robust architecture.

## 1. Frontend Revamp (The "Graph Machine")

**Goal**: Create a stunning, responsive, canvas-first UI.

- **Aesthetic**: Cyberpunk / Sci-Fi / Glassmorphism.
  - Dark mode by default.
  - Neon accents for active states.
  - Translucent panels (glass effect) for overlays.
- **Tech Stack**:
  - **Framework**: React + Vite.
  - **Styling**: Tailwind CSS v4 (already installed).
  - **Graph**: ReactFlow (optimize for performance).
  - **State**: Zustand (for snappy updates).
- **Key Features**:
  - **Live Graph**: Real-time visualization of agent states and message flows.
  - **Command Center**: A "Mission Control" interface for global actions.
  - **Performance**: Minimize re-renders, use WebWorkers if needed for heavy data processing.

## 2. Backend Optimization (Go Gateway)

**Goal**: Reduce latency and handle high-concurrency streaming.

- **New Service**: `services/gateway-go`
- **Language**: Go (Golang).
- **Responsibilities**:
  - **Reverse Proxy**: Forward API requests to the Orchestrator.
  - **WebSocket Hub**: Handle real-time communication between Frontend and Agents/Orchestrator.
  - **Static Assets**: Serve agent UI assets efficiently.
- **Why Go?**: Superior performance for IO-bound tasks (proxying, streaming) compared to Python/FastAPI.

## 3. Orchestrator Optimization (Go)

**Goal**: High-throughput agent scheduling and graph execution.

- **New Service**: `services/orchestrator-go`
- **Language**: Go (Golang).
- **Responsibilities**:
  - **Graph Engine**: Efficient DAG traversal and execution.
  - **Scheduler**: Native Kubernetes integration using `client-go`.
  - **State Management**: Fast, concurrent access to RunStore (Redis/Memory).
- **Why Go?**:
  - Native concurrency (goroutines) is perfect for managing thousands of active agents/nodes.
  - Strong typing and compilation ensure robustness.
  - `client-go` is the gold standard for K8s interaction.

## Execution Plan

1. **Scaffold Go Services** (Completed):
   - `services/gateway-go`: Reverse proxy & WebSocket hub implemented.
   - `services/orchestrator-go`: Core logic & basic engine implemented.
2. **Frontend Design System** (Completed): Defined the new "Deep Space" Tailwind theme.
3. **Graph UI Overhaul** (Completed): Rebuilt the main canvas view with the new design.
4. **Migration** (In Progress):
   - Port logic from Python to Go incrementally.
   - Next: Implement full Kubernetes integration in `orchestrator-go`.
   - Next: Connect Frontend to Go Gateway WebSockets.
