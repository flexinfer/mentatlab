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
- [ ] Execute M2: Workflow Power (conditionals, foreach, data flow)

## Key Findings (2026-02-15)

1. **M0 Complete** - Go-first backend, Python archived, engine stub removed, frontend uses nginx
2. **CI/CD Fixed** - e2e test has Harbor auth+TLS, instance-level CI variables, deploy.sh uses Go Dockerfiles
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

## M2 Progress — In Progress

### Completed
- **Conditionals**: 100% done — if/else, switch/case, branch skipping with full test coverage
- **ForEach sub-DAG execution**: Body nodes now schedule via dependency graph instead of sequential-only. Independent body nodes run in parallel.
- **Agent output capture**: After successful node execution, scans events for `type: "output"`, stores via `runstore.SetNodeOutputs()`. Downstream nodes access via expression environment (`inputs.node_id.field`).
- **Contract overlay**: Wired to agent registry schemas via `useAgentSchemas` hook. Populates `node.data.inputs/outputs` from agent manifest schemas.

### Deferred to M3
- **Lineage overlay**: Requires artifact tracking backend (no implementation exists)
- **Policy overlay**: Requires policy engine (no implementation exists)

## Strategy: Go-First Reboot

**M0** ~~Fix infrastructure~~ DONE
**M1** ~~Wire the core loop~~ DONE
**M2** Enable workflow features — IN PROGRESS (conditionals done, foreach done, data flow done, overlays partially deferred)
**M3** Harden for production (observability, auth, testing)
**M4** Polish developer experience (CLI, docs, examples)

## Open Questions

- [ ] Does the Go orchestrator's K8s driver work with real clusters? (test in M1.5)
- [x] ~~Is MinIO data flow implemented in Go orchestrator?~~ — DataFlow service exists but MinIO backend not wired. Expression-based data flow works via runstore.
- [ ] What's the desired auth model - Cloudflare Access only or also local dev auth? (decide in M3.3)

## Risks

- [x] ~~CI builds wrong images~~ - Was already correct
- [x] ~~E2E test can't pull from Harbor~~ - Fixed: DinD needs --insecure-registry + docker login
- [x] ~~deploy.sh references Python Dockerfiles~~ - Fixed
- [x] ~~Frontend API contracts may not match Go endpoints~~ - Fixed: 4 mismatches resolved in M1.2
- [x] ~~Console/Timeline panels use mock events~~ - Fixed: TimelinePanel wired to orchestrator SSE
- [ ] Large artifact data flow needs MinIO backend wiring (M3 scope)
