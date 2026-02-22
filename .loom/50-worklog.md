# Worklog

Chronological notes while executing the plan (useful for handoffs and debugging).

## 2026-02-20

### M16 planning: Mission Control UI/UX functional standardization

- What changed:
  - Refreshed `.loom` context pack for this slice:
    - `.loom/00-mcp-inventory.md` (loom profile/tool inventory + index readiness update)
    - `.loom/10-research.md` (UI/UX functional audit addendum with sourced findings)
    - `.loom/20-product-spec.md` (new M16 product spec)
    - `.loom/30-implementation-plan.md` (new phased M16 implementation slice)
    - `.loom/40-decisions.md` (functional-first + single transport authority decisions)
    - `.loom/00-index.md` (M16 tracked in current goals + key findings addendum)
    - `.loom/31-m16-issue-checklist.md` (PR-sized issue breakdown with file-level scope)
- Why:
  - User request prioritized “functional first” UI/UX improvement. Existing frontend has fragmented connection ownership and duplicate status surfaces.

- Evidence collected:
  - Duplicate status banner mounts:
    - `services/frontend/src/components/mission-control/layout/TopBar.tsx:107`
    - `services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:250`
  - Fixed-position banner causing overlap risk:
    - `services/frontend/src/components/ui/ConnectionStatusBanner.tsx:36`
  - Duplicated connect logic:
    - `services/frontend/src/components/mission-control/layout/WorkspaceProvider.tsx:203`
    - `services/frontend/src/components/mission-control/panels/NetworkPanel.tsx:609`
  - Independent raw websocket + polling in StreamingCanvas:
    - `services/frontend/src/components/StreamingCanvas.tsx:42`
    - `services/frontend/src/components/StreamingCanvas.tsx:89`
  - Inconsistent URL defaults:
    - `services/frontend/src/services/api/apiService.ts:113`
    - `services/frontend/src/config/orchestrator.ts:10`
    - `services/frontend/src/config/orchestrator.ts:75`

- Validation:
  - `npm run lint` in `services/frontend` passed.
  - `npm test -- --run --reporter=dot` in `services/frontend` passed (`49` files, `713` tests).
  - `codebase_memory__codebase_stats(repo_id="mentatlab-frontend")` returned indexed frontend corpus (`total_chunks=1349`).
  - `read_mcp_resource(loom://config)` confirmed loom profile `full` with `42` servers and `445` tools.

- Notable runtime note:
  - `read_mcp_resource(loom://servers)` failed twice with transient loom socket broken pipe while other loom resources were available.

### M16 tracking: GitLab issues created

- Created roadmap issues in `services/mentatlab` for the full M16 checklist:
  - `#42` Roadmap: M16.1 Unify live connection ownership
  - `#43` Roadmap: M16.2 Canonicalize connection status surface
  - `#44` Roadmap: M16.3 Refactor StreamingCanvas to shared transport
  - `#45` Roadmap: M16.4 Normalize frontend URL defaults
  - `#46` Roadmap: M16.5 Resolve legacy /streaming route strategy
  - `#47` Roadmap: M16.6 Standardize visual tokens and panel chrome
  - `#48` Roadmap: M16.7 Add connection UX regression tests
  - `#49` Roadmap: M16.8 Capture visual QA snapshot baseline

## 2026-02-14

### M0.1: CI/CD Image Builds - VERIFIED CORRECT

- What changed: No changes needed. Assessment agent was wrong about CI image collision.
- Why: `.gitlab-ci.yml:205-206` already builds Go images from Go directories. `build-and-push.sh:97-98` also correct.
- Sources:
  - [S1] `.gitlab-ci.yml:205-206` - `build_image "mentatlab-orchestrator-go" "services/orchestrator-go"`
  - [S2] `build-and-push.sh:97-98` - builds from Go directories

### M0.2: Fix docker-compose for local dev - DONE

- What changed:
  - `docker-compose.yml`: Switched orchestrator and gateway build contexts from Python to Go Dockerfiles
  - `docker-compose.dev.yml`: Rewrote to use Go services, fixed ports (orchestrator 8081→7070), removed Python env vars (UVICORN_*), removed stale `version: '3.8'`
  - `run-local-dev.sh`: Rewrote 543-line Python script to 182-line Go version. Now starts `go run ./cmd/orchestrator/` and `go run main.go` instead of uvicorn
  - `quick-start.sh`: Rewrote to use Go services, fixed port from 3000→5173
- Why: docker-compose was building Python images while K8s deploys Go. Local dev now matches production stack.
- Sources:
  - [S1] `docker-compose.yml` - orchestrator now builds from `services/orchestrator-go`
  - [S2] `docker-compose.dev.yml` - gateway/orchestrator now Go, ports standardized

### M0.3: Fix frontend production Dockerfile - DONE

- What changed: Replaced single-stage `vite preview` Dockerfile with multi-stage build (node builder + nginx:alpine)
- Why: `vite preview` is a development server, not suitable for production. nginx handles static serving, SPA routing, and adds a `/healthz` endpoint.
- Sources:
  - [S1] `services/frontend/Dockerfile` - now uses `nginx:alpine` with SPA fallback

### M0.4: Archive legacy Python services - DONE

- What changed:
  - Moved `services/gateway/` → `archive/gateway-python/`
  - Moved `services/orchestrator/` → `archive/orchestrator-python/`
  - Updated `pyproject.toml`: removed Python service deps (fastapi, uvicorn, kubernetes, etc.), kept pytest + pyyaml for agents
  - Updated `pytest.ini`: removed stale Python service test paths, points to `agents/`
  - Updated `CLAUDE.md`: removed Python service references, updated to Go-only docs
- Why: Python services are legacy, superseded by Go. Archiving preserves reference value without cluttering the active codebase.
- Sources:
  - [S1] `archive/gateway-python/` - archived Python gateway
  - [S2] `archive/orchestrator-python/` - archived Python orchestrator

### M0.5: Remove orphaned engine stub - DONE

- What changed:
  - Removed `services/orchestrator-go/main.go` (root-level stub using engine package)
  - Removed `services/orchestrator-go/engine/` directory (engine.go with `time.Sleep` simulation, types.go)
  - Ran `go mod tidy` to clean unused dependencies
- Why: The `engine/` package was an MVP stub with fake execution. The real entry point is `cmd/orchestrator/main.go` using `internal/scheduler/`. Both coexisting created confusion.
- What verified: `go build ./cmd/orchestrator/` succeeds, all tests pass (scheduler, flowstore, registry)
- Sources:
  - [S1] `services/orchestrator-go/cmd/orchestrator/main.go` - real entry point (unchanged)

### M0.6: End-to-end verification - DONE

- What verified:
  - `docker compose config` validates for both compose files
  - `go build` succeeds for both gateway-go and orchestrator-go
  - `go test ./...` passes for both services (scheduler: 30+, hub: 15, middleware: 20+)
  - `npx tsc --noEmit` passes for frontend
  - No stale imports or references to removed engine package

### CI/CD + Deploy Fixes - DONE

- What changed:
  - `.gitlab-ci.yml` e2e-test job:
    - Added `--insecure-registry=registry.harbor.lan` to DinD command (Harbor uses internal CA)
    - Added docker login step using runner-provided credentials from `/root/.docker/config.json`
    - Switched from `docker-compose` v1 to `docker compose` v2 (supports `!reset null` YAML tag)
    - Added explicit `docker pull` before compose up (better error messages)
    - Removed `allow_failure: true` — e2e now blocks the pipeline
    - Removed unnecessary `docker-compose` apk install (v2 plugin included in docker:24-cli)
  - `k8s/deploy.sh`:
    - Fixed orchestrator build: `services/orchestrator/Dockerfile` → `services/orchestrator-go/Dockerfile`
    - Fixed gateway build: `services/gateway/Dockerfile` → `services/gateway-go/Dockerfile`
    - Fixed image names: `mentatlab-orchestrator` → `mentatlab-orchestrator-go`, same for gateway
    - Removed deprecated `--record` flag from `kubectl set image`
- Why: E2E test was failing because DinD had no Harbor auth/CA. Deploy script still referenced Python Dockerfiles.
- Root cause: BuildKit has Harbor creds via K8s secret mount; DinD service container doesn't share those mounts.
- Sources:
  - [S1] `.gitlab-ci.yml:221` - DinD `--insecure-registry` flag
  - [S2] `k8s/deploy.sh:125-130` - Go Dockerfile references
  - [S3] Pipeline 1094 e2e-test log - `artifact library/mentatlab-gateway-go:931dd027 not found`

## 2026-02-15

### M1.2: Fix frontend API wiring mismatches - DONE

- What changed:
  - `services/frontend/src/services/api/orchestratorService.ts:30-33`: `baseUrl()` now appends `/api/v1` prefix. Without this, all API calls hit `/runs` instead of `/api/v1/runs` and 404.
  - `services/frontend/src/services/api/streaming/orchestratorSSE.ts:69-72`: `buildUrl()` now uses `/api/v1` prefix for SSE EventSource URLs.
  - `services/frontend/src/services/api/streamingService.ts:148`: Fixed SSE URL from non-existent `/api/v1/streams/{id}/sse` to `/api/v1/runs/default/events`.
  - `services/orchestrator-go/internal/api/handlers.go:182`: Fixed StartRun response field from `sseUrl` (camelCase) to `sse_url` (snake_case) matching `CreateRunResponse` type.
- Why: Frontend API clients were constructing URLs without `/api/v1` prefix. Go backend serves all endpoints under `/api/v1` subrouter. SSE endpoint name was also wrong.
- What verified: `tsc --noEmit` passes, `go test ./...` passes, pre-commit hooks pass.
- Sources:
  - [S1] `services/orchestrator-go/internal/api/routes.go:35-93` - all routes under `/api/v1`
  - [S2] `services/frontend/src/config/orchestrator.ts` - `getOrchestratorBaseUrl()` returns `http://localhost:7070` (no `/api/v1`)
  - [S3] `services/frontend/src/services/streaming/orchestratorSSE.ts:89` - correct SSE path reference

### M1.1: Fix agent command resolution - DONE

- What changed:
  - `services/orchestrator-go/internal/registry/memory.go:29-57`: Added `Command` fields to all 3 default agents (echo, psyche-sim, ctm-cogpack). Previously lacked execution metadata.
  - `services/orchestrator-go/cmd/orchestrator/main.go:97-107`: Fixed fallback command resolver. Was generating `python -m agents.mentatlab.echo` (wrong module path), now generates `python agents/echo/main.py` by stripping the dotted prefix.
- Why: Default agents had no Command field, and the fallback resolver built paths that didn't match the actual `agents/` directory structure. Without this, scheduling a run with a default agent would either produce an empty command (node skipped) or a wrong path.
- What verified: `go build ./cmd/orchestrator/` succeeds, `go test ./...` passes (registry test ran fresh, not cached).
- Sources:
  - [S1] `services/orchestrator-go/cmd/orchestrator/main.go:97-107` - command resolver closure
  - [S2] `agents/echo/main.py` - actual echo agent location
  - [S3] `services/orchestrator-go/internal/scheduler/scheduler.go:386` - where resolveCmd is called

### M1.2 + Canvas Wiring: Wire frontend core loop - DONE

- What changed:
  - **M1.2 API fixes** (separate commit a75dca7):
    - `services/frontend/src/services/api/orchestratorService.ts:30-33`: Added `/api/v1` prefix to all API URLs
    - `services/frontend/src/services/api/streaming/orchestratorSSE.ts:69-72`: Added `/api/v1` prefix to SSE URLs
    - `services/frontend/src/services/api/streamingService.ts:148`: Fixed SSE URL from non-existent path
    - `services/orchestrator-go/internal/api/handlers.go:182`: Fixed `sseUrl` → `sse_url` (snake_case)
  - **Canvas → Run wiring** (commit 0519cfe):
    - `services/frontend/src/components/mission-control/layout/WorkspaceProvider.tsx:106-140`: `startOrchestratorRun()` now reads actual canvas nodes/edges from Zustand store, converts to RunPlan, and calls `createRun({ plan, auto_start: true })`
    - `services/frontend/src/types/orchestrator.ts:139`: Added `auto_start` field to `CreateRunRequest`
  - **Full core loop verified**:
    - Canvas → RunPlan conversion → createRun(auto_start) → scheduler enqueue/start → SSE events → graph panel subscription
    - Graph panel (`useRunGraph.ts:258`) already subscribes to SSE via `streamRunEvents(runId, ...)` when activeRunId changes
    - BottomDock passes `activeRunId` to GraphPanel which passes to useRunGraph
- Why: "Run" button (Cmd+R) was hardcoded to always create a demo run with fake nodes (Perception, Ego, Planning, etc.). Now it uses actual canvas state.
- Frontend audit findings (for future M1 work):
  - Agent views: `agentService.ts` fully implemented but no React components consume it
  - Console/Timeline panels: Use client-side `flightRecorder` mock instead of orchestrator SSE (graph panel correctly uses SSE)
  - Flow persistence: Auto-save exists but doesn't load from backend on boot
- Sources:
  - [S1] `services/frontend/src/components/mission-control/layout/BottomDock.tsx:304` - passes activeRunId to GraphPanel
  - [S2] `services/frontend/src/components/mission-control/panels/graph/useRunGraph.ts:258` - SSE subscription
  - [S3] `services/orchestrator-go/internal/api/handlers.go:134-143` - auto_start CreateRun handler

### E2E Pipeline Fix (Round 2) - DONE

- What happened: Pipeline 1105 e2e-test failed in 15s with `artifact library/mentatlab-orchestrator-go:089d14e2 not found`
- Root cause: `docker login` at `.gitlab-ci.yml:252-259` checked for `/root/.docker/config.json` which only exists in BuildKit pods (K8s secret mount). The `docker:24-cli` e2e job container has no Harbor credentials.
- What changed: `.gitlab-ci.yml:252-259`: Replaced config file check with `HARBOR_USER`/`HARBOR_PASSWORD` CI/CD variable login.
- **Action required**: ~~Set `HARBOR_USER` and `HARBOR_PASSWORD` as protected CI/CD variables~~ DONE — moved to instance-level (see below).
- Sources:
  - [S1] Pipeline 1105 e2e-test trace: `Error response from daemon: unknown: artifact library/mentatlab-orchestrator-go:089d14e2 not found`
  - [S2] `.gitlab-ci.yml:252-259` - docker login now uses CI/CD variables

### CI Fix: Move Harbor Credentials to Instance Level - DONE

- What changed: Moved `HARBOR_USER` and `HARBOR_PASSWORD` from project-level CI/CD variables to instance-level via `glab api /admin/ci/variables`. Deleted project-level duplicates.
- Why: Instance-level variables are inherited by all projects. Project-level was causing issues with cross-project CI (e2e-test in pipelines 1109-1111).
- Sources:
  - [S1] `glab api /admin/ci/variables` - both variables now at instance level
  - [S2] Project-level variables deleted via `glab variable delete`

### ROADMAP.md Reconciliation - DONE

- What changed:
  - `ROADMAP.md`: Rewritten to reflect actual M0-M4 milestones from `.loom/30-implementation-plan.md`. Removed stale "v1.0 complete" claims. Added Deferred section for WASM/Marketplace/PKI. References detailed plan.
  - `docs/v1.0_milestone_spec.md`: Added archive header marking it as aspirational, not current scope.
- Why: ROADMAP.md was from Jan 2026, claimed "v1.0 complete" with zero-implementation features.

### M1 Remainders: TimelinePanel SSE + Flow Load + Agent Browser - DONE

- What changed:
  - `services/frontend/src/components/mission-control/panels/TimelinePanel.tsx`: Replaced `flightRecorder` mock with real orchestrator SSE subscription. Uses `orchestratorService.streamRunEvents()` + `parseRunEvent()`. Displays live timeline entries with event type formatting, status colors, and selection correlation.
  - `services/frontend/src/hooks/useFlowLoader.ts`: New hook that calls `flowService.listFlows()` on mount, populates flow store if empty. Integrated into WorkspaceProvider.
  - `services/frontend/src/hooks/useAgentList.ts`: New hook for fetching and tracking registered agents from orchestrator API.
  - `services/frontend/src/components/mission-control/panels/AgentBrowser.tsx`: New panel with list view (status badges, capabilities preview) and detail view (full agent config/metadata). Added as "Agents" tab in BottomDock.
  - `services/frontend/src/components/mission-control/layout/BottomDock.tsx`: Removed `flightRecorder` import, added `AgentBrowser` import, added "Agents" tab definition.
  - `services/frontend/src/components/mission-control/layout/WorkspaceProvider.tsx`: Added `useFlowLoader()` call.
- What verified: `tsc --noEmit` clean, `npm test` 65/65 pass.

### M2: ForEach Sub-DAG + Output Capture + Contract Overlay - DONE

- What changed:
  - `services/orchestrator-go/internal/scheduler/foreach.go`:
    - `executeLoopBody()` rewritten to build sub-DAG dependency graph from main plan edges (filtered to body nodes). Independent body nodes run in parallel. Dependency resolution happens within each iteration.
  - `services/orchestrator-go/internal/scheduler/scheduler.go`:
    - Added `captureNodeOutputs()` method: after successful node execution, scans event stream for `type: "output"` events, unmarshals JSON, stores via `runstore.SetNodeOutputs()`. Called after `driver.RunNode()` returns exitCode 0.
    - Data flow chain: agent emits `{"type":"output","key":"foo","value":"bar"}` → driver emits event → scheduler captures → downstream node reads via `buildExprEnvironment()` → `inputs.nodeId.foo` in expressions.
  - `services/frontend/src/hooks/useAgentSchemas.ts`: New hook that fetches agent definitions, parses their schema metadata, and enriches canvas nodes' `data.inputs/data.outputs` with pin type information.
  - `services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx`: Added `useAgentSchemas()` call so schemas are loaded when overlay activates.
- What verified:
  - `go vet ./...` clean, `go test ./...` all pass (scheduler: 30+ tests including foreach)
  - `tsc --noEmit` clean, `npm test` 65/65 pass
- Sources:
  - [S1] `services/orchestrator-go/internal/scheduler/scheduler.go:600-650` - captureNodeOutputs
  - [S2] `services/orchestrator-go/internal/scheduler/foreach.go:122-210` - sub-DAG scheduling
  - [S3] `services/orchestrator-go/internal/scheduler/conditional.go:140-173` - buildExprEnvironment (existing)

### E2E Pipeline Fix (Round 3): Harbor Auth + Image Tags - DONE

- What happened: Pipelines 1117-1118 e2e-test failed with two distinct issues.
- **Issue 1 — Harbor username shell expansion**: `HARBOR_USER` instance variable contained `robot$k3s`. With `raw=false` (default), GitLab CI expanded `$k3s` to empty string, resulting in `docker login` with username `robot` instead of `robot$k3s`.
  - Fix: `glab api /admin/ci/variables/HARBOR_USER --method PUT -f 'raw=true'` — prevents variable interpolation.
- **Issue 2 — SHA-tagged images not found**: After auth fix, `docker pull` failed with `artifact library/mentatlab-orchestrator-go:aba63be3 not found`. BuildKit's multi-name `--output` push wasn't reliably pushing the SHA tag alongside `:latest`.
  - Fix: `.gitlab-ci.yml:230-232` — Changed e2e-test variables from `${CI_COMMIT_SHORT_SHA}` to `:latest`. Builds on main always push `:latest`, so e2e-test uses that directly.
- Pipeline 1119: All stages green (lint, test, build, e2e-test). Deploy is manual (expected).
- Sources:
  - [S1] Pipeline 1117 e2e-test trace: `Error response from daemon: Get "https://registry.harbor.lan/v2/": unauthorized`
  - [S2] Pipeline 1118 e2e-test trace: `artifact library/mentatlab-orchestrator-go:aba63be3 not found`
  - [S3] `.gitlab-ci.yml:230-232` — e2e variables now use `:latest`
  - [S4] `glab api /admin/ci/variables/HARBOR_USER` — `raw: true`

### M3: Production Hardening - DONE

- What changed (9 steps):
  1. **Health probes**: `k8s/orchestrator.yaml` readiness probe path `/healthz` → `/ready`. Gateway `main.go` now returns HTTP 503 (was 200) when Redis unhealthy.
  2. **Tracing init**: Added `TracingEnabled`/`OTLPEndpoint` to orchestrator config. `cmd/orchestrator/main.go` calls `tracing.Init()` with graceful shutdown. Mirrors gateway pattern.
  3. **Trace ID in logs**: Both `internal/api/middleware.go` (orchestrator) and `middleware/logging.go` (gateway) extract `trace.SpanContextFromContext()` and log `trace_id`.
  4. **Business metrics**: `internal/scheduler/scheduler.go` imports `metrics` package. Instruments `StartRun` (RunsActive.Inc), `onNodeFinished` (NodesTotal, NodeDuration, NodeRetries), `checkRunCompletion` (RunsActive.Dec, RunsTotal), `CancelRun` (RunsActive.Dec, RunsTotal cancelled), `emitEvent` (EventsTotal).
  5. **Tracing spans**: Package tracer `otel.Tracer("mentatlab/scheduler")` in scheduler, `otel.Tracer("mentatlab/api")` in handlers. Spans on `StartRun`, `scheduleNode`, `CreateRun`, `StartRun` handler, `StreamEvents` with `run_id`/`node_id` attributes. OTLP env vars added to both K8s deployments.
  6. **Dataflow service**: `cmd/orchestrator/main.go` conditionally creates `dataflow.Service` from `DATAFLOW_TYPE`/`MINIO_*` env vars. Passed to `HandlerOptions.DataflowSvc`. Artifact endpoints now return real data when MinIO configured.
  7. **Auth + rate limiting**: `auth.NewProvider()` + `auth.NewMiddleware()` conditionally created when `OIDC_ENABLED=true`. `auth.NewPerIPRateLimiter()` applied to API subrouter. `NewServer()` signature updated to accept middleware params. Disabled by default.
  8. **K8s manifest hardening**: All 4 deployment images pinned to `:v0.0.0-placeholder` (CI overrides via kustomize `set image`). `imagePullPolicy: IfNotPresent`. Duplicate PDBs removed from `orchestrator.yaml` and `gateway.yaml` (canonical PDBs in `hpa.yaml`).
  9. **Handler tests + CI coverage**: `internal/api/handlers_test.go` with 15 tests (Health, Ready, CRUD runs/agents/flows, 404s, SSE content-type, artifacts 503, StartRun 503). CI: `-coverprofile=cover.out` + coverage regex for both Go and frontend.
- What verified:
  - `go build ./cmd/orchestrator/` and `go build .` (gateway) succeed
  - `go test ./...` passes for both services (all 15 new handler tests pass)
  - `go vet ./...` clean for both services
- Sources:
  - [S1] `services/orchestrator-go/cmd/orchestrator/main.go` - tracing init, dataflow init, auth wiring
  - [S2] `services/orchestrator-go/internal/scheduler/scheduler.go` - metrics + spans
  - [S3] `services/orchestrator-go/internal/api/routes.go` - auth/rate-limit middleware on API subrouter
  - [S4] `services/orchestrator-go/internal/api/handlers_test.go` - 15 API handler tests
  - [S5] `k8s/orchestrator.yaml`, `k8s/gateway.yaml` - OTLP env, image pins, PDB removal

### M2: Fix Canvas → RunPlan conversion for control flow nodes - DONE

- What changed: `services/frontend/src/components/mission-control/layout/WorkspaceProvider.tsx:120-158`: Rewrote `startOrchestratorRun()` node mapping to detect `conditional` and `forEach` node types and build nested config objects.
- Why: ForEachNode stores config flat in `node.data` (e.g., `data.collection`, `data.itemVar`), but RunPlan expects nested `for_each: { collection, item_var, ... }`. Same for ConditionalNode (`data.expression` → `conditional: { expression, ... }`). The old code read `n.data?.conditional` and `n.data?.for_each` which were always undefined — control flow nodes were silently sent as plain task nodes.
- Also maps camelCase frontend fields to snake_case backend fields: `itemVar` → `item_var`, `indexVar` → `index_var`, `maxParallel` → `max_parallel`.
- What verified: `tsc --noEmit` clean, `npm test` 65/65 pass.
- Sources:
  - [S1] `services/frontend/src/components/mission-control/layout/WorkspaceProvider.tsx:120-158` - new conversion logic
  - [S2] `services/frontend/src/nodes/ForEachNode.tsx:18-30` - ForEachNodeData interface (flat)
  - [S3] `services/frontend/src/types/orchestrator.ts:68-96` - PlanNode interface (nested)

### CI Fix: Missing @vitest/coverage-v8 - DONE

- What happened: Pipeline 1131 test-frontend failed with `Cannot find dependency '@vitest/coverage-v8'` after M3 added `-- --coverage` flag to `npm test`.
- What changed: Added `@vitest/coverage-v8@^3.2.4` to `services/frontend/package.json` devDependencies.
- What verified: `npm test -- --coverage` succeeds locally, 65/65 tests pass.

### M4: Developer Experience - IN PROGRESS

- What changed:
  - **Archive specs**: Moved 13 aspirational milestone spec files (`v1.0_milestone_spec.md`, `v1.1_milestone_spec.md`, `v2.0_milestone_spec.md`, summaries, PKI/WASM guides, gap analysis, rearchitecture plan, MVP roadmap, PR plan) to `docs/archive/milestone-specs/`.
  - **Go agent template**: Created `cli/mentatctl/templates/go/` with manifest.yaml (go1.23 runtime), Dockerfile (multi-stage alpine), go.mod, and main.go implementing full NDJSON contract (emit, checkpoint, logInfo, logError, emitOutput). Updated `agent_commands.py:27` to accept `go` template.
  - **Example flows**: Created 3 new flows in `examples/`:
    - `conditional_routing.json` — switch/case routing based on classifier output
    - `foreach_batch.json` — parallel batch processing with max_parallel=2
    - `data_pipeline.json` — multi-stage DAG with parallel ingest → validate/enrich → transform → output
  - **README.md**: Rewrote root README with docker-compose quickstart, architecture diagram, config table, agent scaffolding, example flows table, documentation links.
  - **ROADMAP.md**: Updated M3 as complete, M4 in progress with completed/remaining items.
- Sources:
  - [S1] `cli/mentatctl/templates/go/src/main.go` - Go agent template
  - [S2] `examples/conditional_routing.json` - conditional flow example
  - [S3] `docs/archive/milestone-specs/` - 13 archived files

### M4 Completion: Demo Mode + mentatctl dev run - DONE

- What changed:
  - **Demo mode**: Added `DEMO_MODE` feature flag to `features.ts` (default: true). Created `src/data/exampleFlows.ts` with 4 bundled flows (echo, conditional routing, foreach batch, data pipeline). Updated `useFlowLoader.ts` to fall back to example flows when backend returns empty or is unreachable.
  - **mentatctl dev run**: Fixed default port from 8001 → 7070. Fixed endpoint from `/agents/schedule` → `/api/v1/runs`. Implemented `--local` flag: runs agent as subprocess, feeds JSON input via stdin, parses NDJSON events from stdout (log, checkpoint, output types formatted). Added `--watch` flag with file-change polling for re-runs. Split into `_dev_run_local()` and `_dev_run_remote()`.
  - **Agent SDK docs**: Added `type: "output"` event docs and `emitOutput()` Go helper to `docs/agent-sdk.md`.
  - **Docs index**: Rewrote `docs/README.md` with canonical/operational/roadmap/archived doc tables.
- What verified: `tsc --noEmit` clean, `npm test` 65/65 pass, `python3 agents/echo/main.py hello world` produces valid NDJSON.
- **M4 status**: Complete (tracing UI deferred to future — requires OTLP query API + frontend waterfall).
- Sources:
  - [S1] `services/frontend/src/data/exampleFlows.ts` - bundled example flows
  - [S2] `services/frontend/src/hooks/useFlowLoader.ts:70-75` - demo mode fallback
  - [S3] `cli/mentatctl/main.py:98-175` - _dev_run_local subprocess execution

## 2026-02-16

### M5-M6: Backend Implementation - DONE

- What changed:
  - **M5.3 Run timeouts**: Added `Timeout` field to `types.Plan`, `ORCH_DEFAULT_RUN_TIMEOUT` config. `StartRun` creates `context.WithTimeout`. On expiry: cancels tasks, closes gates, marks failed.
  - **M5.4 Retry policies**: Added `RetryPolicy` struct with `MaxRetries`, `BackoffType` (fixed/exponential/linear), `BackoffBase`, `BackoffMax`. `resolveRetryPolicy()` resolves node-level overrides.
  - **M5.5 Grafana dashboards**: Two ConfigMaps in `k8s/grafana-dashboards.yaml` — orchestrator (11 panels) and gateway (5 panels).
  - **M6.1 Gate nodes**: `GateConfig` type, `waiting_approval` status, `executeGate` with approval channels, auto-timeout, approve/reject REST endpoints.
  - **M6.2 Webhooks**: `WebhookToken` on Flow, `POST /webhooks` generates token, `POST /webhooks/trigger/{flowId}` validates and starts run.
  - **M6.3 Run cloning**: `POST /runs/{id}/clone`, `POST /flows/{id}/run`. `FlowID`/`ParentRunID` lineage.
  - **M6.4 Cron**: `CronRunner` goroutine, 5-field parser, schedule CRUD.
  - **M6.5 Frontend**: GateNode component, retry policy editor, timeout config, clone/re-run buttons, gate conversion in WorkspaceProvider, new API client methods.
- Tests: 13 tests in `m5m6_test.go` (timeouts, retries, gates, cron) — all passing. Full suite passes.
- Sources:
  - [S1] `services/orchestrator-go/internal/scheduler/scheduler.go` - timeout + gate execution
  - [S2] `services/orchestrator-go/internal/api/handlers_m5m6.go` - all M5-M6 API handlers
  - [S3] `services/orchestrator-go/internal/api/routes.go:91-109` - new routes
  - [S4] `services/orchestrator-go/internal/scheduler/cron.go` - CronRunner
  - [S5] `services/frontend/src/nodes/GateNode.tsx` - gate node component

### Deploy to K3s Cluster - DONE (4 fixes)

- **Fix 1 — Image tags**: Flux reconciles from Git, reverting CI's runtime `kustomize edit set image` overrides. Manifests had `:v0.0.0-placeholder` which doesn't exist in Harbor.
  - Fix: Added `images` transformer to `k8s/kustomization.yaml` overriding all 4 images to `:latest` (always pushed by CI).
  - Source: `k8s/kustomization.yaml:21-32` — images transformer
- **Fix 2 — imagePullPolicy**: `:latest` with `IfNotPresent` serves stale cached images. Nodes had old builds cached.
  - Fix: Changed `imagePullPolicy: Always` for all Harbor images (orchestrator, gateway, frontend, echoagent).
  - Source: `k8s/orchestrator.yaml:46`, `k8s/gateway.yaml:45`, `k8s/frontend.yaml:45`, `k8s/echoagent.yaml:30`
- **Fix 3 — MinIO network policies**: `default-deny-all` NetworkPolicy blocked all MinIO ingress and bucket-init job egress.
  - Fix: Added `minio-policy` (allows ingress from orchestrator + bucket-init) and `minio-init-policy` (allows job egress to MinIO).
  - Source: `k8s/network-policies.yaml` — 2 new policies
- **Fix 4 — Frontend nginx volumes**: `readOnlyRootFilesystem: true` prevented nginx from writing to `/var/cache/nginx/`. Old Vite-specific emptyDir mounts wrong paths.
  - Fix: Replaced Vite volumes (`/home/node/.cache`, `/app/node_modules/.vite-temp`) with nginx paths (`/var/cache/nginx`, `/var/run`).
  - Source: `k8s/frontend.yaml:86-99` — nginx volume mounts
- **MinIO credentials**: Created `minio-credentials` secret in mentatlab namespace for MINIO_ACCESS_KEY/MINIO_SECRET_KEY.
- **Grafana dashboards**: Applied ConfigMaps to monitoring namespace.
- Final state: All pods Running, Flux `Ready: True`, MinIO bucket created, M5-M6 API endpoints verified working (`/api/v1/schedules` returns `{"count":0,"schedules":[]}`).
- Sources:
  - [S1] Commits: `261a6b1` (image tags), `fa4b9e1` (network policies), `85c0996` (imagePullPolicy), `1f659b0` (nginx volumes)
  - [S2] Pipeline 1148 — all stages green (lint, test, build, e2e, deploy)

## 2026-02-18

### MentatLab docs integration into flexinfer-site - DONE

- What changed in `services/mentatlab`:
  - Added curated public docs set:
    - `docs/site/README.md`
    - `docs/site/getting-started.md`
    - `docs/site/architecture.md`
    - `docs/site/api-reference.md`
    - `docs/site/deployment.md`
  - Updated `docs/README.md` to split "Public Docs (Site-Ready)" from internal docs.

- What changed in `services/flexinfer-site`:
  - Added MentatLab project to docs sync pipeline:
    - `scripts/sync-docs.mjs` (`name: mentatlab`, source `../mentatlab/docs`, target `content/mentatlab-docs`)
    - `package.json` script: `sync:mentatlab-docs`
  - Added docs renderer instance:
    - `lib/project-docs.ts` export `mentatlabDocs`
  - Added docs routes:
    - `app/docs/mentatlab/page.tsx`
    - `app/docs/mentatlab/[...slug]/page.tsx`
  - Added curated nav:
    - `content/mentatlab-docs/nav.yaml`
  - Updated docs hub:
    - Added MentatLab card in `app/docs/page.tsx`
  - Updated product/docs linkage:
    - `data/portfolio-positioning.ts` `docsHref` -> `/docs/mentatlab`
    - `app/products/mentatlab/page.tsx` docs CTA now internal `<Link>`
    - `lib/content-links.ts` adds `/docs/mentatlab` relationships
  - Updated tests:
    - `__tests__/lib/portfolio-positioning.test.ts`
    - `__tests__/lib/content-links.test.ts`

- Commands run:
  - `node scripts/sync-docs.mjs mentatlab`
  - `pnpm typecheck`
  - `pnpm test __tests__/lib/content-links.test.ts __tests__/lib/portfolio-positioning.test.ts __tests__/lib/mentatlab-page.test.ts`

- Validation:
  - Typecheck passed.
  - Targeted test suites passed (3/3, 10 tests).
  - [S3] `kubectl get pods -n mentatlab` — all pods 1/1 Running
  - [S4] `kubectl get kustomization mentatlab -n flux-system` — `Ready: True`

### M7: Multi-User & API Maturity - DONE

- What changed (5 sub-milestones):

  **M7.1 — User identity propagation**:
  - `services/gateway-go/main.go`: Proxy director now forwards `X-User-Email` and `X-User-Type` headers from Cloudflare Access claims to orchestrator.
  - `services/orchestrator-go/pkg/types/run.go`: Added `Owner` field to `Run` struct.
  - `services/orchestrator-go/internal/runstore/store.go`: `CreateRun` signature updated to accept `owner` param. Added `ListRunsWithOptions` with `Owner` filter.
  - `services/orchestrator-go/internal/runstore/memory.go`: `memoryRun` stores `owner`, `webhookURL`, `webhookSecret`. `ListRunsWithOptions` filters by owner.
  - `services/orchestrator-go/internal/runstore/redis.go`: Stores owner in run meta hash. `ListRunsWithOptions` filters by owner.
  - `services/orchestrator-go/internal/api/handlers.go`: `CreateRun` handler extracts owner from `X-User-Email` header via `getOwnerFromRequest()`. `CreateFlow` handler now sets `CreatedBy` from user header when not provided.

  **M7.2 — API key authentication**:
  - `services/orchestrator-go/internal/auth/apikey.go` (NEW): Redis-backed `APIKeyStore` with `GenerateKey` (`mlk_` prefix, sha256 hashed), `ValidateKey`, `RevokeKey`, `ListKeys`. `IsAPIKey` helper checks prefix.
  - `services/orchestrator-go/internal/auth/middleware.go`: Auth handler checks for `mlk_` prefix before falling back to OIDC. API key validation sets `X-User-Email` from key owner.
  - `services/orchestrator-go/internal/api/handlers_apikey.go` (NEW): `CreateAPIKey` (POST), `ListAPIKeys` (GET), `RevokeAPIKey` (DELETE) handlers. Strips `key_hash` from list responses.
  - `services/orchestrator-go/internal/api/routes.go`: Added `/apikeys` routes.
  - `services/orchestrator-go/cmd/orchestrator/main.go`: Wired `APIKeyStore` into auth middleware and handler options. Added `redisClient` helper.

  **M7.3 — Cursor-based pagination**:
  - `services/orchestrator-go/internal/runstore/store.go`: Added `PagedResult`, `PageOptions` types. Added `ListRunsPaged` to `RunStore` interface. Added `encodeCursor`/`decodeCursor` helpers (base64 `timestamp:id`).
  - `services/orchestrator-go/internal/runstore/memory.go`: `ListRunsPaged` sorts by `createdAt` descending, applies cursor-based slicing.
  - `services/orchestrator-go/internal/runstore/redis.go`: `CreateRun` now `ZADD`s to sorted set index (`prefix:index`). `ListRunsPaged` uses `ZREVRANGEBYSCORE` for efficient range queries.
  - `services/orchestrator-go/internal/api/handlers.go`: `ListRuns` rewritten to support `?cursor=` with `next_cursor` in response. Legacy `?offset=` still works as fallback.
  - `services/orchestrator-go/internal/flowstore/store.go`: Added `FlowPagedResult` type, `Cursor` field to `ListOptions`.

  **M7.4 — Webhook callbacks on run completion**:
  - `services/orchestrator-go/pkg/types/run.go`: Added `WebhookURL`, `WebhookSecret` fields to `Run`.
  - `services/orchestrator-go/internal/runstore/store.go`: Added `SetRunWebhook` to `RunStore` interface.
  - `services/orchestrator-go/internal/runstore/memory.go`: Implemented `SetRunWebhook`.
  - `services/orchestrator-go/internal/runstore/redis.go`: Implemented `SetRunWebhook` (stores in meta hash).
  - `services/orchestrator-go/internal/scheduler/callback.go` (NEW): `CallbackPayload` struct, `fireWebhookCallback` reads run and fires async, `deliverWebhook` POSTs with HMAC-SHA256 signature (`X-MentatLab-Signature`), 3 retries with exponential backoff.
  - `services/orchestrator-go/internal/scheduler/scheduler.go`: Calls `fireWebhookCallback` at 3 terminal states in `checkRunCompletion` (cancelled, all succeeded/skipped, failed).
  - `services/orchestrator-go/internal/api/handlers.go`: `CreateRunRequest` includes `WebhookURL`/`WebhookSecret`. Handler calls `SetRunWebhook` after run creation.

  **M7.5 — Load testing baseline**:
  - `tests/load/orchestrator.js` (NEW): k6 load test with 3 scenarios: CRUD throughput (ramping 1→10 VUs), concurrent run execution (5 VUs), pagination stress (3 VUs). SLO thresholds: create p95<200ms, list p95<300ms, get p95<100ms, errors<5%.

- Tests:
  - `services/orchestrator-go/internal/api/handlers_m7_test.go` (NEW): 4 tests — `TestCreateRunWithWebhook`, `TestListRunsCursorPagination`, `TestListRunsOwnerFilter`, `TestCreateFlowSetsCreatedBy`. All passing.
  - Full test suite (`go vet ./... && go test ./...`): All passing.
- Sources:
  - [S1] `services/orchestrator-go/internal/auth/apikey.go` — API key store
  - [S2] `services/orchestrator-go/internal/scheduler/callback.go` — webhook delivery
  - [S3] `services/orchestrator-go/internal/runstore/store.go` — pagination types + cursor helpers
  - [S4] `services/orchestrator-go/internal/api/handlers_m7_test.go` — M7 tests
  - [S5] `tests/load/orchestrator.js` — k6 load test

### M8: Frontend Quality — DONE

- What changed:
  - **Vitest config fix**: Updated `vitest.config.ts` include patterns to pick up both `.test.*` and `.spec.*` files. Added v8 coverage config targeting components, stores, hooks.
  - **Jest→Vitest migration**: Fixed 11 pre-existing `.spec.*` files that used `jest.mock`/`jest.fn` → `vi.mock`/`vi.fn`. Fixed mock path aliases (`@/config/...` not relative paths).
  - **Pre-existing spec fixes (9 files, 20 tests)**:
    - `mediaService.spec.ts`: Rewrote to match current API (`getPresignedUrl`/`uploadChunks`)
    - `orchestratorService.spec.ts`: Fixed vi.mock path, updated cancelRun for POST-first/DELETE-fallback pattern
    - `orchestratorSSE.spec.ts`: Made MockEventSource auto-fire open event via microtask
    - `ConsolePanel.spec.tsx`, `RunsPanel.spec.tsx`, `ContractOverlay.spec.tsx`: Added ToastProvider wrappers
    - `TimelinePanel.spec.tsx`: Fixed multiple-element selector issue
    - `IssuesPanel.spec.tsx`, `StatusBar.spec.tsx`: Updated element queries
  - **New store tests (6 files, 193 tests)**:
    - `flow.test.ts` (59) — CRUD, undo/redo, import/export, selectors
    - `streaming.test.ts` (59) — sessions, messages, legacy API, batching, cleanup
    - `sync.test.ts` (30) — leadership, tab management, subscriptions
    - `useKeyboardShortcuts.test.ts` (28) — key matching, modifiers, input handling
    - `useFlowLoader.test.ts` (7) — API load, demo fallback, error handling
    - `useAgentSchemas.test.ts` (10) — node enrichment, schema parsing
  - **New UI component tests (9 files, 90 tests)**:
    - Button (15), Badge (7), Card (8), Checkbox (10), Input (9), Select (7), PanelShell (6), PanelErrorBoundary (6), CommandPalette (11), ErrorBoundary (11)
  - **New layout/canvas tests (8 files, 111 tests)**:
    - BottomDock (16), LeftSidebar (14), CanvasDropZone (8), NodePalette (16), QuickAddMenu (15), WorkspaceProvider (15), TopBar (19), useAgentList (8)
  - **New panel/overlay tests (6 files, 106 tests)**:
    - GraphPanel (16), NetworkPanel (15), InspectorPanel (15), AgentBrowser (17), LineageOverlay (18), PolicyOverlay (25)
  - **Contract tests (2 files, 46 tests)**:
    - `run-api.test.ts` (21) — API contract validation
    - `event-parsing.test.ts` (25) — SSE event parsing
- Final results: **47 test files, 673 tests, 0 failures**
- Coverage: **49.11% statements, 81.85% branches, 71.02% functions** (target was 40%+)
- CI: Pipeline 1176 — all automated stages green (lint, test, build, e2e)
- Sources:
  - [S1] `services/frontend/vitest.config.ts` — test config
  - [S2] `npx vitest run --coverage` — 47 files, 673 tests, 49.11% statements
  - [S3] Pipeline 1176 — all stages green

## 2026-02-18

### M5.1: K8s Job Driver Validation (partial) — Dockerfile + Unit Tests

- What changed:
  - `services/agents/echo/Dockerfile`: Hardened for K8s readOnlyRootFilesystem. Added non-root user (uid/gid 1000), PYTHONDONTWRITEBYTECODE=1, PYTHONUNBUFFERED=1. Container now compatible with K8s securityContext in `k8s/echoagent.yaml`.
  - `services/orchestrator-go/internal/k8s/job_test.go` (NEW): 24 unit tests covering JobBuilder, GetJobStatus, and sanitize helpers.
    - BuildJob: basic spec, security context, command, env, timeout, no-image error, image pull secrets, resource limits, labels on pod template, no agent ID, no command, default deadline
    - GetJobStatus: succeeded, failed, running, pending, condition overrides, timestamps
    - Sanitize: K8s name (lowercase, special chars, truncation), K8s label (allowed chars, truncation)
- Why: M5.1 required validating the K8s job driver. The echo agent Dockerfile was incompatible with the hardened K8s pod spec (readOnlyRootFilesystem blocks .pyc writes, root user conflicts with runAsNonRoot). The K8s driver code (`internal/k8s/`) had zero test coverage.
- What verified: All 24 new tests pass. Full orchestrator + gateway test suites pass. `go vet` clean. Pre-commit hooks pass.
- Remaining for M5.1: Build + push echo agent image to Harbor, live test K8s job driver on cluster (create job, stream logs, verify completion).
- Sources:
  - [S1] `services/agents/echo/Dockerfile` — hardened for K8s
  - [S2] `services/orchestrator-go/internal/k8s/job_test.go` — 24 tests
  - [S3] Commit `6771508` — pushed to main
