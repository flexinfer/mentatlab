# Technical Debt Inventory

## Scope

- Product/Service: MentatLab (agent orchestration platform)
- Time horizon: M10-M15 planning cycle (Feb 2026)
- Owners: mentatlab team

## Items

| ID | Component | Debt Statement | Evidence | Impact (1-5) | Risk Reduction (1-5) | Drag Reduction (1-5) | Effort (1-5) | Dependencies | Notes |
|---|---|---|---|---:|---:|---:|---:|---|---|
| DEBT-001 | orchestrator-go/api | Monolithic handlers.go (1,216 lines) | `services/orchestrator-go/internal/api/handlers.go` — all HTTP handlers in one file | 3 | 2 | 4 | 3 | None | Split into domain-grouped handler files |
| DEBT-002 | orchestrator-go | Zero test coverage for auth, driver, dataflow, config | 4 packages (10 source files) with 0 tests — security + execution paths | 5 | 5 | 3 | 3 | None | Highest priority — covers critical paths |
| DEBT-003 | orchestrator-go/main | Silent Redis-to-memory fallback loses data | `cmd/orchestrator/main.go:85-86` — warns but continues with in-memory store | 4 | 5 | 2 | 1 | None | Quick fix — fail fast or explicit opt-in |
| DEBT-004 | frontend | 457 'any' type usages | Spread across api-integration, streaming, stores, graph types | 3 | 3 | 3 | 4 | None | Incremental — start with event payloads |
| DEBT-005 | frontend | Test coverage at ~20% (38/186 files) | Canvas, layout, overlays, services, hooks mostly untested | 4 | 4 | 3 | 4 | None | Aligns with M15 goals |
| DEBT-006 | k8s | :latest image tags in production manifests | `k8s/kustomization.yaml:21-31` — all 4 images use `newTag: latest` | 3 | 4 | 2 | 2 | CI pipeline changes | Needs CI to pin tags |
| DEBT-007 | k8s/frontend | Hardcoded IP in VITE_GATEWAY_BASE_URL | `k8s/frontend.yaml:54` — `http://192.168.50.244:8080` | 3 | 3 | 2 | 1 | None | Quick fix — use service DNS |
| DEBT-008 | orchestrator-go/scheduler | Monolithic scheduler.go (1,028 lines) | DAG walk, retry, gate, event emission all in one file | 3 | 2 | 4 | 3 | DEBT-001 | Similar refactor pattern |
| DEBT-009 | gateway-go/middleware | Auth middleware coupled to Cloudflare Access | `middleware/auth.go` (391 lines) — no provider abstraction | 2 | 3 | 3 | 3 | M13 auth hardening | Part of M13 scope |
| DEBT-010 | gateway-go | Test coverage at ~25% (4/16 files) | metrics, traces, tracing, hub edge cases untested | 3 | 3 | 2 | 2 | None | Moderate effort |
| DEBT-011 | k8s/redis | Redis uses emptyDir (data lost on restart) | `k8s/redis.yaml` — no PVC, run state ephemeral | 4 | 4 | 1 | 2 | Longhorn available | Critical for production |
| DEBT-012 | frontend/components | 7 components >380 lines resist testing | NetworkPanel (777), MissionControlLayout (529), etc. | 2 | 2 | 4 | 4 | DEBT-005 | Enables better test coverage |
| DEBT-013 | k8s/minio | MinIO credentials optional: true | `k8s/minio.yaml:74-83` — starts with blank creds if secret missing | 3 | 4 | 1 | 1 | None | Quick security fix |
| DEBT-014 | frontend/stores | Legacy re-exports and dual API surface | `stores/index.ts:122-129` — useReactFlowStore alias, LegacyStreamSession | 2 | 1 | 3 | 2 | None | Low risk cleanup |
| DEBT-015 | orchestrator-go | No circuit breaker for Redis/K8s calls | `runstore/redis.go`, `driver/k8s.go` — cascading failures possible | 3 | 4 | 1 | 3 | None | Production resilience |
| DEBT-016 | docker-compose | Dev config lacks health checks | `docker-compose.dev.yml` — no healthcheck, no resource limits | 1 | 1 | 2 | 1 | None | Low priority polish |

## Source Links

- Incident(s): None recorded (pre-production)
- CI failures/flakes: E2E test stage uses `:latest` tags (fixed in bbac64c)
- SLO/metrics regressions: N/A
- TODO/FIXME scans: 15 markers found (mostly in templates and docs, 2 actionable in `cli/mentatctl/main.py:400`, `services/frontend/src/store/index.ts:83`)
