# Orchestrator — Local development guide

Prerequisites
- Docker & Docker Compose
- Node (for frontend) and npm if running the UI locally
- (Optional) redis is defined in the provided docker-compose

Start services with docker compose
- From the repo root run:
  - docker-compose up --build
- The orchestrator service is exposed at: http://localhost:7070
- Compose reference: [`docker-compose.yml`](docker-compose.yml:1)

Verify readiness
- Ready endpoint: http://localhost:7070/ready — compose healthcheck expects this to return successful
- Health: http://localhost:7070/health
- Metrics: http://localhost:7070/metrics

Test REST endpoints with curl
- Create a plan (mode=plan)
  - curl -X POST "http://localhost:7070/runs?mode=plan"
- Create a run
  - curl -X POST "http://localhost:7070/runs"
- Get a run
  - curl "http://localhost:7070/runs/<runId>"
- Post a checkpoint
  - curl -X POST -H "Content-Type: application/json" -d '{"type":"progress","data":{"percent":10}}' "http://localhost:7070/runs/<runId>/checkpoints"
- Cancel a run
  - curl -X DELETE "http://localhost:7070/runs/<runId>"

Test SSE with curl (or browser)
- Example (using `curl --no-buffer` to view event stream):
  - curl --no-buffer "http://localhost:7070/runs/<runId>/events?replay=10"
- Note: EventSource in browsers will automatically send Last-Event-ID on reconnect; server uses checkpoint timestamps as SSE ids for resume.

Frontend wiring in local dev
- Frontend reads orchestrator base URL from Vite env: `VITE_ORCHESTRATOR_URL`
- Default fallback is `http://localhost:7070` as implemented in: [`services/frontend/src/config/orchestrator.ts`](services/frontend/src/config/orchestrator.ts:7)
- The UI client uses `orchestratorService` and `OrchestratorSSE` helpers:
  - HTTP client: [`services/frontend/src/services/api/orchestratorService.ts`](services/frontend/src/services/api/orchestratorService.ts:1)
  - SSE client: [`services/frontend/src/services/api/streaming/orchestratorSSE.ts`](services/frontend/src/services/api/streaming/orchestratorSSE.ts:42)
  - Example panel using these: [`services/frontend/src/components/mission-control/panels/RunsPanel.tsx`](services/frontend/src/components/mission-control/panels/RunsPanel.tsx:18)

Auth note (local)
- EventSource in browsers cannot set custom headers, so token-based header auth is not usable from the SSE client.
- For local development, run the orchestrator without ORCHESTRATOR_API_KEY set, or use cookie-based auth. The server's auth middleware is in [`services/orchestrator/src/server.ts`](services/orchestrator/src/server.ts:1).

Troubleshooting
- CORS: ensure `CORS_ORIGINS` includes the frontend origin (Vite default: http://localhost:5173) or use wildcard during local development.
- Rate limiting: default limits are controlled by RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX; health and metrics paths are typically exempt.