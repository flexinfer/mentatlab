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
3. **Frontend API wiring audited** - 4 mismatches identified for M1 (see below)
4. **Go backend API is comprehensive** - runs, agents, flows, artifacts, SSE streaming all have endpoints
5. **Gateway proxies all paths** to orchestrator via reverse proxy + WebSocket hub

## M1 API Wiring Audit (2026-02-15)

Critical mismatches to fix in M1.2:

1. **SSE path mismatch**: `streamingService.ts:148` expects `/api/v1/streams/{id}/sse` but backend serves `/api/v1/runs/{id}/events`. The `orchestratorSSE.ts` client uses the correct path.
2. **Response field naming**: `POST /api/v1/runs/{id}/start` returns `sseUrl` (camelCase) but frontend schema expects `sse_url` (snake_case). Frontend handles both.
3. **ListRuns pagination**: Backend returns `{runs, total, limit, offset}`, frontend expects `{runs}` or array. Both handled but inconsistent.
4. **Base URL mixing**: `streamingService.ts` mixes gateway and orchestrator URLs for streaming. Should consistently use gateway.

Key sources:
- Frontend API config: `services/frontend/src/config/orchestrator.ts`
- Go routes: `services/orchestrator-go/internal/api/routes.go:35-93`
- SSE handler: `services/orchestrator-go/internal/api/sse.go:18-193`
- Frontend SSE client: `services/frontend/src/services/streaming/orchestratorSSE.ts`

## Strategy: Go-First Reboot

**M0** ~~Fix infrastructure~~ DONE
**M1** Wire the core loop (agent -> flow -> run -> events -> UI)
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
- [ ] Frontend API contracts may not match Go endpoints - 4 mismatches found, fix in M1.2
- [ ] Data flow between nodes may need Go implementation - check in M2.3
