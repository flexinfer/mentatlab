# Loom Context Pack

## Quick Links

- Workspace snapshot: `00-workspace-snapshot.md`
- MCP inventory: `00-mcp-inventory.md`
- **Assessment: `10-research.md`** - Full codebase audit with sourced findings
- Product spec: `20-product-spec.md`
- **Implementation plan: `30-implementation-plan.md`** - M0-M9 milestone plan
- **Decisions: `40-decisions.md`** - Go-first, archive aspirational specs, keep agents
- Worklog: `50-worklog.md`

## Current Goal

- [x] Assess actual codebase state vs documented claims
- [x] Identify critical infrastructure issues blocking deployment
- [x] Produce evidence-based implementation plan (M0-M4)
- [x] Execute M0: Foundation (Infrastructure Fix)
- [x] Fix CI/CD pipeline (e2e test, deploy script)
- [x] Execute M1: Core Loop (Agent Dev + Execution)
- [x] Execute M2: Workflow Power (conditionals, foreach, data flow)
- [x] Execute M3: Production Hardening (observability, auth, testing)
- [x] Execute M4: Developer Experience (CLI, docs, examples) — tracing UI deferred
- [x] Execute M5-M6: Backend implementation (timeouts, retries, gates, webhooks, cron, cloning)
- [x] Deploy M5-M6 to K3s cluster (fix image tags, network policies, nginx volumes)
- [x] Execute M7: Multi-User & API Maturity
- [x] Execute M8: Frontend Quality (47 test files, 673 tests, 49% coverage)
- [x] Execute M9: Observability & Tracing UI (span enrichment → trace query → waterfall UI)

## Key Findings (2026-02-18)

1. **M0-M9 Complete** — Go-first backend, CI/CD, core loop, workflow features, hardening, dev experience, multi-user, API maturity, frontend quality, observability & tracing
2. **M5-M6 Backend Complete** — Timeouts, retry policies, gates, webhooks, cron, cloning all implemented with tests
3. **Deployed to K3s** — All pods Running, Flux Ready, MinIO bucket created, M5-M6 endpoints verified
4. **Deploy lessons** — Flux overrides CI kustomize edits; need `images` transformer. `:latest` + `IfNotPresent` = stale. NetworkPolicies must explicitly allow MinIO traffic.
5. **M7 implemented** — User identity propagation, API key auth, cursor pagination, webhook callbacks, load testing baseline
6. **M8 implemented** — 47 test files, 673 tests, 49.11% statement coverage (target 40%+), jest→vitest migration, all pre-existing specs fixed
7. **M9 implemented** — Deep OTel span coverage (scheduler + all API handlers), run↔trace correlation, Tempo in docker-compose, gateway trace proxy, frontend TracePanel waterfall

## M1 Progress — Complete

### Completed (core path)
- **M1.1**: Agent command resolution — default agents have Command fields, fallback resolver maps `mentatlab.echo` → `agents/echo/main.py`
- **M1.2**: All 4 frontend API mismatches fixed — `/api/v1` prefix, SSE URL, `sse_url` field name
- **Canvas wiring**: "Run" button reads canvas state, converts to RunPlan, calls createRun(auto_start=true). Graph panel SSE subscription works.

### Completed (Feb 15 remainders)
- **TimelinePanel SSE**: Replaced `flightRecorder` mock with real orchestrator SSE subscription using `parseRunEvent`
- **Flow persistence**: `useFlowLoader` hook loads flows from backend API on mount; populates flow store if empty
- **Agent browser UI**: `AgentBrowser` panel consuming `agentService.ts` with list + detail views, added as "Agents" tab in BottomDock
- **E2E test**: Reviewed and ready; requires docker-compose stack

## M2 Progress — Complete

### Completed
- **Conditionals**: 100% done — if/else, switch/case, branch skipping with full test coverage
- **ForEach sub-DAG execution**: Body nodes now schedule via dependency graph instead of sequential-only. Independent body nodes run in parallel.
- **Agent output capture**: After successful node execution, scans events for `type: "output"`, stores via `runstore.SetNodeOutputs()`. Downstream nodes access via expression environment (`inputs.node_id.field`).
- **Contract overlay**: Wired to agent registry schemas via `useAgentSchemas` hook. Populates `node.data.inputs/outputs` from agent manifest schemas.
- **Canvas → RunPlan conversion**: Fixed control flow node mapping. ForEach and Conditional nodes now build nested config objects with proper camelCase → snake_case field mapping.

### Deferred to M3
- **Lineage overlay**: Requires artifact tracking backend (no implementation exists)
- **Policy overlay**: Requires policy engine (no implementation exists)

## M3 Progress — Complete

### Completed
- **Health probes**: Orchestrator readiness probe fixed (`/healthz` → `/ready`). Gateway returns 503 when Redis unhealthy (was 200 "degraded").
- **Tracing init**: Orchestrator now calls `tracing.Init()` on startup (same pattern as gateway). Config fields `TracingEnabled`/`OTLPEndpoint` loaded from env vars. Graceful shutdown wired.
- **Trace ID in logs**: Both services extract trace ID from OTel span context and include `trace_id` in structured log output.
- **Business metrics**: Scheduler now increments `runs_active`, `runs_total`, `nodes_total`, `node_duration`, `node_retries`, `events_total` — all metrics that were defined but never recorded.
- **Tracing spans**: OTel spans added to `scheduler.StartRun`, `scheduler.scheduleNode`, `api.CreateRun`, `api.StartRun`, `api.StreamEvents` with `run_id`/`node_id` attributes.
- **Dataflow service**: `dataflow.New()` initialized from `DATAFLOW_TYPE`/`MINIO_*` env vars. Passed to `HandlerOptions.DataflowSvc`. Artifact endpoints now functional when MinIO configured.
- **Auth middleware**: OIDC auth middleware conditionally initialized when `OIDC_ENABLED=true`. Applied to API subrouter. Health/metrics/ready paths excluded. Disabled by default.
- **Rate limiting**: Per-IP rate limiter applied to API subrouter via `auth.NewPerIPRateLimiter`. Config from `RateLimitRPS`/`RateLimitBurst`.
- **K8s manifests**: Image tags pinned to `:v0.0.0-placeholder` (CI overrides via kustomize). `imagePullPolicy: IfNotPresent`. OTLP env vars added. Duplicate PDBs removed (consolidated in `hpa.yaml`).
- **Handler tests**: 15 tests covering Health, Ready, CreateRun, ListRuns, GetRun (200+404), StartRun (503 no scheduler), Agent CRUD, Flow CRUD, SSE content-type + 404, Artifacts 503 without dataflow.
- **CI coverage**: `go test -coverprofile` + `go tool cover -func` in test-go. Frontend `--coverage` flag. Coverage regex for GitLab badge.

### Key PromQL queries for Grafana dashboards
- Active runs: `mentatlab_orchestrator_runs_active`
- Run throughput: `rate(mentatlab_orchestrator_runs_total[5m])`
- Node success rate: `rate(mentatlab_orchestrator_nodes_total{status="succeeded"}[5m]) / rate(mentatlab_orchestrator_nodes_total[5m])`
- P99 node duration: `histogram_quantile(0.99, rate(mentatlab_orchestrator_node_duration_seconds_bucket[5m]))`
- SSE connections: `mentatlab_orchestrator_sse_active_connections`
- Event throughput: `rate(mentatlab_orchestrator_events_total[5m])`

## Strategy: Go-First Reboot

**M0** ~~Fix infrastructure~~ DONE
**M1** ~~Wire the core loop~~ DONE
**M2** ~~Enable workflow features~~ DONE (conditionals, foreach sub-DAG, data flow, contract overlay, canvas→RunPlan wiring; lineage/policy deferred to M3)
**M3** ~~Harden for production~~ DONE (observability, auth, testing, K8s manifests)
**M4** ~~Polish developer experience~~ DONE (tracing UI deferred)
**M5** Production readiness — DEPLOYED (backend complete, K3s deployment validated, infra live-tests pending)
**M6** Workflow maturity — DEPLOYED (backend + frontend complete, K3s deployment validated, live-tests pending)
**M7** Multi-user & API maturity — DONE
**M8** Frontend quality — DONE (47 files, 673 tests, 49% coverage)
**M9** Observability & tracing UI — DONE (spans, correlation, Tempo, trace proxy, waterfall UI)

## M5 Progress — Deployed

### Completed (Backend + Infra)
- **M5.3**: Run-level timeouts — `Plan.Timeout` field on plan, `ORCH_DEFAULT_RUN_TIMEOUT` env var, `context.WithTimeout` in scheduler.
- **M5.4**: Configurable per-node retry policies — `RetryPolicy` struct with fixed/exponential/linear backoff.
- **M5.5**: Grafana dashboards — orchestrator (11 panels) + gateway (5 panels) as ConfigMaps.
- **K8s deployment**: MinIO running with bucket created, Grafana dashboards applied to monitoring namespace.
- **Deploy fixes**: Image tag transformer in kustomization.yaml, `imagePullPolicy: Always`, MinIO NetworkPolicies, nginx volume mounts.
- **Tests**: `m5m6_test.go` — all passing.

### Pending (Live Validation)
- [ ] M5.1: Build echo agent image, validate K8s job driver end-to-end
- [ ] M5.2: Test artifact upload/download flow through MinIO
- [ ] M5.6: Full-stack smoke test with run execution on K3s

## M6 Progress — Deployed

### Completed (Backend + Frontend + Infra)
- **M6.1**: Gate nodes — GateConfig, waiting_approval status, approve/reject REST + frontend.
- **M6.2**: Webhook triggers — per-flow tokens, trigger endpoint creates+starts runs.
- **M6.3**: Run cloning — clone endpoint, flow→run shortcut, lineage tracking.
- **M6.4**: Cron scheduled runs — CronRunner goroutine, 5-field parser, schedule CRUD.
- **M6.5**: Frontend polish — GateNode, retry editor, timeout config, clone/re-run buttons.
- **K8s deployment**: All endpoints verified on cluster (`/api/v1/schedules` responds).

### Pending (Live Validation)
- [ ] Test gate approval flow in browser (requires active run with gate node)
- [ ] Test webhook trigger from external system
- [ ] Verify cron triggers fire on schedule

## M4 Progress — Complete

### Completed (M4)
- **Archive aspirational specs**: Moved 13 milestone spec files to `docs/archive/milestone-specs/`
- **Go agent template**: Created `cli/mentatctl/templates/go/` with full NDJSON contract implementation
- **Example flows**: 3 new flows: `conditional_routing.json`, `foreach_batch.json`, `data_pipeline.json`
- **README.md update**: Rewrote root README with accurate quickstart, architecture, config, and docs links
- **Agent SDK docs**: Added `type: "output"` event documentation, `emitOutput()` Go helper
- **Docs index**: Rewrote `docs/README.md` with organized tables
- **Demo mode**: `DEMO_MODE` feature flag + bundled example flows in `exampleFlows.ts`. `useFlowLoader` falls back to examples when backend empty or unreachable.
- **mentatctl dev run**: Fixed endpoint (`/api/v1/runs`), port (7070), implemented `--local` subprocess mode with NDJSON parsing, added `--watch` for file-change re-runs

### Remaining
- [ ] Tracing UI: Now scoped as M9 (span enrichment → query proxy → waterfall panel)

## M7 Progress — Complete

### Completed
- **M7.1**: User identity propagation — gateway forwards `X-User-Email`/`X-User-Type` headers, `Run.Owner` field, `ListRunsWithOptions` owner filter, `CreateFlow` sets `CreatedBy` from headers.
- **M7.2**: API key authentication — Redis-backed `APIKeyStore` (`mlk_` prefix, sha256 hashed), auth middleware checks API key before OIDC fallback, CRUD handlers at `/apikeys`.
- **M7.3**: Cursor-based pagination — base64 `timestamp:id` cursors, Redis sorted set index (`ZADD`/`ZREVRANGEBYSCORE`), `next_cursor` in `ListRuns` response, legacy offset fallback preserved.
- **M7.4**: Webhook callbacks on run completion — `fireWebhookCallback` at 3 terminal states, HMAC-SHA256 signed POST (`X-MentatLab-Signature`), 3 retries with exponential backoff.
- **M7.5**: Load testing baseline — k6 script with 3 scenarios (CRUD throughput, concurrent runs, pagination stress), SLO thresholds defined.
- **Tests**: 4 M7-specific tests (`handlers_m7_test.go`), full suite passing.

### Key Sources
- `services/orchestrator-go/internal/auth/apikey.go` — API key store
- `services/orchestrator-go/internal/scheduler/callback.go` — webhook delivery
- `services/orchestrator-go/internal/runstore/store.go` — pagination types, cursor helpers, SetRunWebhook
- `services/orchestrator-go/internal/api/handlers_m7_test.go` — M7 tests
- `tests/load/orchestrator.js` — k6 load test

## Open Questions

- [ ] Does the Go orchestrator's K8s driver work with real clusters? (test in M1.5)
- [x] ~~Is MinIO data flow implemented in Go orchestrator?~~ — DataFlow service exists but MinIO backend not wired. Expression-based data flow works via runstore.
- [ ] What's the desired auth model - Cloudflare Access only or also local dev auth? (decide in M3.3)

## Risks

- [x] ~~CI builds wrong images~~ - Was already correct
- [x] ~~E2E test can't pull from Harbor~~ - Fixed: DinD `--insecure-registry` + `docker login` with instance-level vars (`raw=true`) + `:latest` tags
- [x] ~~deploy.sh references Python Dockerfiles~~ - Fixed
- [x] ~~Frontend API contracts may not match Go endpoints~~ - Fixed: 4 mismatches resolved in M1.2
- [x] ~~Console/Timeline panels use mock events~~ - Fixed: TimelinePanel wired to orchestrator SSE
- [ ] Large artifact data flow needs MinIO backend wiring (M3 scope)
