# Technical Debt Inventory

## Scope

- Product/Service: MentatLab (agent orchestration platform)
- Time horizon: M10-M15 planning cycle (Feb 2026)
- Owners: mentatlab team

## Items

| ID | Component | Debt Statement | Evidence | Impact (1-5) | Risk Reduction (1-5) | Drag Reduction (1-5) | Effort (1-5) | Dependencies | Notes |
|---|---|---|---|---:|---:|---:|---:|---|---|
| DEBT-001 | orchestrator-go/api | Monolithic handlers.go (1,216 lines) | `services/orchestrator-go/internal/api/handlers.go` | 3 | 2 | 4 | 3 | None | Split into domain-grouped handler files |
| DEBT-002 | orchestrator-go | Zero test coverage for critical packages | auth, driver, dataflow, config (10 files) | 5 | 5 | 3 | 3 | None | **Completed.** auth 63→83%, driver 60→83%, dataflow 61→93%, config 100%. Commit `308d33a`. |
| DEBT-003 | orchestrator-go/main | Silent Redis-to-memory fallback | `cmd/orchestrator/main.go:85-86` | 4 | 5 | 2 | 1.5 | None | Quick fix — fail fast or explicit opt-in |
| DEBT-004 | frontend | 457 'any' type usages | Spread across api-integration, streaming, stores | 3 | 3 | 3 | 4 | None | Incremental type hardening |
| DEBT-005 | frontend | Test coverage at ~20% | Canvas, layout, overlays untested | 4 | 4 | 3 | 4 | None | Aligns with M15 goals |
| DEBT-006 | k8s | :latest image tags in production | `k8s/kustomization.yaml:21-31` | 3 | 4 | 2 | 2 | CI changes | Needs CI to pin tags |
| DEBT-007 | k8s/frontend | Hardcoded IP in manifest | `k8s/frontend.yaml:54` | 3 | 3 | 2 | 1.5 | None | Quick fix — use service DNS |
| DEBT-008 | orchestrator-go/scheduler | Monolithic scheduler; lack of Strategy Pattern | `internal/scheduler/scheduler.go` | 3 | 2 | 4 | 3 | DEBT-001 | Extract retry, gate, events |
| DEBT-009 | gateway-go/middleware | Auth coupling to Cloudflare | `middleware/auth.go` (391 lines) | 2 | 3 | 3 | 3 | M13 scope | Abstract provider interface |
| DEBT-010 | gateway-go | Test coverage at ~25% | metrics, traces, hub edge cases untested | 3 | 3 | 2 | 2 | None | Moderate effort |
| DEBT-011 | k8s/redis | Redis uses emptyDir | `k8s/redis.yaml` — no persistence | 4 | 4 | 1.5 | 2 | Longhorn SC | Critical for production |
| DEBT-012 | frontend/components | Large components >380 lines | NetworkPanel (777), Layout (529) | 2 | 2 | 4 | 4 | DEBT-005 | Split to enable testing |
| DEBT-013 | k8s/minio | MinIO credentials optional | `k8s/minio.yaml:74-83` | 3 | 4 | 1.5 | 1.5 | None | Quick security fix |
| DEBT-014 | frontend/stores | Legacy re-exports | `stores/index.ts:122-129` | 2 | 1.5 | 3 | 2 | None | Low risk cleanup |
| DEBT-015 | orchestrator-go | No circuit breaker for Redis/K8s | `runstore/redis.go`, `driver/k8s.go` | 3 | 4 | 1.5 | 3 | None | Production resilience |
| DEBT-016 | docker-compose | Dev config lacks health checks | `docker-compose.dev.yml` | 1.5 | 1.5 | 2 | 1.5 | None | Low priority polish |
| DEBT-017 | agents/common | Agent code duplication | No base class in Python SDK | 3 | 2 | 4 | 3 | None | Implement Template Method pattern |
| DEBT-018 | cli/mentatctl | Brittle scaffolding | Simple string replacement in templates | 2 | 2 | 3 | 2 | None | Implement Builder pattern |
| DEBT-019 | orchestrator-go | Rigid service initialization | Constructors take large rigid structs | 2 | 1 | 3 | 2 | None | Implement Options pattern |
| DEBT-020 | orchestrator-go | Fragmented component creation | `main.go` has 300+ lines of switch-cases | 3 | 2 | 4 | 2 | None | Implement Factory pattern |
