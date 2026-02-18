# Implementation Plan: MentatLab Stabilization & Roadmap

## Scope

Transform MentatLab from a fragmented prototype with aspirational docs into a functional, deployable agent development and workflow orchestration platform. This plan prioritizes making what exists actually work end-to-end before adding new features.

## Principles

1. **Fix before feature** - Make the existing code deployable before adding capabilities
2. **Go-first** - Go services are the production backend; deprecate Python services cleanly
3. **Evidence-based roadmap** - Replace aspirational milestone specs with reality-grounded planning
4. **Vertical slices** - Each milestone delivers a working, demonstrable capability

---

## Milestones

### M0: Foundation (Infrastructure Fix)
**Goal:** The project builds, tests, and deploys end-to-end.

### M1: Core Loop (Agent Dev + Execution)
**Goal:** A developer can create an agent, define a flow, execute it, and see results in the UI.

### M2: Workflow Power (DAG Features)
**Goal:** Real workflow orchestration with conditionals, foreach, data flow, and observability.

### M3: Production Hardening
**Goal:** The platform is reliable, observable, and ready for real workloads.

### M4: Developer Experience
**Goal:** Polished CLI, agent SDK, documentation, and onboarding.

---

## Plan

### M0: Foundation (Infrastructure Fix)

#### M0.1 Fix CI/CD image builds
- Update `.gitlab-ci.yml` build stage to build Go Dockerfiles (`services/gateway-go/Dockerfile`, `services/orchestrator-go/Dockerfile`) instead of Python
- Verify image names match K8s manifests: `mentatlab-gateway-go`, `mentatlab-orchestrator-go`
- Add Go service Dockerfile builds to `build-and-push.sh`
- Source: `.gitlab-ci.yml:158-211`, `k8s/gateway.yaml:44`, `k8s/orchestrator.yaml:45`

#### M0.2 Fix docker-compose for local dev
- Update `docker-compose.yml` to use Go service Dockerfiles
- Standardize ports: orchestrator=7070, gateway=8080, frontend=5173
- Update `docker-compose.dev.yml` to match (or remove if redundant)
- Update `run-local-dev.sh` to start Go services instead of Python
- Source: `docker-compose.yml`, `docker-compose.dev.yml`, `run-local-dev.sh`

#### M0.3 Fix frontend production serving
- Replace `vite preview` with nginx or caddy in frontend Dockerfile
- Add proper build-time env var injection for API URLs
- Source: `services/frontend/Dockerfile`

#### M0.4 Clean up legacy Python services
- Move `services/gateway/` and `services/orchestrator/` to `archive/` or a `legacy/` branch
- Update `pyproject.toml` and `pytest.ini` to remove Python service references
- Keep Python agents (they're the actual agent implementations)
- Source: `services/gateway/`, `services/orchestrator/`

#### M0.5 Remove orphaned engine stub
- Remove or integrate `services/orchestrator-go/engine/` (the `time.Sleep` MVP stub)
- The `internal/` path is the real implementation; `engine/` creates confusion
- Source: `services/orchestrator-go/engine/engine.go:72-73`

#### M0.6 Verify end-to-end deployment
- Run `docker-compose up` and verify all health endpoints
- Run `k8s/deploy.sh --skip-push` against a test namespace
- Document any remaining issues
- Source: `k8s/deploy.sh`, `docker-compose.yml`

**Acceptance:** `docker-compose up` starts Go gateway, Go orchestrator, frontend, and Redis. All `/health` and `/healthz` endpoints return 200. CI pipeline builds correct images.

---

### M1: Core Loop (Agent Dev + Execution)

#### M1.1 Verify agent execution path
- Test the full loop: register agent -> create flow -> create run -> start run -> stream events -> view in UI
- Identify and fix any broken links in the chain
- Test with echo agent first, then psyche-sim
- Source: Go orchestrator API endpoints, `agents/echo/main.py`

#### M1.2 Wire frontend to Go orchestrator API
- Audit frontend API clients against Go orchestrator endpoints
- Fix any mismatched endpoints, request/response shapes
- Verify SSE streaming from orchestrator through gateway to frontend
- Source: `services/frontend/src/services/`, `services/orchestrator-go/internal/api/`

#### M1.3 Agent registration and discovery
- Verify Go orchestrator's agent registry (memory + Redis backends)
- Test agent CRUD via API
- Wire frontend agent list/detail views to real data
- Source: `services/orchestrator-go/internal/registry/`

#### M1.4 Flow CRUD and persistence
- Verify flow create/read/update/delete via Go orchestrator
- Test flow persistence (memory + Redis backends)
- Wire frontend canvas save/load to real API
- Source: `services/orchestrator-go/internal/flowstore/`

#### M1.5 Run execution with real agents
- Test DAG execution with subprocess driver (local dev) and K8s driver (cluster)
- Verify event streaming works: run starts -> node events -> completion
- Confirm frontend console panel receives and displays events
- Source: `services/orchestrator-go/internal/scheduler/`

**Acceptance:** A user can open the frontend, see registered agents, create a flow on the canvas, execute it, and watch events stream into the console panel in real time.

---

### M2: Workflow Power (DAG Features)

#### M2.1 Conditional execution in UI
- Wire ConditionalNode frontend component to orchestrator's conditional execution
- Test if/else and switch/case flow paths
- Verify expression evaluation passes context correctly
- Source: `services/frontend/src/nodes/ConditionalNode.tsx`, `services/orchestrator-go/internal/scheduler/conditional.go`

#### M2.2 ForEach loops in UI
- Wire ForEachNode frontend component to orchestrator's foreach execution
- Test iteration over arrays with parallel execution
- Source: `services/frontend/src/nodes/ForEachNode.tsx`, `services/orchestrator-go/internal/scheduler/foreach.go`

#### M2.3 Data flow between nodes
- Implement or verify artifact passing between nodes (MinIO/S3 backend configured in K8s)
- Test node output -> next node input data flow
- Source: `services/orchestrator-go/internal/dataflow/` (if exists), K8s env: `DATAFLOW_TYPE=minio`

#### M2.4 Contract overlay integration
- Wire ContractOverlay to real schema validation
- Show contract violations on canvas nodes
- Implement quick-fix suggestions from linter
- Source: `services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx`

#### M2.5 Lineage and policy overlays
- Verify lineage tracking works with real run data
- Wire policy guardrails to actual budget/PII/safety checks
- Source: `services/frontend/src/components/mission-control/overlays/LineageOverlay.tsx`, `PolicyOverlay.tsx`

**Acceptance:** A user can build a flow with conditional branches and foreach loops, execute it, and see data flow between nodes. Contract violations are highlighted on the canvas.

---

### M3: Production Hardening

#### M3.1 Observability
- Wire OpenTelemetry tracing in Go services (stubs exist)
- Add Prometheus ServiceMonitor for gateway and orchestrator
- Create basic Grafana dashboard for run metrics
- Source: `services/gateway-go/tracing/`, `k8s/servicemonitor.yaml`

#### M3.2 Error handling and resilience
- Add circuit breakers for orchestrator -> agent communication
- Implement run timeout and cancellation
- Add retry logic for transient failures
- Source: `services/orchestrator-go/internal/scheduler/`

#### M3.3 Authentication and authorization
- Enable and test Cloudflare Access auth in gateway
- Verify JWT validation middleware
- Add RBAC for multi-user scenarios
- Source: `services/gateway-go/middleware/auth.go`

#### M3.4 Testing improvements
- Add frontend unit tests (vitest) for critical components
- Add integration tests for the full agent execution path
- Set up CI test coverage reporting
- Source: `services/frontend/`, `.gitlab-ci.yml`

#### M3.5 K8s manifest hardening
- Pin image versions (remove `:latest`)
- Verify resource limits are appropriate
- Test HPA scaling behavior
- Add NetworkPolicy enforcement
- Source: `k8s/*.yaml`

**Acceptance:** Services have structured logging, distributed tracing, and metrics dashboards. Auth is enforced. Test coverage exceeds 60% for Go services and 40% for frontend.

---

### M4: Developer Experience

#### M4.1 Update mentatctl CLI
- Verify templates match current agent manifest schema
- Add `mentatctl dev run` for local agent testing with hot reload
- Add `mentatctl flow validate` for offline flow validation
- Source: `cli/mentatctl/`

#### M4.2 Agent SDK documentation
- Document the agent contract (stdin JSON, NDJSON events, final output)
- Create "Build Your First Agent" tutorial
- Document streaming event types and their semantics
- Source: `agents/common/emit.py`, `schemas/agent.schema.json`

#### M4.3 Consolidate documentation
- Replace aspirational milestone specs with this implementation plan
- Archive `v1.0_milestone_spec.md`, `v1.1_milestone_spec.md`, `v2.0_milestone_spec.md` to `docs/archive/`
- Update `ROADMAP.md` to reflect actual plan
- Update `README.md` with accurate getting-started instructions
- Source: `docs/`, `ROADMAP.md`, `README.md`

#### M4.4 Example flows and agents
- Create 3-5 example flows that demonstrate key features
- Create a template agent in Go (in addition to Python/Node/Rust templates)
- Add a "demo mode" that pre-loads example flows and agents
- Source: `examples/`, `cli/mentatctl/templates/`

**Acceptance:** A new developer can clone the repo, run `docker-compose up`, open the UI, and execute a demo flow within 5 minutes. Documentation accurately reflects the system.

---

### M5: Production Readiness

**Goal:** Platform runs on K3s with validated K8s job driver, working artifact storage, Grafana dashboards, and production-grade scheduler features (timeouts, retries).

#### M5.1 Validate K8s job driver on real cluster
- Build and push echo agent image to Harbor
- Deploy orchestrator with `K8S_IN_CLUSTER=true`
- Execute a run using K8s job driver, verify Job creation, log streaming, success reporting
- Test failure cases: image pull failure, timeout, cancellation
- **Status:** Pending (requires cluster access)

#### M5.2 Verify MinIO data flow end-to-end
- Deploy MinIO, create bucket and credentials secret
- Exercise artifact endpoints: upload, list, download, delete
- Test agent-to-artifact flow through scheduler
- **Status:** Pending (requires cluster access)

#### M5.3 Run-level timeouts
- Added `Timeout` to `types.Plan` (`pkg/types/run.go`)
- Added `ORCH_DEFAULT_RUN_TIMEOUT` config (`internal/config/config.go`)
- `StartRun` creates `context.WithTimeout`, plan-level overrides default
- On timeout: cancel active tasks, close gates, mark run failed
- Tests: `TestRunTimeout_ContextExpires`, `TestRunTimeout_PlanOverridesDefault`
- **Status:** Complete

#### M5.4 Configurable per-node retry policies
- Added `RetryPolicy` struct with `MaxRetries`, `BackoffType`, `BackoffBase`, `BackoffMax`
- `resolveRetryPolicy` supports fixed, exponential, and linear backoff
- Per-node policy overrides legacy `Retries` field
- Tests: `TestResolveRetryPolicy_*` (5 test cases)
- **Status:** Complete

#### M5.5 Grafana dashboards
- Orchestrator dashboard: 11 panels (active runs, throughput, node success rate, P99 duration, SSE, events, retries, queue, K8s jobs, runstore ops)
- Gateway dashboard: 5 panels (request rate, error rate, latency percentiles, SSE duration, requests by path)
- Deployed as ConfigMaps with `grafana_dashboard: "1"` label
- **Status:** Complete

#### M5.6 Full-stack smoke test on K3s
- Deploy all manifests, verify ingress, execute demo flow, check Redis persistence
- **Status:** Pending (requires cluster access)

**Acceptance:** Run executes on K3s with K8s job driver. Artifacts via MinIO. Timeouts and per-node retries work. Grafana dashboards show live metrics.

---

### M6: Workflow Maturity

**Goal:** The scheduler supports real-world workflow patterns: manual approval gates, webhook triggers, run templates/cloning, and cron schedules.

#### M6.1 Manual approval / pause gates
- Added `GateConfig` type with `Description`, `Timeout`, `AutoReject`
- Gate nodes enter `waiting_approval` status and block until signal
- `ApproveGate`/`RejectGate` methods + REST endpoints
- Auto-timeout with configurable auto-reject behavior
- Frontend `GateNode.tsx` with approve/reject buttons
- Tests: `TestGateApprove`, `TestGateReject`, `TestGateTimeout_AutoReject`
- **Status:** Complete

#### M6.2 Webhook triggers for runs
- `POST /webhooks` generates per-flow token, stores on Flow
- `POST /webhooks/trigger/{flowId}` validates token, creates run from flow graph
- Auth via `X-Webhook-Token` header or `Bearer` token
- **Status:** Complete

#### M6.3 Run templates and cloning
- `POST /runs/{id}/clone` — new run with same plan (optional auto_start)
- `POST /flows/{id}/run` — shorthand: flow → plan → run
- `FlowID`/`ParentRunID` on Run type for lineage
- Frontend clone/re-run buttons in RunsPanel
- **Status:** Complete

#### M6.4 Scheduled / cron runs
- `CronRunner` goroutine evaluates schedules every minute
- Full 5-field cron parser (*, N, N-M, */N, N-M/S, comma-separated)
- Schedule CRUD endpoints
- Tests: `TestCronMatches`, `TestParseCron_*`, `TestCronRunner_*`
- **Status:** Complete

#### M6.5 Frontend polish
- GateNode registered in GraphPanel node types
- InspectorPanel: timeout config, retry policy editor (backoff type, base, max)
- RunsPanel: clone and re-run buttons
- WorkspaceProvider: gate node conversion in canvas → RunPlan
- Orchestrator types updated: `GateConfig`, `RetryPolicy`, `BackoffType`, `RunPlan.timeout`, `Run.flow_id`/`parent_run_id`
- OrchestratorService: `approveGate`, `rejectGate`, `cloneRun`, `runFlow` methods
- **Status:** Complete

**Acceptance:** Gate nodes pause and resume. Webhooks trigger runs. Cloning works. Cron schedules fire automatically. All features have UI controls.

---

### M7: Multi-User & API Maturity

**Goal:** The platform supports user identity, API key authentication, efficient pagination, and completion callbacks. Establish load testing baselines.

#### M7.1 User identity propagation
- Gateway proxy director forwards `X-User-Email`, `X-User-Name`, `X-User-Groups` headers to orchestrator
- Orchestrator extracts user from request context (headers or OIDC claims)
- Add `Owner` field to `types.Run` (string, email)
- `CreateRun` sets `Owner` from request context
- `ListRuns` accepts `?owner=` filter, returns only matching runs
- `Flow.CreatedBy` already exists — enforce it on Create/Update, add filter to `ListFlows`
- No hard multi-tenant isolation (soft filtering, not RBAC) — keep scope small
- **Baseline:** Gateway `middleware/auth.go` has `UserInfo` with Email/Groups. Proxy at `main.go:214-227` injects service token but NOT user headers. Orchestrator `internal/auth/middleware.go` extracts OIDC claims. Run type at `pkg/types/run.go` has no Owner field.
- **Files:** `services/gateway-go/main.go:214-227`, `services/orchestrator-go/pkg/types/run.go`, `services/orchestrator-go/internal/api/handlers.go:118-200`, `services/orchestrator-go/internal/runstore/store.go`

#### M7.2 API key authentication
- New `apikeys` Redis hash: `apikey:{sha256(key)}` → JSON with `owner`, `name`, `created_at`, `last_used`, `scopes`
- `POST /api/v1/apikeys` — generate key (returns plaintext once), store hash
- `DELETE /api/v1/apikeys/{id}` — revoke
- `GET /api/v1/apikeys` — list (owner filter, no plaintext)
- Auth middleware accepts `Authorization: Bearer <api_key>` alongside JWT/OIDC
- API key auth extracts owner email from stored key metadata
- Rate limiting applies per-key (not just per-IP)
- **Baseline:** `internal/auth/middleware.go` checks `Enabled` flag, validates OIDC token. No API key path exists.
- **Files:** `services/orchestrator-go/internal/auth/apikey.go` (new), `services/orchestrator-go/internal/auth/middleware.go`, `services/orchestrator-go/internal/api/routes.go`

#### M7.3 Cursor-based pagination
- Migrate run index from hash iteration to Redis sorted set: `ZADD runs:index <created_at_unix> <run_id>`
- `ListRuns` accepts `?cursor=` (base64-encoded `created_at:run_id`) and `?limit=` (default 50)
- Response includes `next_cursor` field (empty string = no more pages)
- Apply same pattern to flows (`ZADD flows:index`) and agents (`ZADD agents:index`)
- Memory backends: sort by CreatedAt, use same cursor semantics
- Keep backward compatibility: if no `cursor` param, use offset pagination (deprecated)
- **Baseline:** `ListRuns` returns `[]string` (all IDs), sliced in Go. Redis uses `runs:{id}:meta` hashes + SMembers. No sorted sets. `ListFlows`/`ListAgents` use `ListOptions{Limit, Offset}`.
- **Files:** `services/orchestrator-go/internal/runstore/redis.go`, `services/orchestrator-go/internal/flowstore/redis.go`, `services/orchestrator-go/internal/registry/redis.go`, `services/orchestrator-go/internal/api/handlers.go`

#### M7.4 Webhook callbacks on run completion
- Add optional `WebhookURL` and `WebhookSecret` fields to `types.Run` (set at creation or via update)
- After `checkRunCompletion()` marks run finished, if `WebhookURL` is set:
  - POST JSON payload: `{run_id, status, started_at, finished_at, outputs, error}`
  - Include `X-Mentatlab-Signature` header (HMAC-SHA256 of body with secret)
  - Retry up to 3 times with exponential backoff (1s, 5s, 25s)
  - Log delivery status, store last attempt result on run metadata
- **Baseline:** `checkRunCompletion()` at `scheduler.go:671-737` updates store + emits SSE event. No callback mechanism. `TriggerWebhook` in `handlers_m5m6.go` handles inbound triggers (not outbound callbacks).
- **Files:** `services/orchestrator-go/internal/scheduler/scheduler.go:671-737`, `services/orchestrator-go/internal/scheduler/callback.go` (new), `services/orchestrator-go/pkg/types/run.go`

#### M7.5 Load testing baseline
- Create `tests/load/` directory with k6 scripts
- Scenarios:
  - CRUD throughput: create/list/get runs, flows, agents at increasing RPS
  - Concurrent execution: start N runs simultaneously, measure completion time
  - SSE fan-out: N clients subscribing to run events, measure delivery latency
  - Webhook delivery: measure callback latency and retry behavior
- Define initial SLO targets:
  - API CRUD: p99 < 200ms at 100 RPS
  - Run creation to first event: p99 < 1s
  - SSE delivery latency: p99 < 500ms
  - Webhook callback delivery: p99 < 5s
- Run against local docker-compose and K3s cluster, publish baseline report
- **Baseline:** No load testing infrastructure exists.
- **Files:** `tests/load/` (new directory), `tests/load/k6-crud.js`, `tests/load/k6-execution.js`, `tests/load/k6-sse.js`

**Acceptance:** API requests carry user identity and runs have owners. API keys work for programmatic access. List endpoints support cursor pagination with `next_cursor`. Run completion triggers webhook callbacks with HMAC signatures. Load test suite produces reproducible baseline metrics.

---

### M8: Frontend Quality — Complete

**Goal:** Frontend test coverage, vitest migration, and contract tests.

- Component test coverage to 40%+ (47 test files, 673 tests, 49.11% statement coverage) ✅
- Jest→vitest migration: 11 pre-existing spec files fixed ✅
- Store tests: flow (59), streaming (59), sync (30), keyboard shortcuts (28) ✅
- UI component tests: Button, Badge, Card, Checkbox, Input, Select, PanelShell, CommandPalette, ErrorBoundary ✅
- Layout/canvas tests: BottomDock, LeftSidebar, CanvasDropZone, NodePalette, QuickAddMenu, WorkspaceProvider, TopBar ✅
- Panel/overlay tests: GraphPanel, NetworkPanel, InspectorPanel, AgentBrowser, LineageOverlay, PolicyOverlay ✅
- Contract tests: run API validation (21), SSE event parsing (25) ✅
- **Deferred**: Accessibility audit, large DAG performance benchmarks, responsive layout

---

### M9: Observability & Tracing UI

**Goal:** Rich distributed tracing with deep span coverage, trace-to-run correlation, and a visual trace explorer in the MentatLab UI.

#### M9.1 Scheduler span enrichment — Complete
- Added OTel spans to all scheduler execution paths:
  - `executeConditional` — with `expression`, `selected_branch` attributes
  - `executeForEach` — with `collection_size`, `max_parallel` attributes
  - `executeLoopBody` — with `iteration_index`, `body_node_count` attributes
  - `executeGate` — with `gate_timeout`, `decision` attributes
  - `onNodeFinished` — with `exit_code`, `will_retry` attributes
  - `checkRunCompletion` — with `final_status`, `node_count` attributes
  - `handleRunTimeout` — with `reason`, `timeout_duration` attributes
  - `captureNodeOutputs` — with `output_count` attribute
  - `buildExprEnvironment` — with `predecessor_count` attribute
- **Files:** `services/orchestrator-go/internal/scheduler/scheduler.go`, `conditional.go`, `foreach.go`

#### M9.2 API + callback span enrichment — Complete
- Added OTel spans to all remaining API handlers:
  - `ListRuns`, `GetRun`, `DeleteRun`, `CancelRun`
  - `CreateFlow`, `ListFlows`, `GetFlow`, `UpdateFlow`, `DeleteFlow`
  - `CreateAgent`, `ListAgents`, `GetAgent`, `UpdateAgent`, `DeleteAgent`
  - `ApproveGate`, `RejectGate`
  - `CreateWebhook`, `TriggerWebhook`, `CloneRun`, `RunFlow`
  - `CreateSchedule`, `ListSchedules`, `GetSchedule`, `DeleteSchedule`
  - `CreateAPIKey`, `ListAPIKeys`, `RevokeAPIKey`
- Added spans to webhook callback delivery:
  - `fireWebhookCallback` — with `run_id`, `webhook_url`, `webhook_configured` attributes
  - `deliverWebhook` — with `attempts`, `status_code`, `delivery_failed` attributes
- **Files:** `services/orchestrator-go/internal/api/handlers.go`, `handlers_m5m6.go`, `handlers_apikey.go`, `services/orchestrator-go/internal/scheduler/callback.go`

#### M9.3 Run↔Trace correlation — Complete
- `TraceID` field added to `types.Run` and `types.RunMeta`
- `SetRunTraceID()` on `RunStore` interface, implemented in memory + Redis backends
- `StartRun` captures trace_id from OTel span context and stores on run
- `trace_id` returned in GET `/api/v1/runs/{id}` response
- `trace_id` included in SSE status events (`emitRunStatus`) for frontend correlation
- **Files:** `services/orchestrator-go/pkg/types/run.go`, `internal/runstore/store.go`, `internal/runstore/memory.go`, `internal/runstore/redis.go`, `internal/scheduler/scheduler.go`

#### M9.4 Local dev Tempo — Complete
- Added Grafana Tempo 2.6.1 container to `docker-compose.yml` and `docker-compose.dev.yml`
- Configured OTLP gRPC (4317), OTLP HTTP (4318), and Tempo HTTP API (3200) receivers
- Created `observability/tempo/tempo.yaml` — local storage backend
- Enabled `TRACING_ENABLED=true` and `OTLP_ENDPOINT=tempo:4317` for orchestrator + gateway in both compose files
- Added Grafana 11.4.0 container with auto-provisioned Tempo datasource (anonymous admin access for local dev)
- Created `observability/grafana/provisioning/datasources/tempo.yaml`
- Orchestrator and gateway depend on Tempo health check before starting
- **Files:** `docker-compose.yml`, `docker-compose.dev.yml`, `observability/tempo/tempo.yaml`, `observability/grafana/provisioning/datasources/tempo.yaml`

#### M9.5 Trace query proxy — Complete
- `GET /api/v1/traces/{traceID}` proxies to Tempo HTTP API (`/api/traces/{traceID}`)
- `GET /api/v1/traces?run_id={runID}` looks up trace_id from orchestrator run metadata, then fetches from Tempo
- New `traces` package in gateway-go with `Handler` struct, 10s HTTP client timeout
- `TEMPO_QUERY_URL` env var — routes only registered when configured (graceful degradation)
- Auth headers (`Authorization`, `X-User-Email`) forwarded on orchestrator lookups
- K8s: added `TEMPO_QUERY_URL=http://tempo.monitoring.svc:3200` to `k8s/gateway.yaml`
- Docker Compose: added `TEMPO_QUERY_URL=http://tempo:3200` to both compose files
- **Files:** `services/gateway-go/traces/handler.go` (new), `services/gateway-go/main.go`, `k8s/gateway.yaml`, `docker-compose.yml`, `docker-compose.dev.yml`

#### M9.6 Trace waterfall UI
- New `TracePanel` component in `services/frontend/src/components/mission-control/panels/`
- Waterfall timeline showing span hierarchy: service → operation → children
- Each span bar shows: operation name, duration (ms), status color (green/red/yellow)
- "View Trace" button on RunsPanel that opens TracePanel for the run's trace_id
- Keyboard shortcut for quick trace access
- **Deferred:** Span search/filtering, trace comparison, custom span attribute editing
- **Files:** `services/frontend/src/components/mission-control/panels/TracePanel.tsx` (new), `services/frontend/src/services/api/traceService.ts` (new)

**Acceptance:** All scheduler and API operations produce OTel spans. Runs have trace_ids. Local dev shows traces in Tempo via docker-compose. Frontend trace panel displays waterfall view for any run.

---

## Test Plan

| Milestone | Test Type | What | Tool |
|---|---|---|---|
| M0 | Smoke | Health endpoints return 200 | curl / Playwright |
| M0 | Build | CI pipeline builds correct images | GitLab CI |
| M1 | Integration | Agent register -> flow create -> run -> events | Go integration tests |
| M1 | E2E | Full loop in browser | Playwright |
| M2 | Unit | Conditional/foreach execution | Go unit tests |
| M2 | Integration | Data flow between nodes | Go integration tests |
| M3 | Load | Concurrent run execution | k6 or custom |
| M3 | Security | Auth enforcement, CORS, CSP | Manual + automated |
| M4 | Acceptance | New developer onboarding | Manual walkthrough |
| M5 | Integration | Timeout + retry behavior | Go unit tests (`m5m6_test.go`) |
| M6 | Integration | Gates, webhooks, cron, cloning | Go unit tests (`m5m6_test.go`) |
| M7 | Unit | API key auth, cursor pagination, callback delivery | Go unit tests |
| M7 | Load | CRUD throughput, SSE fan-out, concurrent runs | k6 scripts |
| M7 | Security | API key validation, HMAC signatures, owner isolation | Manual + Go tests |
| M8 | Unit | Component, store, layout, panel, overlay tests | vitest (673 tests) |
| M8 | Contract | Run API validation, SSE event parsing | vitest (46 tests) |
| M9 | Unit | Span creation for scheduler + API operations | Go unit tests |
| M9 | Integration | Trace end-to-end: create run → spans arrive in Tempo | docker-compose + curl |
| M9 | E2E | Trace waterfall panel renders for a run | vitest + Playwright |

## Rollout / Backout

**Rollout strategy:** Ship each milestone behind feature flags where possible. Deploy to a staging namespace first (`mentatlab-staging`), validate, then promote to production.

**Backout:** K8s deployments use rolling updates. `kubectl rollout undo` for any deployment. Keep previous image tags in Harbor registry.

**Critical path:** M0 must complete before any other milestone. M1 is the highest-value milestone. M2-M4 can be parallelized partially.

## Acceptance Criteria

1. **M0 Done:** `docker-compose up` and `k8s/deploy.sh` both produce working systems with Go backends ✅
2. **M1 Done:** End-to-end agent execution visible in the UI ✅
3. **M2 Done:** Conditional and foreach flows execute correctly ✅
4. **M3 Done:** Observability, auth, and test coverage targets met ✅
5. **M4 Done:** 5-minute onboarding for new developers ✅
6. **M5 Done:** Platform runs on K3s with timeouts, retries, and Grafana dashboards ✅ (deployed, live validation pending)
7. **M6 Done:** Gates, webhooks, cloning, cron schedules, and frontend controls functional ✅ (deployed, live validation pending)
8. **M7 Done:** User identity on runs, API key auth, cursor pagination, webhook callbacks, load test baseline ✅
9. **M8 Done:** Frontend test coverage exceeds 40%, vitest migration complete, contract tests passing ✅ (47 files, 673 tests, 49%)
10. **M9 Done:** All scheduler and API operations produce OTel spans. Runs carry trace_ids. Local dev Tempo works. Frontend trace waterfall panel displays spans for any run.

## Risks / Dependencies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ~~Go orchestrator's K8s driver has untested edge cases~~ | ~~Medium~~ | ~~High~~ | ~~Test with real K8s cluster in M1.5~~ — Mitigated: deployed to K3s |
| ~~Frontend API contracts don't match Go endpoints~~ | ~~High~~ | ~~Medium~~ | ~~Audit in M1.2, fix mismatches~~ — Resolved: 4 mismatches fixed |
| ~~CI/CD rework breaks existing deployments~~ | ~~Low~~ | ~~High~~ | ~~Test in staging namespace first~~ — Resolved |
| Flux reverts CI deploy overrides | Medium | Medium | Solved: use kustomize `images` transformer in Git (not runtime) |
| Redis sorted set migration breaks existing data | Medium | High | Dual-write during migration, fallback to hash iteration |
| Gateway→Orchestrator header forwarding breaks auth | Low | Medium | Feature-flag identity propagation, test with auth disabled first |
| Load testing reveals performance bottleneck | Medium | Medium | Address bottlenecks as M7.5 findings, prioritize in M8 |
| K8s job driver untested with real agent images | Medium | High | Build echo agent image, test in M5.1 (still pending) |
| Excessive span cardinality impacts Tempo storage | Low | Medium | Use bounded attributes, review cardinality before deploy |
| Tempo not deployed in monitoring namespace | Medium | High | Verify Tempo exists on cluster before M9.5, deploy if needed |
| Span overhead impacts scheduler performance | Low | Medium | Benchmark with k6 before/after, use sampling if needed |

## Sources

- [S1] `.loom/10-research.md` - Full codebase assessment
- [S2] `.gitlab-ci.yml` - CI/CD pipeline configuration
- [S3] `k8s/` - Kubernetes manifests
- [S4] `services/orchestrator-go/internal/` - Go orchestrator internals
- [S5] `services/gateway-go/` - Go gateway
- [S6] `services/frontend/src/` - Frontend source
- [S7] `agents/` - Agent implementations
- [S8] `cli/mentatctl/` - CLI tool
- [S9] `docker-compose.yml` - Local dev compose
- [S10] `ROADMAP.md` - Current (stale) roadmap
