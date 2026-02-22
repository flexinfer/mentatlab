# Research Brief: MentatLab Codebase Assessment

## Problem

MentatLab has accumulated fragmented planning docs, duplicate service implementations (Python + Go), aspirational milestone specs disconnected from actual code, and inconsistent build/deploy pipelines. The goal is to produce an honest inventory of what works, what's broken, and what's missing so we can chart a path to a functional agent orchestration platform.

## Questions

- Q1: What does the code actually do today vs what the docs claim?
- Q2: Which services are production-ready and which are legacy/broken?
- Q3: Can the project be built and deployed end-to-end right now?
- Q4: What is the minimum viable path to a working agent dev/orchestration tool?

## 2026-02-20 Addendum: Mission Control UI/UX Functional Audit

### Problem

Mission Control currently looks feature-rich but behaves inconsistently under real connection conditions. The immediate need is to make the UI reliably functional (connection, run visibility, status feedback) and then standardize the UX so it looks intentional and production-ready.

### Focused Questions

- Q1: Is there a single source of truth for streaming/connection state?
- Q2: Are status/error signals presented once, clearly, and in context?
- Q3: Do environment defaults align with the active Go gateway/orchestrator stack?
- Q4: Which frontend surfaces are legacy versus production path?

### Findings (Facts)

1. The app ships two top-level UX paths: `/` uses `MissionControlLayout` while `/streaming` still uses `StreamingPage`.
   - Source: `services/frontend/src/App.tsx:17`
   - Source: `services/frontend/src/App.tsx:18`
2. `MissionControlLayout` renders `StreamingCanvas` and also mounts a global `ConnectionStatusBanner`.
   - Source: `services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:203`
   - Source: `services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:250`
3. `TopBar` independently mounts another `ConnectionStatusBanner`, creating duplicate status surfaces.
   - Source: `services/frontend/src/components/mission-control/layout/TopBar.tsx:107`
4. `ConnectionStatusBanner` is hardcoded as fixed-position (`fixed top-20 left-1/2 ...`), so duplicate mounts can visually stack/conflict.
   - Source: `services/frontend/src/components/ui/ConnectionStatusBanner.tsx:36`
5. Live-connect behavior is duplicated:
   - `WorkspaceProvider.startLiveConnection()` dynamically imports `streamingService` and calls `connect()`.
   - `NetworkPanel.connectLive()` repeats the same dynamic-import + connect pattern.
   - Source: `services/frontend/src/components/mission-control/layout/WorkspaceProvider.tsx:203`
   - Source: `services/frontend/src/components/mission-control/layout/WorkspaceProvider.tsx:205`
   - Source: `services/frontend/src/components/mission-control/panels/NetworkPanel.tsx:609`
   - Source: `services/frontend/src/components/mission-control/panels/NetworkPanel.tsx:612`
6. `StreamingCanvas` runs its own connection lifecycle:
   - polls `/api/v1/streams` every 2s,
   - derives websocket URLs manually,
   - opens raw `WebSocket` clients directly.
   - Source: `services/frontend/src/components/StreamingCanvas.tsx:42`
   - Source: `services/frontend/src/components/StreamingCanvas.tsx:76`
   - Source: `services/frontend/src/components/StreamingCanvas.tsx:89`
   - Source: `services/frontend/src/components/StreamingCanvas.tsx:96`
   - Source: `services/frontend/src/components/StreamingCanvas.tsx:100`
7. A newer transport abstraction exists (`useStreamingTransport`) but appears unintegrated with Mission Control flows.
   - Source: `services/frontend/src/hooks/useStreamingTransport.ts:106`
   - Source (search command): `rg -n "useStreamingTransport\\(" services/frontend/src --glob '!**/*.test.*' --glob '!**/__tests__/**'`
8. API/gateway URL defaults are inconsistent:
   - `apiService` still defaults to `http://localhost:8000` and `ws://localhost:8000/ws`,
   - orchestrator config defaults to `http://localhost:7070`,
   - gateway config defaults to `http://127.0.0.1:8080`.
   - Source: `services/frontend/src/services/api/apiService.ts:113`
   - Source: `services/frontend/src/services/api/apiService.ts:114`
   - Source: `services/frontend/src/config/orchestrator.ts:10`
   - Source: `services/frontend/src/config/orchestrator.ts:75`
9. The visual system is internally inconsistent with a “professional” operator UI target:
   - global dark mode still defines neon cyberpunk tokens and effects,
   - React Flow overrides force glow-heavy styling,
   - typography defaults split between Inter and JetBrains Mono.
   - Source: `services/frontend/src/index.css:49`
   - Source: `services/frontend/src/index.css:63`
   - Source: `services/frontend/src/index.css:145`
   - Source: `services/frontend/tailwind.config.js:18`
   - Source: `services/frontend/tailwind.config.js:19`
10. Baseline quality gates are green but noisy:
   - TypeScript lint pass: `npm run lint` (frontend),
   - tests pass: `49 files`, `713 tests`.
   - Source (command): `npm run lint` in `services/frontend`
   - Source (command): `npm test -- --run --reporter=dot` in `services/frontend`

### Assumptions

- The screenshot-reported “Connection Error” is primarily a frontend connection-orchestration issue, not a backend outage.
- Mission Control (`/`) is the intended primary production UI, while `/streaming` is legacy/demo.

### Open Questions

- Should `/streaming` be removed now or retained behind a feature flag for diagnostic use?
- Should the “live connection” model be explicit user-driven only, or auto-connect when a run is active?
- Is the desired dark theme still required, or should operator-first light theme become default?

### Options

1. Thin patch set: keep architecture, remove duplicate banner, align URL defaults, and tune styles.
   - Fastest but leaves connection ownership fragmented.
2. Functional-first standardization (recommended): consolidate connection control into one transport owner, then normalize status/visual tokens.
   - Slightly larger change but resolves core reliability and UX consistency.
3. Full frontend refactor now.
   - Highest risk and unnecessary for immediate reliability.

### Recommendation

Adopt option 2: ship a short, phased slice that first unifies runtime connection ownership and status UX, then standardizes visual tokens/components. This addresses “most importantly functional” before aesthetic cleanup.

## 2026-02-18 Addendum: MentatLab Docs Integration with flexinfer-site

### Problem

MentatLab docs were linked externally from the FlexInfer product surface (`gitlab tree` link), but not integrated as first-class docs in `services/flexinfer-site` docs hub and route system.

### Findings

1. `flexinfer-site` already has a reusable multi-project docs pipeline:
   - sync script: `scripts/sync-docs.mjs`
   - generic renderer: `lib/project-docs.ts`
   - per-project route pattern in `app/docs/<project>` and `app/docs/<project>/[...slug]`
2. MentatLab source docs are present in `services/mentatlab/docs`, but many files are internal/planning-oriented; a curated site-ready subset was needed.
3. Existing MentatLab product metadata used an external docs URL:
   - `data/portfolio-positioning.ts` had `docsHref` pointing to GitLab, not an internal route.

### Solution Chosen

- Add curated site docs in `services/mentatlab/docs/site/`.
- Extend `flexinfer-site` sync pipeline with a `mentatlab` project.
- Add `mentatlabDocs` project-docs instance and routes:
  - `/docs/mentatlab`
  - `/docs/mentatlab/[...slug]`
- Update docs hub cards and product/content-link mappings to include internal MentatLab docs.

### Validation

- `pnpm typecheck` passed in `services/flexinfer-site`.
- MentatLab-related tests passed:
  - `__tests__/lib/content-links.test.ts`
  - `__tests__/lib/portfolio-positioning.test.ts`
  - `__tests__/lib/mentatlab-page.test.ts`

### Sources

- `services/flexinfer-site/scripts/sync-docs.mjs:27`
- `services/flexinfer-site/lib/project-docs.ts:466`
- `services/flexinfer-site/app/docs/page.tsx:172`
- `services/flexinfer-site/data/portfolio-positioning.ts:186`
- `services/flexinfer-site/app/products/mentatlab/page.tsx:80`
- `services/flexinfer-site/app/docs/mentatlab/page.tsx:1`
- `services/flexinfer-site/app/docs/mentatlab/[...slug]/page.tsx:1`
- `services/mentatlab/docs/site/README.md:1`

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
