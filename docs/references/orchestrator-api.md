# Orchestrator API reference

This page documents the Orchestrator service REST and SSE surface. Authoritative implementation references are linked inline.

Data types and schemas
- TypeScript types (wire format and domain types): [`services/orchestrator/src/types.ts`](services/orchestrator/src/types.ts:1)
+ Implementation reference: Python FastAPI implementation: [`services/orchestrator/app/main.py`](services/orchestrator/app/main.py:1)
- JSON schemas (validation / examples):
  - Run: [`schemas/orchestrator/run.schema.json`](schemas/orchestrator/run.schema.json:1)
  - Checkpoint: [`schemas/orchestrator/checkpoint.schema.json`](schemas/orchestrator/checkpoint.schema.json:1)
  - Event: [`schemas/orchestrator/event.schema.json`](schemas/orchestrator/event.schema.json:1)

REST endpoints (summary)
- POST /runs
  - Description: Create a run or request a plan.
  - Query: `mode=plan|redis|k8s` (optional)
  - Responses:
    - 200 (plan): returns a plan object when `mode=plan` (server may return a plan representation)
    - 201 (created): returns { runId: string } for real runs
  - Server handler: [`services/orchestrator/src/routes/runs.ts`](services/orchestrator/src/routes/runs.ts:19)
+ Server handler implementation: [`services/orchestrator/app/main.py`](services/orchestrator/app/main.py:457)

- GET /runs/:runId
  - Description: Fetch a single run
  - Responses:
    - 200: { run: Run } or Run object
    - 404: run not found
  - Server handler: [`services/orchestrator/src/routes/runs.ts`](services/orchestrator/src/routes/runs.ts:241)
+ Server handler implementation: [`services/orchestrator/app/main.py`](services/orchestrator/app/main.py:939)

- GET /runs/:runId/checkpoints
  - Description: List checkpoints for a run
  - Responses:
    - 200: { checkpoints: Checkpoint[] } or array
    - 404: run not found

- POST /runs/:runId/checkpoints
  - Description: Append a checkpoint to a run
  - Payload: { type: string, data?: object }
  - Responses:
    - 201: { checkpointId: string }
    - 400: validation errors (see JSON schema)
  - Server handler: [`services/orchestrator/src/routes/runs.ts`](services/orchestrator/src/routes/runs.ts:96)
+ Server handler implementation: [`services/orchestrator/app/main.py`](services/orchestrator/app/main.py:939)

- DELETE /runs/:runId
  - Description: Cancel / request termination of a run
  - Responses:
    - 200: { status: "<new-status>" }
    - 409: invalid transition (cannot cancel in current state)
    - 404: run not found
  - Server handler: [`services/orchestrator/src/routes/runs.ts`](services/orchestrator/src/routes/runs.ts:250)

Note: GET /runs (list) is not implemented server-side — the frontend includes a client-side listRuns helper but the server does not provide a list endpoint.

SSE endpoint
- GET /runs/:runId/events
  - Description: Server-Sent Events (SSE) streaming endpoint for run lifecycle events.
  - URL example: `GET http://localhost:7070/runs/<runId>/events?replay=10`
  - Resume semantics: server emits SSE `id` values that correspond to checkpoint timestamps; browsers send Last-Event-ID on reconnect and the server can resume from that point.
  - Query params:
    - `replay` (optional): number of past checkpoint events to replay on connect; default 10, max 100.
  - Events (typed):
    - `hello` — initial greeting with run metadata
    - `status` — run status updates (e.g., running, completed, failed)
    - `checkpoint` — checkpoint objects
  - Heartbeat / keepalive: server may emit comment lines to maintain connection — clients should treat them as heartbeat markers.
  - Server handler: [`services/orchestrator/src/routes/runs.ts`](services/orchestrator/src/routes/runs.ts:141)
+ Server handler implementation: [`services/orchestrator/app/main.py`](services/orchestrator/app/main.py:1003)

Auth / CORS / Rate limiting
- Server bootstrapping and middleware (auth, CORS, rate limiting) are configured in the server entrypoint: [`services/orchestrator/src/server.ts`](services/orchestrator/src/server.ts:1)
+ Server bootstrap and global middleware: [`services/orchestrator/app/main.py`](services/orchestrator/app/main.py:119)
- Important environment variables:
  - ORCHESTRATOR_API_KEY — when present, endpoints require requests to include the valid API key
  - CORS_ORIGINS — comma-separated origins permitted by CORS
  - RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX — rate-limiting window (ms) and number of requests allowed
- Exempt paths: `/health`, `/ready`, `/metrics` are typically excluded from rate limiting and API key enforcement to allow healthchecks and metrics scraping.

Observability
- Metrics: Prometheus-compatible metrics are exposed at `/metrics`
- Request id and structured logging middleware are used for correlation and are implemented in the observability codebase (see `observability` folder).

Client guidance
- EventSource (browsers) cannot set custom headers; for local development prefer no-auth or cookie-based auth flows.
- Use `replay` param and Last-Event-ID for robust reconnect/resume behavior.

References
- Server bootstrap and global middleware: [`services/orchestrator/src/server.ts`](services/orchestrator/src/server.ts:1)
+ Server bootstrap and global middleware: [`services/orchestrator/app/main.py`](services/orchestrator/app/main.py:119)
- Routes and SSE handlers: [`services/orchestrator/src/routes/runs.ts`](services/orchestrator/src/routes/runs.ts:1)
+ Routes and SSE handlers: [`services/orchestrator/app/main.py`](services/orchestrator/app/main.py:1003)
- Types: [`services/orchestrator/src/types.ts`](services/orchestrator/src/types.ts:1)
+ Implementation types / handlers: [`services/orchestrator/app/main.py`](services/orchestrator/app/main.py:656)
- Schemas: see section above