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

## Rollout / Backout

**Rollout strategy:** Ship each milestone behind feature flags where possible. Deploy to a staging namespace first (`mentatlab-staging`), validate, then promote to production.

**Backout:** K8s deployments use rolling updates. `kubectl rollout undo` for any deployment. Keep previous image tags in Harbor registry.

**Critical path:** M0 must complete before any other milestone. M1 is the highest-value milestone. M2-M4 can be parallelized partially.

## Acceptance Criteria

1. **M0 Done:** `docker-compose up` and `k8s/deploy.sh` both produce working systems with Go backends
2. **M1 Done:** End-to-end agent execution visible in the UI
3. **M2 Done:** Conditional and foreach flows execute correctly
4. **M3 Done:** Observability, auth, and test coverage targets met
5. **M4 Done:** 5-minute onboarding for new developers
6. **M5 Done:** Platform runs on K3s with timeouts, retries, and Grafana dashboards
7. **M6 Done:** Gates, webhooks, cloning, cron schedules, and frontend controls functional

## Risks / Dependencies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Go orchestrator's K8s driver has untested edge cases | Medium | High | Test with real K8s cluster in M1.5 |
| Frontend API contracts don't match Go endpoints | High | Medium | Audit in M1.2, fix mismatches |
| Data flow between nodes (MinIO) not implemented in Go | Medium | High | Check `internal/dataflow/` in M2.3; may need implementation |
| CI/CD rework breaks existing deployments | Low | High | Test in staging namespace first |
| Python agent compatibility with Go orchestrator | Low | Medium | Agent contract is stdin/stdout; should be backend-agnostic |

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
