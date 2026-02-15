# Worklog

Chronological notes while executing the plan (useful for handoffs and debugging).

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
