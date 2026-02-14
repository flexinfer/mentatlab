# Research Brief: MentatLab Codebase Assessment

## Problem

MentatLab has accumulated fragmented planning docs, duplicate service implementations (Python + Go), aspirational milestone specs disconnected from actual code, and inconsistent build/deploy pipelines. The goal is to produce an honest inventory of what works, what's broken, and what's missing so we can chart a path to a functional agent orchestration platform.

## Questions

- Q1: What does the code actually do today vs what the docs claim?
- Q2: Which services are production-ready and which are legacy/broken?
- Q3: Can the project be built and deployed end-to-end right now?
- Q4: What is the minimum viable path to a working agent dev/orchestration tool?

## Constraints

- Dual implementations (Python + Go) create confusion
- K8s manifests reference Go images; docker-compose references Python images
- v1.0/v1.1/v2.0 milestone specs describe features that don't exist in code
- No clear single source of truth for project status

## Method

Five parallel exploration agents examined:
1. All planning/roadmap/milestone documents (15+ docs)
2. Go services code (gateway-go, orchestrator-go) with test execution
3. Frontend code (React + ReactFlow + Mission Control)
4. Python services, agents, CLI, and schemas
5. Infrastructure, CI/CD, Docker, K8s, and testing setup

---

## Findings

### 1. Documentation vs Reality Gap

| Claim (Docs) | Reality (Code) | Source |
|---|---|---|
| v1.0 "complete" including WASM runtime | No WASM code exists anywhere | `ROADMAP.md:1-20`, `v1.0_milestone_spec.md` |
| PKI infrastructure and attestations | No PKI code exists | `v1.0_milestone_spec.md:1047-1070` |
| Multi-language SDKs (Rust, AssemblyScript, TinyGo) | No SDK code exists | `v1.0_milestone_spec.md:1057-1059` |
| Agent Marketplace (v1.1) | No marketplace code | `v1.1_milestone_spec.md` |
| Distributed tracing + cost metering (v2.0) | No implementation | `v2.0_milestone_spec.md` |
| 10 enhancements complete | Verified in code | `ENHANCEMENTS_SUMMARY.md` |

**Docs that are accurate:**
- `ENHANCEMENTS_SUMMARY.md` - reflects actual completed frontend features
- `docs/mvp-roadmap.md` - realistic 90-day plan for Mission Control features

**Docs that are aspirational/stale:**
- `v1.0_milestone_spec.md` - 14-week WASM+PKI plan, zero implementation
- `v1.1_milestone_spec.md` - Marketplace with PostgreSQL/Elasticsearch, zero implementation
- `v2.0_milestone_spec.md` - Observability platform, zero implementation
- `ROADMAP.md` - Claims v1.0 complete, overstates what exists

**Disconnected docs:**
- MVP roadmap and milestone specs describe different products
- Feature flags in MVP roadmap don't match feature flags in code
- Reconciliation docs (Feb 12-14) created GitLab issues but didn't set milestones

### 2. Go Services (Production Target)

**Gateway-Go** (`services/gateway-go/`) - **FUNCTIONAL**
- WebSocket hub with stream filtering, auth, origin validation
- Reverse proxy to orchestrator with auth header forwarding
- Middleware: auth (Cloudflare Access JWT), rate limiting, CORS, security headers
- Prometheus metrics and OpenTelemetry tracing stubs
- **All tests pass** (hub: 15 tests, middleware: 20+ tests)
- Source: `services/gateway-go/main.go`, `services/gateway-go/hub/`, `services/gateway-go/middleware/`

**Orchestrator-Go** (`services/orchestrator-go/`) - **FUNCTIONAL with gaps**
- Two parallel code paths exist:
  - `internal/` - Mature: DAG scheduler with foreach loops, conditional execution, expression evaluation, Redis/memory runstore, agent registry, K8s job driver, manifest validation
  - `engine/` - MVP stub: `time.Sleep(1 * time.Second)` simulation, no real execution
- `cmd/orchestrator/main.go` uses the `internal/` path (the real one)
- Scheduler has expression evaluation via `expr` library
- **All tests pass** (scheduler: 30+ tests, registry, flowstore, runstore tests)
- K8s driver creates Jobs with pod templates, tracks status
- Source: `services/orchestrator-go/internal/scheduler/scheduler.go`, `services/orchestrator-go/engine/engine.go:72-73`

**Verdict:** Go services are the intended production backend. They compile, tests pass, and have real business logic. The scheduler's foreach/conditional/expression support is genuinely useful for workflow orchestration.

### 3. Frontend

**Architecture** - **COHERENT but incomplete wiring**
- React + Vite + Tailwind + ReactFlow canvas
- Zustand store with domain-specific slices (layout, canvas, run state)
- Mission Control layout with compound components (TopBar, Sidebar, Canvas, Panels)
- Feature flags in `src/config/features.ts`

**What works:**
- Canvas with custom nodes: Agent, ForEach, Conditional, plus standard nodes
- Overlays: Contract, Lineage, Policy (all implemented with real UI)
- Panels: Console (virtualized for 100K+ events), Issues (with linter), Timeline
- Keyboard shortcuts system (Cmd+K palette, undo/redo, etc.)
- API contracts with Zod validation
- Transport layer with SSE streaming and WebSocket fallback
- Dark/light mode

**What's incomplete/broken:**
- API clients point to backend endpoints that may not all be wired
- E2E tests exist but are basic (healthcheck + orchestrator smoke tests)
- Unit test coverage: ~1,138 LOC of test code, limited scope
- ConfigurationPanel has Shadcn/ui imports commented out (components not found)
- No automated visual regression tests

**Recent activity:** Active development - last 20 commits are all frontend (Phase 3 layout refactor, console-timeline correlation, streaming canvas improvements).

Source: `services/frontend/package.json`, `services/frontend/src/components/mission-control/`, `services/frontend/src/config/features.ts`

### 4. Python Services (Legacy)

**Both Python services are legacy.** Well-engineered (FastAPI, proper abstractions, K8s integration) but superseded by Go. K8s manifests deploy Go images. docker-compose still references Python.

**Python Gateway** - 1,913 LOC, clean proxy + streaming hub
**Python Orchestrator** - 4,897 LOC, full K8s integration, pluggable runstore

### 5. Agents

| Agent | Status | LOC | Notes |
|---|---|---|---|
| Echo | Functional | 64 | Reference implementation, NDJSON output |
| Psyche-Sim | Functional | 972 | Sophisticated streaming simulation, vLLM integration |
| CTM-CogPack | Experimental | 1200+ | Research-grade cognitive architecture, partially implemented |
| Common lib | Production | 82 | NDJSON emission shared by all agents |

**Agent contract:** stdin JSON -> NDJSON events to stdout -> final JSON result. Well-defined but only 2 functional agents exist.

### 6. CLI (mentatctl)

Functional Typer CLI with agent scaffolding (python/nodejs/rust templates) and run management. Basic but works. Templates need verification against current manifest schema.

### 7. Infrastructure & CI/CD

**CRITICAL ISSUES:**

1. **Image name collision**: CI builds Python images but names them with `-go` suffix. K8s manifests expect Go images. Net result: deployment likely pushes wrong images.
   Source: `.gitlab-ci.yml:158-211`, `k8s/gateway.yaml:44`, `k8s/orchestrator.yaml:45`

2. **Port inconsistency**:
   - docker-compose.yml: orchestrator on 7070
   - docker-compose.dev.yml: orchestrator on 8081
   - run-local-dev.sh: orchestrator on 8081
   - K8s: orchestrator on 7070

3. **docker-compose uses Python; K8s uses Go** - two different stacks depending on environment

4. **Go services are tested in CI (lint + test) but never built as images**

5. **Frontend serves via `vite preview`** in production Dockerfile (should use nginx/caddy)

**What works:**
- Pre-commit hooks: go vet, go test, npm lint, YAML validation
- CI lint + test stages pass for Go services
- K8s manifests are well-structured with RBAC, PDB, HPA, NetworkPolicies, ServiceMonitor
- SOPS + age encryption for secrets
- Deploy script (`k8s/deploy.sh`) is comprehensive

---

## Options

### Option A: Go-First Reboot

Focus exclusively on Go services as the backend, fix CI/CD to build Go images, deprecate Python services, and wire frontend to Go endpoints.

- Pros: Go services are tested and have real features; eliminates dual-stack confusion; better performance
- Cons: Loses Python prototyping flexibility; requires CI/CD rework
- Risks: Go orchestrator's `engine/` stub path needs cleanup

### Option B: Python-First with Go Migration Plan

Keep Python services for rapid iteration, fix docker-compose, and plan Go migration later.

- Pros: Faster iteration with Python; existing tests work
- Cons: Perpetuates dual-stack confusion; Python services are already feature-complete legacy code; delays addressing the real architecture
- Risks: Feature parity between Python/Go drifts further

### Option C: Hybrid (current state, formalized)

Document that docker-compose = Python (dev), K8s = Go (prod), and maintain both.

- Pros: Acknowledges reality; minimal change
- Cons: Two codebases to maintain; confusion continues; docker-compose dev experience diverges from prod
- Risks: High maintenance burden; bugs found in one stack may not exist in the other

## Recommendation

**Option A: Go-First Reboot.** The Go services already have the better implementation (scheduler with foreach/conditional/expressions, proper middleware stack, passing tests). Python services are genuinely legacy. The main work is fixing CI/CD and cleaning up the deployment pipeline, not rewriting logic.

## Sources

- [S1] `ROADMAP.md` - Project roadmap (stale, Jan 2026)
- [S2] `ENHANCEMENTS_SUMMARY.md` - Verified completed features
- [S3] `docs/v1.0_milestone_spec.md` - WASM/PKI spec (aspirational, Aug 2025)
- [S4] `docs/v1.1_milestone_spec.md` - Marketplace spec (aspirational, Aug 2025)
- [S5] `docs/v2.0_milestone_spec.md` - Observability spec (aspirational, Jan 2026)
- [S6] `docs/mvp-roadmap.md` - 90-day Mission Control plan (realistic)
- [S7] `services/gateway-go/` - Go gateway source (functional, tests pass)
- [S8] `services/orchestrator-go/internal/scheduler/` - Go scheduler (functional, tests pass)
- [S9] `services/orchestrator-go/engine/engine.go:72-73` - MVP stub with `time.Sleep`
- [S10] `services/frontend/src/components/mission-control/` - Frontend MC layout
- [S11] `.gitlab-ci.yml:158-211` - CI build stage (image name collision)
- [S12] `k8s/gateway.yaml:44` - K8s expects Go gateway image
- [S13] `k8s/orchestrator.yaml:45` - K8s expects Go orchestrator image
- [S14] `docker-compose.yml` - Uses Python Dockerfiles
- [S15] `docker-compose.dev.yml` - Dev config with Python services
- [S16] `services/frontend/src/config/features.ts` - Feature flags
- [S17] `agents/common/emit.py` - Agent NDJSON protocol
- [S18] `agents/psyche-sim/src/main.py` - Psyche-Sim streaming agent
- [S19] `docs/roadmap-reconciliation-2026-02-14.md` - GitLab issue mapping
