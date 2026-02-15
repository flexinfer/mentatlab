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

### M4: Developer Experience — In Progress

Polished CLI, documentation, and onboarding.

- [x] **Archive aspirational specs**: 13 milestone spec files moved to `docs/archive/milestone-specs/`
- [x] **Go agent template**: `cli/mentatctl/templates/go/` with full NDJSON contract implementation
- [x] **Example flows**: `conditional_routing.json`, `foreach_batch.json`, `data_pipeline.json`
- [x] **README update**: Accurate quickstart, architecture, configuration, docs links
- [ ] **Verify agent-sdk.md**: Ensure docs match current implementation
- [ ] **mentatctl hot reload**: Verify `dev run` works with subprocess driver ([Issue #2](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/2))
- [ ] **Tracing UI**: Visual trace exploration ([Issue #7](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/7))
- [ ] **Demo mode**: Pre-load example flows on startup

### Deferred (Future)

These features have zero implementation and are parked for future consideration:

- **Agent Marketplace**: Web-based discovery with search & ratings ([Issue #8](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/8))
- **Publisher Profiles**: Reputation system and verification ([Issue #9](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/9))
- **Review System**: Community reviews and moderation ([Issue #10](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/10))
- **Security Scanning**: Automated vulnerability analysis ([Issue #11](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/11))
- **WASM Runtime**: Sandboxed execution for agents ([Issue #12](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/12))
- **Signed Attestations / PKI**: Cryptographic agent manifest verification

## References

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | Project overview |
| [AGENTS.md](AGENTS.md) | Agent guidance |
| [.loom/30-implementation-plan.md](.loom/30-implementation-plan.md) | Detailed M0-M4 plan |
| [.loom/00-index.md](.loom/00-index.md) | Progress tracking |
| [docs/archive/milestone-specs/](docs/archive/milestone-specs/) | Archived aspirational specs (WASM, PKI, etc.) |
