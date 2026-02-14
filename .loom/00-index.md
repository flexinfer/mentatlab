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
- [ ] Execute M0: Foundation (Infrastructure Fix)
- [ ] Execute M1: Core Loop (Agent Dev + Execution)

## Key Findings (2026-02-14)

1. **Go services are functional** - gateway-go and orchestrator-go compile, tests pass, real scheduler logic exists
2. **Python services are legacy** - well-written but superseded; K8s deploys Go, docker-compose deploys Python
3. **Frontend is coherent** - Mission Control layout with canvas, overlays, panels all exist; wiring to backend incomplete
4. **CI/CD has critical bugs** - builds Python images with Go names; deployment likely broken
5. **Milestone specs are fiction** - v1.0/v1.1/v2.0 specs describe WASM/PKI/Marketplace with zero implementation
6. **10 frontend enhancements verified** - console virtualization, shortcuts, overlays, etc. are real

## Strategy: Go-First Reboot

**M0** Fix infrastructure (CI/CD, docker-compose, ports, legacy cleanup)
**M1** Wire the core loop (agent -> flow -> run -> events -> UI)
**M2** Enable workflow features (conditionals, foreach, data flow)
**M3** Harden for production (observability, auth, testing)
**M4** Polish developer experience (CLI, docs, examples)

## Open Questions

- [ ] Does the Go orchestrator's K8s driver work with real clusters? (test in M1.5)
- [ ] Is MinIO data flow implemented in Go orchestrator? (verify in M2.3)
- [ ] What's the desired auth model - Cloudflare Access only or also local dev auth? (decide in M3.3)

## Risks

- [x] ~CI builds wrong images~ - Identified, fix in M0.1
- [ ] Frontend API contracts may not match Go endpoints - audit in M1.2
- [ ] Data flow between nodes may need Go implementation - check in M2.3
