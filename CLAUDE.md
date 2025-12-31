# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MentatLab is an AI agent orchestration platform with a Mission Control interface for building, monitoring, and executing agent workflows as DAGs. The platform supports both Python and Go backends.

## Architecture

```
Browser → Gateway → Orchestrator → Agents
             ↓           ↓
           Redis ←───────┘
```

**Core Components:**
- **Frontend**: React + ReactFlow canvas for visual workflow building (Vite, Zustand, Tailwind)
- **Gateway**: API proxy + WebSocket hub (Go: `services/gateway-go/`, Python: `services/gateway/`)
- **Orchestrator**: DAG execution engine with K8s/subprocess/memory modes (Go: `services/orchestrator-go/`, Python: `services/orchestrator/`)
- **Redis**: Message broker and state storage

**Deployment:** GitOps via Flux CD to K3s. Manifests in `k8s/`. Images pushed to `registry.harbor.lan/library/mentatlab-*`.

## Development Commands

### Full Stack (Docker Compose)
```bash
docker-compose up                    # Start all services
docker-compose -f docker-compose.dev.yml up  # Dev mode with hot reload
./run-local-dev.sh                   # Full local dev setup with health checks
./quick-start.sh                     # Lightweight startup
```

### Frontend
```bash
cd services/frontend
npm install
npm run dev        # Dev server at http://localhost:5173
npm test           # Run vitest
npm run lint       # TypeScript type check
npm run e2e        # Playwright tests
```

### Go Services
```bash
# Gateway (port 8080)
cd services/gateway-go && go run main.go

# Orchestrator (port 7070)
cd services/orchestrator-go && go run ./cmd/orchestrator/

# Quick check (lint + test Go services)
make check

# Testing
go test -v ./...
go vet ./...
```

### Python Services
```bash
# Gateway
cd services/gateway
pdm install
pdm run uvicorn app.main:app --port 8080 --reload

# Orchestrator
cd services/orchestrator
pdm install
pdm run uvicorn app.main:app --port 8081 --reload

# Testing (from service directory)
pdm run pytest -v
pdm run pytest tests/test_routes.py -k "test_flow"  # Specific test

# Run all service tests
./run-tests-local.sh
```

### Building & Deploying
```bash
./build-and-push.sh                  # Build and push all images
./build-and-push.sh --skip-push      # Build only, no push
./k8s/deploy.sh --namespace mentatlab # Deploy to K8s
```

## Service URLs (Local Dev)

| Service      | URL                    | Health/Docs               |
|--------------|------------------------|---------------------------|
| Gateway      | http://localhost:8080  | /health, /docs (Python)   |
| Orchestrator | http://localhost:7070  | /health, /healthz         |
| Frontend     | http://localhost:5173  | -                         |
| Redis        | localhost:6379         | -                         |

## Key Directories

- `services/frontend/src/components/mission-control/` - Mission Control UI (canvas, panels, overlays)
- `services/orchestrator/app/` - Python orchestrator core (scheduling.py, runstore.py, streaming.py)
- `services/orchestrator-go/internal/` - Go orchestrator packages:
  - `api/` - HTTP handlers and routing
  - `registry/` - Agent registry (memory/Redis)
  - `flowstore/` - Flow persistence (memory/Redis)
  - `runstore/` - Run state storage
  - `scheduler/` - DAG execution scheduler
  - `k8s/` - Kubernetes job driver
- `services/gateway-go/` - Go gateway with:
  - `hub/` - WebSocket hub with stream filtering
  - `middleware/` - Auth, rate limiting, security headers
- `agents/` - Agent implementations (psyche-sim, ctm-cogpack, echo)
- `cli/mentatctl/` - CLI tool for agent management
- `schemas/` - JSON schemas for flows, agents

## Environment Variables

```bash
PORT=8080                            # Service port
REDIS_URL=redis:6379                 # Redis connection
ORCHESTRATOR_BASE_URL=http://localhost:7070  # Gateway → Orchestrator
ORCH_RUNSTORE=memory|redis|k8s       # Run storage backend
```

## Testing Notes

- Use `pdm run pytest` from service directories (not bare `pytest`)
- Frontend tests: `npm test` runs vitest
- E2E tests require orchestrator + redis: `npm run e2e:run`
- Go tests: `go test -v ./...` from service directory
- Root pytest.ini aggregates paths: `services/orchestrator/app/tests`, `services/gateway/tests`, `services/agents/echo/app`

## CI/CD

GitLab CI (`.gitlab-ci.yml`) runs:
1. **lint-go**: `go vet` on Go services
2. **lint-frontend**: `npm run lint`
3. **test-go**: `go test -v ./...`
4. **test-frontend**: `npm test`
5. **build-images**: BuildKit builds for main branch

## Frontend Architecture

- **State**: Zustand store (`src/store/index.ts`, `src/store.ts`)
- **Canvas**: ReactFlow with custom nodes (`src/nodes/`, `src/components/StreamingCanvas.tsx`)
- **Panels**: Console, Issues, Timeline in `src/components/mission-control/panels/`
- **Feature Flags**: `src/config/features.ts` (CONTRACT_OVERLAY, CONNECT_WS, etc.)
- **Services**: Linter, API clients in `src/services/mission-control/services.ts`
- **Command Palette**: `Cmd+K` opens quick actions (`src/components/ui/CommandPalette.tsx`)

## API Endpoints (Go Orchestrator)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/runs` | GET/POST | List/create runs |
| `/api/v1/runs/{id}` | GET/DELETE | Get/delete run |
| `/api/v1/runs/{id}/start` | POST | Start run execution |
| `/api/v1/runs/{id}/events` | GET (SSE) | Stream run events |
| `/api/v1/agents` | GET/POST | List/register agents |
| `/api/v1/agents/{id}` | GET/PUT/DELETE | Agent CRUD |
| `/api/v1/flows` | GET/POST | List/create flows |
| `/api/v1/flows/{id}` | GET/PUT/DELETE | Flow CRUD |
| `/api/v1/jobs/{id}/status` | GET | K8s job status |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open command palette |
| `Cmd+Z` | Undo |
| `Cmd+Shift+Z` | Redo |
| `Cmd+R` | Run flow |
| `Cmd+D` | Start demo run |
| `Cmd+L` | Toggle lineage overlay |
| `Cmd+P` | Toggle policy overlay |
| `Cmd+T` | Toggle dark mode |
| `Shift+?` | Show all shortcuts |
| `Escape` | Close dialogs/overlays |

## Pre-commit Hooks

Install with `make install-hooks`. Runs on Go file changes:
- `go vet` on gateway-go and orchestrator-go
- `go test` on both services
- `go build` verification
