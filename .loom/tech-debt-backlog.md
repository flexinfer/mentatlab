# Technical Debt Backlog

## Active Wave: Wave 1 (Quick Wins)

| ID | Title | Component | Priority | Status |
|---|---|---|---|---|
| DEBT-003 | Silent Redis fallback | orchestrator-go/main | Critical | Completed |
| DEBT-019 | Go Options Pattern | orchestrator-go | High | Completed |
| DEBT-013 | MinIO optional credentials | k8s/minio | High | Pending |
| DEBT-007 | Hardcoded IP in manifest | k8s/frontend | High | Pending |
| DEBT-011 | Redis emptyDir (persistence) | k8s/redis | High | Pending |
| DEBT-006 | :latest image tags | k8s | Medium | Pending |
| DEBT-002 | Test coverage: auth/driver/dataflow | orchestrator-go | High | Completed |

## Next Up: Wave 2 (Architectural)

| ID | Title | Component | Priority | Status |
|---|---|---|---|---|
| DEBT-020 | Orchestrator Factories | orchestrator-go/cmd | High | Completed |
| DEBT-015 | Circuit breaker (Redis/K8s) | orchestrator-go | Medium | Pending |
| DEBT-001 | Monolithic handlers split | orchestrator-go/api | Medium | Pending |
| DEBT-008 | Strategy Pattern (Scheduler) | orchestrator-go/scheduler | Medium | Completed |
| DEBT-017 | Agent Template SDK | agents/common | Medium | Completed |

## Future: Wave 3 (Strategic)

| ID | Title | Component | Priority | Status |
|---|---|---|---|---|
| DEBT-018 | CLI Builder Pattern | cli/mentatctl | Low | Pending |
| DEBT-004 | Frontend 'any' reduction | frontend | Medium | Pending |
| DEBT-009 | Auth provider abstraction | gateway-go | Medium | Pending |
| DEBT-012 | Component decomposition | frontend | Low | Pending |
