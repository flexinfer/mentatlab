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
  - Example panel using these: [`services/frontend/src/components/mission-control/panels/RunsPanel.tsx`](services/frontend/src/components/mission-control/panels/RunsPanel.tsx:1)

Environment configuration (.env.local)
- In `services/frontend`, create a `.env.local`:
```ini
VITE_ORCHESTRATOR_URL=http://localhost:7070
VITE_FF_ORCHESTRATOR_PANEL=true
# optional if you also use EnhancedStream elsewhere in the app
# VITE_CONNECT_WS=false
```

Where to click in the UI (Mission Control)
1. Start the frontend dev server (Vite) and open http://localhost:5173/
2. Bottom dock → click the “Runs” tab (ensure ORCHESTRATOR_PANEL flag is enabled in [`services/frontend/src/config/features.ts`](services/frontend/src/config/features.ts:1))
3. Choose mode (redis|k8s), then click “Create Run”
4. Click “Connect” to subscribe to SSE
5. Use “Post progress checkpoint” to send test events
6. Use “Cancel run” to test status transitions
7. Reload the page and “Connect” again to verify SSE replay behavior (recent checkpoints should appear)

Expanded curl/SSE recipes
- Create a plan:
```bash
curl -X POST "http://localhost:7070/runs?mode=plan"
```
- Create a run:
```bash
curl -X POST "http://localhost:7070/runs"
```
- Get a run:
```bash
RUN_ID="<runId>"
curl "http://localhost:7070/runs/${RUN_ID}"
```
- Post a checkpoint:
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"type":"progress","data":{"percent":10}}' \
  "http://localhost:7070/runs/${RUN_ID}/checkpoints"
```
- Cancel a run:
```bash
curl -X DELETE "http://localhost:7070/runs/${RUN_ID}"
```
- Stream SSE with replay:
```bash
curl --no-buffer "http://localhost:7070/runs/${RUN_ID}/events?replay=10"
```
- Resume with Last-Event-ID (use a checkpoint ts ISO string you’ve seen previously):
```bash
LAST_TS="2025-01-01T12:34:56.789Z"
curl --no-buffer -H "Last-Event-ID: ${LAST_TS}" "http://localhost:7070/runs/${RUN_ID}/events"
```

Auth note (local)
- EventSource in browsers cannot set custom headers, so token-based header auth is not usable from the SSE client.
- For local development, run the orchestrator without ORCHESTRATOR_API_KEY set, or use cookie-based auth. The server's auth middleware is in [`services/orchestrator/src/server.ts`](services/orchestrator/src/server.ts:1).
- CORS: when using Vite (http://localhost:5173), set `CORS_ORIGINS=http://localhost:5173` for the orchestrator, or keep permissive defaults in local dev.

Troubleshooting
- CORS: ensure `CORS_ORIGINS` includes the frontend origin (Vite default: http://localhost:5173) or use wildcard during local development.
- Rate limiting: default limits are controlled by RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX; health and metrics paths are typically exempt.