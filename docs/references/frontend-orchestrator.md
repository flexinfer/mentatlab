# Frontend — Orchestrator integration

This page documents how the frontend integrates with the Orchestrator service: configuration, HTTP client, SSE client and an example UI surface.

Config
- Frontend reads the orchestrator base URL from Vite env: `VITE_ORCHESTRATOR_URL`.
- Default fallback is `http://localhost:7070` as implemented in: [`services/frontend/src/config/orchestrator.ts`](services/frontend/src/config/orchestrator.ts:7)

HTTP client — orchestratorService
- Client implementation: [`services/frontend/src/services/api/orchestratorService.ts`](services/frontend/src/services/api/orchestratorService.ts:1)
- Key methods:
  - [`createRun()`](services/frontend/src/services/api/orchestratorService.ts:36) — POST /runs (supports `mode=plan|redis|k8s`)
  - [`getRun()`](services/frontend/src/services/api/orchestratorService.ts:43) — GET /runs/:runId
  - [`listCheckpoints()`](services/frontend/src/services/api/orchestratorService.ts:57) — GET /runs/:runId/checkpoints
  - [`postCheckpoint()`](services/frontend/src/services/api/orchestratorService.ts:63) — POST /runs/:runId/checkpoints
  - [`cancelRun()`](services/frontend/src/services/api/orchestratorService.ts:73) — DELETE /runs/:runId
- Note: The client exposes `listRuns()` but the server does not implement a GET /runs list endpoint; avoid relying on it for production.

SSE client — OrchestratorSSE
- Implementation: [`services/frontend/src/services/api/streaming/orchestratorSSE.ts`](services/frontend/src/services/api/streaming/orchestratorSSE.ts:42)
- Behavior and defaults:
  - `replay` default: 10 (server accepts 0–100)
  - Heartbeat / stall detection: the client treats 45s without events as a stall and triggers a reconnect
  - Backoff schedule: progressive retries (1s, 2s, 5s, 10s, 30s cap)
  - Events handled: `hello`, `status`, `checkpoint`
  - Resume: uses Last-Event-ID (server sets SSE id to checkpoint timestamp) — browsers send Last-Event-ID automatically on reconnect
  - Auth note: EventSource cannot set custom headers; use cookie-based auth or run without auth locally

UI surface (example)
- Example component: [`services/frontend/src/components/mission-control/panels/RunsPanel.tsx`](services/frontend/src/components/mission-control/panels/RunsPanel.tsx:18)
  - Creates runs (mode: plan|redis|k8s)
  - Connects to SSE to receive `hello`, `status`, `checkpoint`
  - Posts checkpoints and cancels runs via the `orchestratorService`

Developer tips
- For local development set `VITE_ORCHESTRATOR_URL` to `http://localhost:7070` or rely on the default fallback.
- When using SSE from the browser, avoid header-based token auth; prefer cookie auth or disable auth locally.
- Use the `replay` query param to fetch recent checkpoints on (re)connect — the frontend helpers set sensible defaults.