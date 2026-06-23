# Technical Debt Priority Ranking

Scored using weighted model: impact 35%, risk reduction 30%, drag reduction 20%, effort inverse 15%.

| Rank | ID | Title | Component | Impact | Risk | Drag | Effort | Score |
|---:|---|---|---|---:|---:|---:|---:|---:|
| 1 | DEBT-002 | Zero test coverage for auth, driver, dataflow, config packages | orchestrator-go | 1.00 | 1.00 | 0.60 | 3.0 | 86.00 |
| 2 | DEBT-003 | Silent Redis-to-memory fallback loses data on restart | orchestrator-go/main | 0.80 | 1.00 | 0.40 | 1.5 | 79.50 |
| 3 | DEBT-005 | Frontend test coverage at ~20% (38/186 files tested) | frontend | 0.80 | 0.80 | 0.60 | 4.0 | 70.00 |
| 4 | DEBT-011 | Redis data store uses emptyDir (ephemeral) in K8s | k8s/redis | 0.80 | 0.80 | 0.30 | 2.0 | 70.00 |
| 5 | DEBT-019 | Go service initialization is rigid; lack of Options pattern | services/orchestrator-go | 0.40 | 1.00 | 0.60 | 2.0 | 68.00 |
| 6 | DEBT-006 | K8s manifests use :latest tags in production | k8s | 0.60 | 0.80 | 0.40 | 2.0 | 65.00 |
| 7 | DEBT-013 | MinIO credentials marked optional: true in K8s manifest | k8s/minio | 0.60 | 0.80 | 0.30 | 1.5 | 64.50 |
| 8 | DEBT-020 | Fragmented component creation in orchestrator main.go | services/orchestrator-go/cmd | 0.60 | 0.40 | 0.80 | 2.0 | 61.00 |
| 9 | DEBT-007 | Hardcoded IP in frontend K8s manifest | k8s/frontend | 0.60 | 0.60 | 0.40 | 1.5 | 60.50 |
| 10 | DEBT-015 | No circuit breaker for Redis/K8s API calls in orchestrator | orchestrator-go | 0.60 | 0.80 | 0.30 | 3.0 | 60.00 |
| 11 | DEBT-010 | Gateway test coverage at ~25% (4/16 Go files) | gateway-go | 0.60 | 0.60 | 0.40 | 2.0 | 59.00 |
| 12 | DEBT-001 | Monolithic handlers.go (1,216 lines) in orchestrator API layer | orchestrator-go/api | 0.60 | 0.40 | 0.80 | 3.0 | 58.00 |
| 13 | DEBT-008 | Monolithic scheduler.go mixes logic; lack of Strategy Pattern | orchestrator-go/scheduler | 0.60 | 0.40 | 0.80 | 3.0 | 58.00 |
| 14 | DEBT-017 | Agent code duplication; lack of Template Method pattern in SDK | agents/common | 0.60 | 0.40 | 0.80 | 3.0 | 58.00 |
| 15 | DEBT-004 | 457 'any' type usages in frontend codebase | frontend | 0.60 | 0.60 | 0.60 | 4.0 | 57.00 |
| 16 | DEBT-009 | Gateway auth middleware tightly coupled to Cloudflare Access | gateway-go/middleware | 0.40 | 0.60 | 0.60 | 3.0 | 53.00 |
| 17 | DEBT-018 | CLI scaffolding is brittle; lack of Builder pattern | cli/mentatctl | 0.40 | 0.40 | 0.60 | 2.0 | 50.00 |
| 18 | DEBT-012 | Large frontend components (7 files >380 lines) resist review and testing | frontend/components | 0.40 | 0.40 | 0.80 | 4.0 | 48.00 |
| 19 | DEBT-014 | Frontend state management uses legacy re-exports and dual API surface | frontend/stores | 0.40 | 0.30 | 0.60 | 2.0 | 47.00 |
| 20 | DEBT-016 | Docker Compose dev config lacks health checks and resource limits | docker-compose | 0.30 | 0.30 | 0.40 | 1.5 | 41.00 |

## Suggested Cut Lines

- Wave 1: top 20-30% by score, low dependency risk
- Wave 2: next 30-40%, medium effort and moderate coupling
- Wave 3: remaining strategic refactors with cross-team dependencies
