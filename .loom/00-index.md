# Loom Context Pack

## Quick Links

- Workspace snapshot: `00-workspace-snapshot.md`
- MCP inventory: `00-mcp-inventory.md`
- **Assessment: `10-research.md`** - Full codebase audit with sourced findings
- Product spec: `20-product-spec.md`
- **Implementation plan: `30-implementation-plan.md`** - M0-M4 milestone plan
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

## Key Findings (2026-02-15)

1. **M0 Complete** - Go-first backend, Python archived, engine stub removed, frontend uses nginx
2. **CI/CD Fixed** - e2e test passes (pipeline 1119). Harbor auth uses instance-level CI vars with `raw=true`, e2e pulls `:latest` tags, DinD has `--insecure-registry`
3. **M1 Complete** - Core loop wired, M1 remainders finished (TimelinePanel SSE, flow load-on-boot, agent browser UI)
4. **Go backend API is comprehensive** - runs, agents, flows, artifacts, SSE streaming all have endpoints
5. **Gateway proxies all paths** to orchestrator via reverse proxy + WebSocket hub

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
**M5** Production readiness — IN PROGRESS (backend complete, infra validation pending)
**M6** Workflow maturity — IN PROGRESS (backend + frontend complete, infra validation pending)

## M5 Progress — In Progress

### Completed (Backend)
- **M5.3**: Run-level timeouts — `Plan.Timeout` field on plan, `ORCH_DEFAULT_RUN_TIMEOUT` env var, `context.WithTimeout` in scheduler. Plan-level overrides default. On timeout: cancels active tasks, closes gates, marks run failed with reason "timeout".
- **M5.4**: Configurable per-node retry policies — `RetryPolicy` struct with `MaxRetries`, `BackoffType` (fixed/exponential/linear), `BackoffBase`, `BackoffMax`. Node-level policy overrides global defaults.
- **M5.5**: Grafana dashboards — Two ConfigMaps in `k8s/grafana-dashboards.yaml`: orchestrator dashboard (11 panels: active runs, throughput, node success rate, P99 duration, SSE connections, event throughput, retries, queue depth, K8s jobs, runstore ops) and gateway dashboard (5 panels: request rate, error rate, latency percentiles, SSE duration, requests by path).
- **K8s manifests**: MinIO deployment (`k8s/minio.yaml`), `ORCH_DEFAULT_RUN_TIMEOUT` env var in orchestrator deployment, kustomization updated.
- **Tests**: `m5m6_test.go` — run timeout, retry policy (exponential/fixed/linear/fallback/cap), all passing.

### Pending (Infrastructure)
- [ ] M5.1: Build echo agent image, deploy to K3s, validate K8s job driver
- [ ] M5.2: Deploy MinIO, verify artifact flow end-to-end
- [ ] M5.6: Full-stack smoke test on K3s

## M6 Progress — In Progress

### Completed (Backend + Frontend)
- **M6.1**: Gate nodes — `GateConfig` type, `NodeStatusWaitingApproval` status, `executeGate` in scheduler with approval channels, auto-timeout, `ApproveGate`/`RejectGate` methods, REST endpoints. Frontend `GateNode.tsx` component with approve/reject buttons.
- **M6.2**: Webhook triggers — `WebhookToken` on Flow, `POST /webhooks` generates token, `POST /webhooks/trigger/{flowId}` validates token and creates+starts run.
- **M6.3**: Run cloning — `POST /runs/{id}/clone` copies plan (with optional auto_start), `POST /flows/{id}/run` converts flow graph to plan. `FlowID`/`ParentRunID` lineage on Run type. Frontend clone/re-run buttons in RunsPanel.
- **M6.4**: Cron scheduled runs — `CronRunner` goroutine, 5-field cron parser, schedule CRUD endpoints, `triggerRun` creates runs from flows.
- **M6.5**: Frontend polish — GateNode component registered in GraphPanel, retry policy editor + timeout config in InspectorPanel, clone/re-run buttons in RunsPanel, gate node conversion in WorkspaceProvider.
- **Types**: `GateConfig`, `RetryPolicy`, `BackoffType` added to frontend types. `RunPlan.timeout`, `Run.flow_id`/`parent_run_id`, `RunStatus.waiting_approval` added.
- **API client**: `approveGate`, `rejectGate`, `cloneRun`, `runFlow` methods added to `orchestratorService.ts`.
- **Tests**: `m5m6_test.go` — gate approve/reject/timeout, cron parsing, CronRunner CRUD, all passing.

### Pending (Infrastructure)
- [ ] Live validation of gates, webhooks, cron on K3s cluster

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
- [ ] Tracing UI: Visual trace exploration (deferred — requires OTLP query backend + frontend waterfall component)

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
