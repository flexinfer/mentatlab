# Project Roadmap

## Tracking
- [Roadmap tracking issue](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/1)
- [Detailed implementation plan](.loom/30-implementation-plan.md)

> Last Updated: February 2026

## Current Status

MentatLab is an AI agent orchestration platform with a Mission Control interface for building, monitoring, and executing agent workflows as DAGs. The backend uses Go services (gateway-go, orchestrator-go). Python agents communicate via stdin/stdout NDJSON contract.

### M0: Foundation — Complete

- Go-first backend: gateway-go + orchestrator-go replace legacy Python services
- CI/CD pipeline builds correct Go images, pushes to Harbor
- Docker Compose uses Go services for local dev
- Frontend serves via nginx (production) with SPA routing
- Legacy Python services archived to `archive/`
- Engine stub removed; single entry point via `cmd/orchestrator/`

### M1: Core Loop — Complete

- Agent command resolution: default agents have Command fields, fallback resolver maps dotted IDs to `agents/` paths
- Frontend API wiring: `/api/v1` prefix, SSE URL, field name mismatches fixed
- Canvas-to-run wiring: "Run" button reads canvas state, converts to RunPlan, calls `createRun(auto_start=true)`
- Graph panel SSE subscription works end-to-end
- TimelinePanel wired to orchestrator SSE (replaced flightRecorder mock)
- Flow persistence: `useFlowLoader` loads flows from backend on boot
- Agent browser UI: AgentBrowser panel with list + detail views
- E2E Harbor auth fixed (DinD + insecure registry + instance-level CI vars with `raw=true`)

### M2: Workflow Power — Complete

- Conditionals: if/else, switch/case, branch skipping with full test coverage
- ForEach sub-DAG execution: body nodes schedule via dependency graph, independent nodes run in parallel
- Agent output capture: scans NDJSON events for `type: "output"`, stores via `runstore.SetNodeOutputs()`
- Node-to-node data flow: downstream nodes access predecessor outputs via expression environment (`inputs.nodeId.field`)
- Contract overlay: wired to agent registry schemas via `useAgentSchemas` hook
- Canvas → RunPlan conversion: properly nests control flow config (camelCase → snake_case mapping)
- Lineage and Policy overlays deferred to M3 (require artifact tracking + policy engine backends)

### M3: Production Hardening — Complete

- OpenTelemetry tracing initialized in both services, trace_id in structured logs
- Business metrics recorded in scheduler (runs_active, runs_total, nodes_total, node_duration, events_total)
- OTLP spans on CreateRun, StartRun, StreamEvents, scheduleNode
- Dataflow service initialized from DATAFLOW_TYPE/MINIO env vars
- Auth middleware (OIDC, disabled by default) + per-IP rate limiting on API subrouter
- K8s images pinned to `:v0.0.0-placeholder`, PDBs consolidated
- 15 handler tests, CI coverage reporting for Go + frontend

## Roadmap

### M4: Developer Experience — Complete

- Archive aspirational specs: 13 files moved to `docs/archive/milestone-specs/`
- Go agent template: `cli/mentatctl/templates/go/` with full NDJSON contract
- Example flows: conditional routing, foreach batch, data pipeline
- README rewritten with accurate quickstart, architecture, config table
- Agent SDK docs: added `output` event type, `emitOutput()` Go helper
- Demo mode: `DEMO_MODE` flag loads bundled example flows when backend is empty
- mentatctl `dev run`: fixed endpoints, added `--local` subprocess mode with NDJSON parsing, `--watch` for file-change re-runs
- Tracing UI deferred ([Issue #7](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/7)) — requires OTLP query backend

### M5: Production Readiness — Deployed

Backend implementation complete. Deployed to K3s. Live validation of K8s job driver and artifact flow pending.

- **M5.1**: K8s job driver validation on real cluster (pending live test)
- **M5.2**: MinIO data flow end-to-end verification (MinIO deployed, pending artifact test)
- **M5.3**: Run-level timeouts — `Plan.Timeout` field, `ORCH_DEFAULT_RUN_TIMEOUT` env var ✅
- **M5.4**: Configurable per-node retry policies — `RetryPolicy` struct with fixed/exponential/linear backoff ✅
- **M5.5**: Grafana dashboards — orchestrator + gateway dashboards as ConfigMaps ✅
- **M5.6**: Full-stack smoke test on K3s (services running, full execution test pending)

### M6: Workflow Maturity — Deployed

Backend + frontend complete. Deployed to K3s. All API endpoints verified responsive.

- **M6.1**: Manual approval gates — `gate` node type, `waiting_approval` status, approve/reject endpoints ✅
- **M6.2**: Webhook triggers — per-flow webhook tokens, `POST /webhooks/trigger/{flowId}` ✅
- **M6.3**: Run templates and cloning — `POST /runs/{id}/clone`, `POST /flows/{id}/run` ✅
- **M6.4**: Cron scheduled runs — `CronRunner` with 5-field cron expressions, schedule CRUD ✅
- **M6.5**: Frontend polish — GateNode, retry editor, timeout config, clone/re-run buttons ✅

### M7: Multi-User & API Maturity — Complete

User identity, programmatic access, pagination, and completion callbacks.

- **M7.1**: User identity propagation — gateway forwards `X-User-Email`/`X-User-Type` headers, `Run.Owner` field, owner-filtered list ✅ ([Issue #30](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/30))
- **M7.2**: API key authentication — Redis-backed `APIKeyStore` (`mlk_` prefix, sha256 hashed), auth middleware fallback chain ✅ ([Issue #31](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/31))
- **M7.3**: Cursor-based pagination — base64 `timestamp:id` cursors, Redis sorted set index, `next_cursor` responses ✅ ([Issue #32](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/32))
- **M7.4**: Webhook callbacks on run completion — HMAC-SHA256 signed POST, 3 retries with exponential backoff ✅ ([Issue #33](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/33))
- **M7.5**: Load testing baseline — k6 scripts for CRUD throughput, concurrent runs, pagination stress ✅ ([Issue #34](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/34))

### M8: Frontend Quality — Complete

Component test coverage, vitest migration, and contract tests.

- **M8.1**: Vitest config + jest→vitest migration — 11 pre-existing spec files fixed ✅
- **M8.2**: Store tests — flow (59), streaming (59), sync (30), keyboard shortcuts (28) ✅
- **M8.3**: UI component tests — Button, Badge, Card, Checkbox, Input, Select, PanelShell, CommandPalette, ErrorBoundary ✅
- **M8.4**: Layout/canvas tests — BottomDock, LeftSidebar, CanvasDropZone, NodePalette, QuickAddMenu, WorkspaceProvider, TopBar ✅
- **M8.5**: Panel/overlay tests — GraphPanel, NetworkPanel, InspectorPanel, AgentBrowser, LineageOverlay, PolicyOverlay ✅
- **M8.6**: Contract tests — run API validation (21), SSE event parsing (25) ✅
- **Results**: 47 test files, 673 tests, 49% statement coverage (target 40%+)

### M9: Observability & Tracing UI — In Progress

Deep span instrumentation, trace-to-run correlation, and visual trace exploration in the UI.

- **M9.1**: Scheduler span enrichment — spans on executeConditional, executeForEach, executeLoopBody, executeGate, onNodeFinished, checkRunCompletion, handleRunTimeout, captureNodeOutputs, buildExprEnvironment ✅
- **M9.2**: API + callback spans — spans on all remaining API handlers (CRUD, gates, webhooks, schedules, API keys), fireWebhookCallback, deliverWebhook ✅
- **M9.3**: Run↔Trace correlation — `TraceID` field on Run/RunMeta, stored at StartRun, returned in GET /runs/{id} and SSE status events ✅
- **M9.4**: Local dev Tempo — Tempo 2.6.1 + Grafana 11.4.0 in docker-compose, auto-provisioned Tempo datasource ✅
- **M9.5**: Trace query proxy — gateway `GET /api/v1/traces/{traceID}` and `GET /api/v1/traces?run_id={runID}` proxying Tempo HTTP API ✅ ([Issue #7](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/7))
- **M9.6**: Trace waterfall UI — frontend panel showing span hierarchy as waterfall timeline with service name, operation, duration, status

### Deferred (Future)

These features have zero implementation and are parked for future consideration:

- **Agent Marketplace**: Web-based discovery with search & ratings ([Issue #8](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/8))
- **Publisher Profiles**: Reputation system and verification ([Issue #9](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/9))
- **Review System**: Community reviews and moderation ([Issue #10](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/10))
- **Security Scanning**: Automated vulnerability analysis ([Issue #11](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/11))
- **WASM Runtime**: Sandboxed execution for agents ([Issue #12](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/12))
- **Signed Attestations / PKI**: Cryptographic agent manifest verification ([Issue #24](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/24))

## References

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | Project overview |
| [AGENTS.md](AGENTS.md) | Agent guidance |
| [.loom/30-implementation-plan.md](.loom/30-implementation-plan.md) | Detailed M0-M9 plan |
| [.loom/00-index.md](.loom/00-index.md) | Progress tracking |
| [docs/archive/milestone-specs/](docs/archive/milestone-specs/) | Archived aspirational specs (WASM, PKI, etc.) |
