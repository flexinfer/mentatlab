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
