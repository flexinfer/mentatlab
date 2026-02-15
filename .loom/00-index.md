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
- [ ] Execute M1: Core Loop (Agent Dev + Execution)

## Key Findings (2026-02-15)

1. **M0 Complete** - Go-first backend, Python archived, engine stub removed, frontend uses nginx
2. **CI/CD Fixed** - e2e test now has Harbor auth+TLS, deploy.sh uses Go Dockerfiles
3. **M1.1 + M1.2 Complete** - Frontend API wiring fixed, agent command resolution fixed, canvas-to-run loop wired
4. **Go backend API is comprehensive** - runs, agents, flows, artifacts, SSE streaming all have endpoints
5. **Gateway proxies all paths** to orchestrator via reverse proxy + WebSocket hub

## M1 Progress (2026-02-15)

### Completed
- **M1.1**: Agent command resolution fixed — default agents have Command fields, fallback resolver maps `mentatlab.echo` → `agents/echo/main.py`
- **M1.2**: All 4 frontend API mismatches fixed — `/api/v1` prefix, SSE URL, `sse_url` field name
- **Canvas wiring**: "Run" button reads actual canvas state, converts to RunPlan, calls createRun(auto_start=true). Graph panel SSE subscription already works.

### Remaining (lower priority)
- **Console/Timeline panels**: Use `flightRecorder` (client-side mock) instead of orchestrator SSE events. Graph panel is correct.
- **Agent views**: `agentService.ts` fully implemented but no React components consume it. No agent browser UI.
- **Flow persistence**: Auto-save hook exists but doesn't load flows from backend API on boot. Only localStorage.
- **M1.5**: E2E integration test with real agent subprocess execution not yet verified.

## Strategy: Go-First Reboot

**M0** ~~Fix infrastructure~~ DONE
**M1** ~~Wire the core loop~~ DONE (core path: canvas → run → events → graph)
**M2** Enable workflow features (conditionals, foreach, data flow)
**M3** Harden for production (observability, auth, testing)
**M4** Polish developer experience (CLI, docs, examples)

## Open Questions

- [ ] Does the Go orchestrator's K8s driver work with real clusters? (test in M1.5)
- [ ] Is MinIO data flow implemented in Go orchestrator? (verify in M2.3)
- [ ] What's the desired auth model - Cloudflare Access only or also local dev auth? (decide in M3.3)

## Risks

- [x] ~~CI builds wrong images~~ - Was already correct; assessment agent was wrong
- [x] ~~E2E test can't pull from Harbor~~ - Fixed: DinD needs --insecure-registry + docker login
- [x] ~~deploy.sh references Python Dockerfiles~~ - Fixed
- [x] ~~Frontend API contracts may not match Go endpoints~~ - Fixed: 4 mismatches resolved in M1.2
- [ ] Console/Timeline panels use mock events (flightRecorder) not orchestrator SSE
- [ ] Data flow between nodes may need Go implementation - check in M2.3
