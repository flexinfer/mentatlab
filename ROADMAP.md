# Project Roadmap

## Tracking
- [Roadmap tracking issue](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/1)
- [Detailed implementation plan](.loom/30-implementation-plan.md)

> Last Updated: 2026-02-19

## Current Status

MentatLab is an AI agent orchestration platform with a Mission Control interface for building, monitoring, and executing agent workflows as DAGs. The backend uses Go services (gateway-go, orchestrator-go). Python agents communicate via stdin/stdout NDJSON contract.

**M0-M9 are code-complete.** The platform has a working Go backend, React frontend with ReactFlow canvas, DAG execution with conditionals/foreach/gates, cron scheduling, webhook triggers, API key auth, cursor pagination, OTel tracing with Tempo, and 49% frontend test coverage. Deployed to K3s via Flux CD.

**Next phase** focuses on live validation, loom/MCP integration, agent SDK maturity, and hardening.

---

## Completed Milestones

### M0: Foundation — Complete

- Go-first backend: gateway-go + orchestrator-go replace legacy Python services
- CI/CD pipeline builds correct Go images, pushes to Harbor
- Docker Compose uses Go services for local dev
- Frontend serves via nginx (production) with SPA routing
- Legacy Python services archived to `archive/`
- Engine stub removed; single entry point via `cmd/orchestrator/`

### M1: Core Loop — Complete

- Agent command resolution with fallback resolver
- Frontend API wiring: `/api/v1` prefix, SSE URL, field name mismatches fixed
- Canvas-to-run wiring: Run button → RunPlan → `createRun(auto_start=true)`
- TimelinePanel wired to orchestrator SSE; flow persistence via `useFlowLoader`
- Agent browser UI with list + detail views

### M2: Workflow Power — Complete

- Conditionals (if/else, switch/case), ForEach sub-DAG execution
- Agent output capture via NDJSON `type: "output"` events
- Node-to-node data flow via expression environment (`inputs.nodeId.field`)
- Contract overlay wired to agent registry schemas

### M3: Production Hardening — Complete

- OpenTelemetry tracing in both services, trace_id in structured logs
- Business metrics in scheduler (runs_active, runs_total, node_duration, etc.)
- OIDC auth middleware + per-IP rate limiting
- K8s images pinned, PDBs consolidated, 15 handler tests, CI coverage

### M4: Developer Experience — Complete

- Go agent template, 3 example flows, rewritten README
- Demo mode with bundled example flows
- mentatctl `dev run` with `--local` subprocess mode and `--watch`

### M5: Production Readiness — Deployed

Backend complete. Deployed to K3s. Live K8s job driver and MinIO artifact tests pending.

- **M5.1**: K8s job driver — Job creation confirmed, 3 bug fixes shipped. Full e2e pending. ([Issue #13](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/13))
- **M5.2**: MinIO data flow — deployed, pending artifact test ([Issue #14](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/14))
- **M5.3**: Run-level timeouts ✅ ([Issue #15](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/15))
- **M5.4**: Per-node retry policies (fixed/exponential/linear backoff) ✅ ([Issue #16](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/16))
- **M5.5**: Grafana dashboards as ConfigMaps ✅ ([Issue #17](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/17))
- **M5.6**: Full-stack smoke test — services running, execution test pending ([Issue #18](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/18))

### M6: Workflow Maturity — Deployed

Backend + frontend complete. All API endpoints verified responsive on K3s.

- **M6.1**: Manual approval gates ✅ ([Issue #19](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/19))
- **M6.2**: Webhook triggers ✅ ([Issue #20](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/20))
- **M6.3**: Run templates and cloning ✅ ([Issue #21](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/21))
- **M6.4**: Cron scheduled runs ✅ ([Issue #22](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/22))
- **M6.5**: Frontend polish ✅ ([Issue #23](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/23))

### M7: Multi-User & API Maturity — Complete

- **M7.1**: User identity propagation ✅ ([Issue #30](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/30))
- **M7.2**: API key authentication ✅ ([Issue #31](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/31))
- **M7.3**: Cursor-based pagination ✅ ([Issue #32](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/32))
- **M7.4**: Webhook callbacks on run completion ✅ ([Issue #33](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/33))
- **M7.5**: Load testing baseline ✅ ([Issue #34](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/34))

### M8: Frontend Quality — Complete

47 test files, 673 tests, 49% statement coverage (target 40%+). Jest→vitest migration complete.

### M9: Observability & Tracing UI — Complete

Deep OTel span coverage, run↔trace correlation, local Tempo, gateway trace proxy, frontend TracePanel waterfall. ([Issue #7](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/7))

---

## Active Roadmap

### M10: Live Validation & Stabilization

**Goal:** Close the gap between "deployed" and "production-validated." Resolve pending live tests from M5/M6 and harden infrastructure.

#### M10.1 K8s job driver end-to-end

- Build and push echo agent image to Harbor
- Execute a run using K8s job driver with `K8S_IN_CLUSTER=true`
- Validate Job creation, NDJSON log streaming, success/failure reporting
- Test failure cases: image pull error, timeout, cancellation
- Source: `services/orchestrator-go/internal/driver/k8s.go`, [Issue #13](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/13)

#### M10.2 MinIO artifact flow

- Exercise artifact endpoints: upload, list, download, delete through orchestrator API
- Test agent-to-artifact flow: agent writes output → orchestrator stores in MinIO → downstream node reads
- Add artifact TTL cleanup (prevent unbounded storage growth)
- Source: `services/orchestrator-go/internal/dataflow/s3.go`, [Issue #14](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/14)

#### M10.3 Gate and webhook live tests

- Test gate approval flow in browser with an active run containing a gate node
- Test webhook trigger from an external HTTP client
- Verify cron schedules fire on time (deploy a 1-minute schedule, observe run creation)
- Source: [Issue #19](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/19), [Issue #20](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/20)

#### M10.4 DAG validation hardening

- Add cycle detection before run execution (prevents scheduler deadlocks)
- Validate conditional expressions select valid branches at design time
- Add memory protection for large ForEach collections (cap concurrent body nodes)
- Source: `services/orchestrator-go/internal/validator/validator.go:276-361`, [Issue #35](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/35)

#### M10.5 WebSocket reconnection

- Implement exponential backoff reconnection in gateway WebSocket hub
- Add idle connection culling with configurable heartbeat timeout
- Add client-side reconnection in frontend SSE/WS transport
- Source: `services/gateway-go/hub/hub.go:259`, `services/frontend/src/services/api/streaming/`, [Issue #36](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/36)

**Acceptance:** All M5/M6 pending items validated on live K3s cluster. DAG cycle detection prevents deadlocks. WebSocket connections recover from transient failures.

---

### M11: Loom / MCP Integration

**Goal:** Bridge MentatLab's agent orchestration with the loom MCP ecosystem. Enable MCP tools as agent nodes, expose MentatLab orchestration as MCP tools, and connect agent sessions to loom's persistent context.

#### M11.1 MCP-Tool-as-Agent adapter

Tracking issue: [#37](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/37)

Create a universal "loom-mcp-executor" agent that wraps any loom MCP tool as a MentatLab agent node.

- New agent in `agents/loom-mcp-executor/` with NDJSON stdin/stdout contract
- Accepts `tool_name` and `tool_args` as inputs, calls the MCP tool via loom proxy socket
- Maps MCP tool result → NDJSON `type: "output"` event for downstream data flow
- Register in agent manifest with dynamic input schema derived from MCP tool schemas
- Initial targets: `k8s_apps_k3s`, `gitlab`, `docker`, `prometheus` tools as canvas-draggable nodes
- Source: `agents/common/emit.py`, `platform/gitops/mcp/context/registry.yaml`

#### M11.2 MentatLab-as-MCP-server

Tracking issue: [#38](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/38)

Create `mcp-mentatlab` server in loom-core exposing orchestrator operations as MCP tools.

- `mentatlab__create_flow` — POST `/api/v1/flows`
- `mentatlab__run_flow` — POST `/api/v1/flows/{id}/run`
- `mentatlab__get_run` — GET `/api/v1/runs/{id}`
- `mentatlab__list_runs` — GET `/api/v1/runs` with cursor pagination
- `mentatlab__cancel_run` — POST `/api/v1/runs/{id}/cancel`
- `mentatlab__stream_events` — SSE `/api/v1/runs/{id}/events` (returns events as tool result)
- Register in `platform/gitops/mcp/context/registry.yaml` under `orchestration` category
- Source: `services/orchestrator-go/internal/api/`, `services/loom-core/cmd/`

#### M11.3 Agent context integration

Tracking issue: [#39](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/39)

Connect MentatLab runs to loom agent-context sessions for persistent memory across executions.

- Map each MentatLab run → `agent_session_start` (auto-created, namespace = `mentatlab/{flow_id}`)
- Map node events → `agent_context_add` entries (decisions, findings, code annotations)
- Map run completion → `agent_session_end` with auto-summary
- Inject `LOOM_SESSION_ID` env var into agent subprocess/K8s Job environment
- Python agent SDK: add `loom_context_recall(query)` and `loom_context_add(entry)` helpers
- Source: `services/orchestrator-go/internal/scheduler/scheduler.go`, `services/loom-core/cmd/mcp-agent-context/`

#### M11.4 Workflow bridge (loom workflows ↔ MentatLab flows)

Tracking issue: [#40](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/40)

Enable bidirectional conversion between loom workflow definitions and MentatLab flow graphs.

- Export: MentatLab canvas → `agent_workflow_define` call (nodes → steps, edges → dependencies)
- Import: loom workflow definition JSON → MentatLab `.mlab` flow file → canvas render
- Frontend: "Import from Loom" button in flow editor, "Export to Loom" in flow menu
- Source: `services/frontend/src/components/mission-control/`, `services/loom-core/cmd/mcp-agent-context/tools_workflows.go`

#### M11.5 MCP tool palette in canvas

Tracking issue: [#41](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/41)

Populate the frontend node palette with available MCP tools from the loom proxy.

- Query `loom://tools/index` at startup to discover available MCP tools
- Group tools by server category (k8s, git, monitoring, etc.)
- Drag MCP tool node onto canvas → auto-configure input schema from tool's `inputSchema`
- Wire to M11.1 loom-mcp-executor agent for execution
- Source: `services/frontend/src/components/mission-control/panels/`, `loom://tools/index`

**Acceptance:** A user can drag a `k8s_getPods` MCP tool onto the canvas, wire it into a flow, and execute it. MentatLab runs appear as loom agent sessions with persistent context. External agents can trigger MentatLab flows via `mentatlab__run_flow` MCP tool.

---

### M12: Agent SDK & Runtime Maturity

**Goal:** Strengthen the agent contract, add multi-language SDK support, and enable richer agent-to-orchestrator communication.

#### M12.1 Structured error events

- Add `type: "error"` event with `code` (transient/permanent/timeout), `message`, `retryable` fields
- Orchestrator distinguishes transient errors (retry) from permanent (fail node immediately)
- Update Python SDK `emit.py` with `emit_error(code, message, retryable=False)`
- Add Go SDK equivalent in `cli/mentatctl/templates/go/`
- Source: `agents/common/emit.py`, `services/orchestrator-go/internal/scheduler/scheduler.go:554`

#### M12.2 Progress and heartbeat events

- Add `type: "progress"` event with `percent`, `message`, `eta_seconds` fields
- Frontend: progress bar on agent nodes during execution
- Add `type: "heartbeat"` event — orchestrator uses absence to detect hung agents
- Configurable heartbeat timeout per node (default 60s)
- Source: `services/orchestrator-go/internal/driver/subprocess.go`

#### M12.3 Agent capability declarations

- Extend `manifest.yaml` with `capabilities` section: `gpu`, `network`, `storage`, `secrets`
- Add `resources` section: `cpu`, `memory`, `timeout`, `max_concurrent`
- Orchestrator uses capabilities for K8s node affinity and resource allocation
- Validator rejects flows that pair agents with unsupported node types
- Source: `schemas/agent.schema.json`, `services/orchestrator-go/internal/driver/k8s.go:70`

#### M12.4 TypeScript agent SDK

- Create `agents/sdk-ts/` with TypeScript agent SDK (Node.js)
- NDJSON stdin/stdout contract with typed event emitters
- `createAgent({ onInput, onCancel })` factory function
- Publish as npm package for external agent authors
- Source: `agents/common/emit.py` (reference implementation)

#### M12.5 Agent state persistence

- Add `type: "checkpoint"` event with `state` payload (arbitrary JSON, max 1MB)
- Orchestrator stores checkpoint in Redis/MinIO keyed by `run_id:node_id`
- On retry, orchestrator passes last checkpoint as `resume_state` in agent input
- Enables long-running agents to resume from last known state
- Source: `services/orchestrator-go/internal/runstore/store.go`

**Acceptance:** Agents emit structured errors that orchestrator handles correctly. Progress bars render during execution. TypeScript SDK published. Agent checkpoints survive retries.

---

### M13: Security & Authorization Hardening

**Goal:** Move from coarse "any valid token" auth to fine-grained access control, audit logging, and agent sandboxing.

#### M13.1 Scope-based authorization

- Define scopes: `runs:read`, `runs:write`, `runs:execute`, `flows:read`, `flows:write`, `agents:manage`, `admin`
- API key creation accepts `scopes` array, stored alongside key metadata
- Auth middleware validates required scope per endpoint (not just token presence)
- OIDC claims map to scopes via configurable rules
- Source: `services/orchestrator-go/internal/auth/apikey.go`, `services/orchestrator-go/internal/auth/middleware.go`

#### M13.2 Audit logging

- Log all state-changing API calls: who, when, what, from where
- Structured JSON audit events to dedicated log stream (separate from application logs)
- Track API key usage: last_used, request count, endpoint histogram
- Queryable via Loki (`{app="mentatlab-orchestrator", log_type="audit"}`)
- Source: `services/orchestrator-go/internal/api/`

#### M13.3 Agent sandboxing

- K8s: set `securityContext` with `runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`
- Add default NetworkPolicy restricting agent pod egress (allow only orchestrator callback + configurable allowlist)
- Subprocess driver: `--network=none` Docker flag for local dev sandboxing
- Source: `services/orchestrator-go/internal/driver/k8s.go`, `k8s/orchestrator-rbac.yaml`

#### M13.4 Per-API-key rate limiting

- Extend rate limiter to support per-key limits (not just per-IP)
- Configurable per-key RPS and burst in key metadata
- Return `X-RateLimit-Remaining` and `Retry-After` headers
- Source: `services/orchestrator-go/internal/auth/`, `services/gateway-go/middleware/`

**Acceptance:** API keys have scopes enforced per endpoint. All mutations produce audit log entries. Agent pods run with restricted security contexts. Per-key rate limiting prevents abuse.

---

### M14: Frontend UX & Performance

**Goal:** Polish the Mission Control experience for real-world use. Enable disabled feature flags and improve large-DAG performance.

#### M14.1 Enable S3 artifact management UI

- Implement artifact browser panel: list, download, preview artifacts per run
- Wire to orchestrator artifact endpoints (M10.2 prerequisite)
- Enable `S3_STORAGE` feature flag
- Source: `services/frontend/src/config/features.ts:14`

#### M14.2 Console virtualization

- Enable `CONSOLE_VIRTUALIZATION` feature flag with react-window
- Benchmark with 10k+ log lines to validate scroll performance
- Add log search/filter within virtualized console
- Source: `services/frontend/src/config/features.ts:82`

#### M14.3 WebSocket auto-connect and reconnection

- Enable `AUTO_CONNECT` feature flag for automatic WebSocket connection on page load
- Implement client-side reconnection with exponential backoff (pairs with M10.5)
- Add connection status indicator in TopBar
- Source: `services/frontend/src/config/features.ts:19`

#### M14.4 Large DAG performance

- Profile canvas rendering with 100+ node DAGs
- Implement viewport-based node rendering (only render visible nodes)
- Add minimap for navigation on large graphs
- Source: `services/frontend/src/components/StreamingCanvas.tsx`

#### M14.5 Accessibility and keyboard navigation

- Audit against WCAG 2.1 AA for Mission Control panels
- Add keyboard navigation for node selection, panel switching, run management
- Screen reader support for run status changes and event stream
- Source: `services/frontend/src/components/mission-control/`

**Acceptance:** Artifacts browsable in UI. Console handles 10k+ lines without lag. Auto-connect enabled. 100-node DAGs render smoothly.

---

### M15: E2E Testing & CI Hardening

**Goal:** Comprehensive integration tests in CI pipeline. Close the gap between unit tests and production validation.

#### M15.1 CI smoke tests

- Add smoke test stage to `.gitlab-ci.yml` that boots docker-compose, creates a flow, runs it, and verifies SSE events
- Test covers: agent registration → flow creation → run execution → event streaming → completion
- Runs on every MR, not just main branch pushes
- Source: `.gitlab-ci.yml`, `docker-compose.yml`

#### M15.2 Playwright E2E suite

- Canvas interaction: drag agent node, connect edges, save flow
- Run execution: start run, observe events in console panel, verify completion
- Trace panel: click "View Trace", verify waterfall renders
- Gate flow: create gate node, start run, approve gate, verify completion
- Source: `services/frontend/e2e/`

#### M15.3 Agent contract compliance tests

- Validate all agents in `agents/` against `schemas/agent.schema.json`
- Test NDJSON event contract: correct event types, required fields, encoding
- Add contract test for M11.1 loom-mcp-executor agent
- Source: `agents/`, `schemas/`

#### M15.4 Load regression gate

- Run k6 load tests (M7.5) in CI on main branch merges
- Fail pipeline if p99 latency exceeds SLO thresholds
- Track performance trend over time in Grafana
- Source: `tests/load/`

**Acceptance:** CI pipeline includes smoke test, E2E suite, contract validation, and load regression gate. MR failures caught before merge.

---

## Deferred (Future)

These features have zero implementation and are parked for future consideration:

- **Agent Marketplace**: Web-based discovery with search & ratings ([Issue #8](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/8))
- **Publisher Profiles**: Reputation system and verification ([Issue #9](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/9))
- **Review System**: Community reviews and moderation ([Issue #10](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/10))
- **Security Scanning**: Automated vulnerability analysis ([Issue #11](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/11))
- **WASM Runtime**: Sandboxed execution for agents ([Issue #12](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/12))
- **Signed Attestations / PKI**: Cryptographic agent manifest verification ([Issue #24](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/24))
- **Advanced Metrics**: Custom dashboards and alerting ([Issue #6](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/6))
- **Lineage Overlay**: Artifact lineage tracking (requires M10.2 artifact backend)
- **Policy Overlay**: Budget/PII/safety guardrails (requires policy engine)

---

## Milestone Dependency Graph

```
M0-M9 (Complete)
  │
  ├─→ M10 (Live Validation)
  │     │
  │     ├─→ M11 (Loom/MCP Integration) ←── key integration milestone
  │     │     │
  │     │     └─→ M14.1 (Artifact UI, needs M10.2)
  │     │
  │     └─→ M13 (Security Hardening)
  │
  ├─→ M12 (Agent SDK Maturity) ←── independent track
  │
  ├─→ M14 (Frontend UX) ←── partially depends on M10
  │
  └─→ M15 (E2E Testing) ←── can start immediately
```

**Recommended execution order:** M10 and M15 can start in parallel. M11 depends on M10.1-M10.2 for live infrastructure. M12 is independent. M13 and M14 can follow as capacity allows.

---

## References

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | Project overview |
| [AGENTS.md](AGENTS.md) | Agent guidance |
| [.loom/30-implementation-plan.md](.loom/30-implementation-plan.md) | Detailed M0-M9 plan |
| [.loom/00-index.md](.loom/00-index.md) | Progress tracking |
| [docs/archive/milestone-specs/](docs/archive/milestone-specs/) | Archived aspirational specs (WASM, PKI, etc.) |
| [platform/gitops/mcp/context/registry.yaml](../../../platform/gitops/mcp/context/registry.yaml) | MCP server registry (loom integration source) |
| [services/loom-core/](../../loom-core/) | Loom MCP server framework |
