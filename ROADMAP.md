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

### M1: Core Loop — Complete (core path)

- Agent command resolution: default agents have Command fields, fallback resolver maps dotted IDs to `agents/` paths
- Frontend API wiring: `/api/v1` prefix, SSE URL, field name mismatches fixed
- Canvas-to-run wiring: "Run" button reads canvas state, converts to RunPlan, calls `createRun(auto_start=true)`
- Graph panel SSE subscription works end-to-end
- E2E Harbor auth fixed (DinD + insecure registry + CI/CD variables)

### M1 Remainders (in progress)

- [ ] TimelinePanel: Wire to orchestrator SSE (replace flightRecorder mock)
- [ ] Flow persistence: Load flows from backend on boot (auto-save already works)
- [ ] Agent browser UI: React components consuming agentService.ts
- [ ] E2E subprocess verification with real echo agent

## Roadmap

### M2: Workflow Power (Current)

Core workflow orchestration with conditionals, loops, data flow, and observability.

- [ ] **ForEach sub-DAG execution**: Replace sequential body execution with proper DAG scheduling ([related: Issue #2](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/2))
- [ ] **Agent output capture**: Parse NDJSON output, store via runstore, pass to downstream nodes
- [ ] **Node-to-node data flow**: Wire expression environment with predecessor outputs
- [ ] **Contract overlay**: Populate from agent manifest schemas instead of hardcoded values ([Issue #4](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/4))

Conditionals are 100% done (if/else, switch/case, branch skipping with tests).

### M3: Production Hardening

Reliability, observability, and security for real workloads.

- [ ] **OpenTelemetry integration**: Wire tracing stubs in Go services ([Issue #5](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/5))
- [ ] **Prometheus metrics**: Add ServiceMonitor CRDs, Grafana dashboards ([Issue #6](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/6))
- [ ] **Lineage overlay**: Requires artifact tracking backend (deferred from M2)
- [ ] **Policy overlay**: Requires policy engine (deferred from M2)
- [ ] **Authentication**: Enable Cloudflare Access + JWT validation
- [ ] **Test coverage**: 60% Go, 40% frontend targets
- [ ] **K8s hardening**: Pin image versions, NetworkPolicies, HPA tuning

### M4: Developer Experience

Polished CLI, documentation, and onboarding.

- [ ] **Enhanced mentatctl CLI**: Local dev workflow, hot reload ([Issue #2](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/2))
- [ ] **Agent SDK docs**: Document NDJSON contract, event types, "Build Your First Agent" tutorial ([Issue #3](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/3))
- [ ] **Example flows**: 3-5 demo flows, Go agent template, demo mode
- [ ] **Tracing UI**: Visual trace exploration ([Issue #7](https://gitlab.flexinfer.ai/services/mentatlab/-/issues/7))
- [ ] **Consolidate docs**: Archive aspirational specs, update README

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
| [docs/v1.0_milestone_spec.md](docs/v1.0_milestone_spec.md) | Archived: WASM/PKI aspirational spec |
