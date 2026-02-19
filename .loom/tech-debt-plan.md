# Technical Debt Remediation Plan

## Summary

- Planning date: 2026-02-19
- Scope: MentatLab (services/mentatlab) — all components
- Total items considered: 16
- Scoring model: impact 35%, risk reduction 30%, drag reduction 20%, effort inverse 15%
- Ranking artifact: `.loom/tech-debt-priority.md`

## Scoring Snapshot

| Rank | ID | Score | Wave |
|---:|---|---:|---|
| 1 | DEBT-002 (orchestrator test gaps) | 86.00 | 1 |
| 2 | DEBT-003 (silent Redis fallback) | 79.50 | 1 |
| 3 | DEBT-005 (frontend test coverage) | 70.00 | 2 |
| 4 | DEBT-011 (Redis emptyDir) | 70.00 | 1 |
| 5 | DEBT-006 (:latest image tags) | 65.00 | 1 |
| 6 | DEBT-013 (MinIO optional creds) | 64.50 | 1 |
| 7 | DEBT-007 (hardcoded IP) | 60.50 | 1 |
| 8 | DEBT-015 (circuit breaker) | 60.00 | 2 |
| 9 | DEBT-010 (gateway test gaps) | 59.00 | 2 |
| 10 | DEBT-001 (monolithic handlers.go) | 58.00 | 2 |
| 11 | DEBT-008 (monolithic scheduler.go) | 58.00 | 2 |
| 12 | DEBT-004 (frontend any types) | 57.00 | 3 |
| 13 | DEBT-009 (Cloudflare auth coupling) | 53.00 | 3 |
| 14 | DEBT-012 (large components) | 48.00 | 3 |
| 15 | DEBT-014 (legacy store exports) | 47.00 | 3 |
| 16 | DEBT-016 (docker-compose health) | 41.00 | 3 |

---

## Wave 1 — Quick Wins & Critical Fixes (Score >= 64)

**Goal:** Eliminate data-loss risks, close critical test gaps, and fix production K8s configuration issues.

**Items:**

| ID | Title | Effort | Component |
|---|---|---|---|
| DEBT-003 | Silent Redis-to-memory fallback | S (1.5) | orchestrator-go/main |
| DEBT-013 | MinIO credentials optional: true | S (1.5) | k8s/minio |
| DEBT-007 | Hardcoded IP in frontend manifest | S (1.5) | k8s/frontend |
| DEBT-011 | Redis emptyDir (data loss on restart) | S (2) | k8s/redis |
| DEBT-006 | :latest image tags in production | S (2) | k8s |
| DEBT-002 | Zero test coverage: auth, driver, dataflow, config | M (3) | orchestrator-go |

**Acceptance Criteria:**
- DEBT-003: Orchestrator exits non-zero when `ORCH_RUNSTORE=redis` and Redis is unreachable. `--allow-memory-fallback` flag for dev mode.
- DEBT-013: `optional: true` removed. Pod CrashLoopBackOff if secret absent.
- DEBT-007: `VITE_GATEWAY_BASE_URL` derived from ConfigMap or ingress, not hardcoded IP.
- DEBT-011: Redis PVC on Longhorn with `appendonly yes`. Data survives `kubectl delete pod`.
- DEBT-006: CI sets image tags to `CI_COMMIT_SHORT_SHA`. `kustomization.yaml` uses placeholder tags.
- DEBT-002: Tests exist for `auth/`, `driver/`, `dataflow/`, `config/` packages with >60% coverage each.

**Dependencies:** DEBT-006 requires CI pipeline changes (`.gitlab-ci.yml`). All others are independent.

**Risks/Mitigations:**
- DEBT-003 could break local dev if Redis not running → mitigate with `--allow-memory-fallback` flag
- DEBT-011 depends on Longhorn StorageClass availability → verify with `kubectl get sc longhorn`
- DEBT-006 must coordinate with CI template includes → test in MR branch first

---

## Wave 2 — Structural Improvements (Score 58-63)

**Goal:** Improve code maintainability, add gateway test coverage, and introduce resilience patterns.

**Items:**

| ID | Title | Effort | Component |
|---|---|---|---|
| DEBT-010 | Gateway test coverage ~25% | S (2) | gateway-go |
| DEBT-001 | Monolithic handlers.go (1,216 lines) | M (3) | orchestrator-go/api |
| DEBT-008 | Monolithic scheduler.go (1,028 lines) | M (3) | orchestrator-go/scheduler |
| DEBT-015 | No circuit breaker for Redis/K8s | M (3) | orchestrator-go |
| DEBT-005 | Frontend test coverage ~20% | L (4) | frontend |

**Acceptance Criteria:**
- DEBT-010: Gateway coverage >50%. Hub, traces, metrics packages tested.
- DEBT-001: `handlers.go` split into 5 domain files, each <300 lines.
- DEBT-008: `scheduler.go` split; retry, gate, events extracted. Core file <400 lines.
- DEBT-015: `sony/gobreaker` wired to Redis + K8s clients. Circuit state exposed as Prometheus gauge.
- DEBT-005: Frontend coverage >60%. MissionControlLayout, ConsolePanel, API layer tested.

**Dependencies:**
- DEBT-001 and DEBT-008 are independent but share refactoring patterns (do together)
- DEBT-005 benefits from DEBT-012 (Wave 3) but does not block on it
- DEBT-015 should follow DEBT-002 (Wave 1 tests provide safety net for refactor)

**Risks/Mitigations:**
- Handler/scheduler split risks test breakage → run full test suite after each file extraction
- Circuit breaker adds dependency (sony/gobreaker) → evaluate alternatives (custom, hashicorp/go-retryablehttp)
- Frontend test push is large → scope to top-5 files by complexity first

**Constraints:**
- DEBT-001/008 refactors should not change any public API signatures
- DEBT-015 requires load testing (M7.5 k6 script) to validate circuit thresholds

---

## Wave 3 — Strategic Polish (Score < 58)

**Goal:** Reduce frontend type debt, decouple auth, improve component architecture.

**Items:**

| ID | Title | Effort | Component |
|---|---|---|---|
| DEBT-014 | Legacy store re-exports | S (2) | frontend/stores |
| DEBT-009 | Cloudflare auth coupling | M (3) | gateway-go/middleware |
| DEBT-004 | 457 'any' usages | L (4) | frontend |
| DEBT-012 | 7 large components (>380 lines) | L (4) | frontend/components |
| DEBT-016 | Docker Compose health checks | S (1.5) | docker-compose |

**Acceptance Criteria:**
- DEBT-014: All legacy re-exports removed. No `useReactFlowStore` imports remain.
- DEBT-009: `AuthProvider` interface extracted. Cloudflare as one implementation.
- DEBT-004: `any` count <50. Discriminated unions for events. `noImplicitAny` enabled.
- DEBT-012: NetworkPanel, MissionControlLayout split into sub-components <250 lines.
- DEBT-016: All docker-compose services have healthcheck blocks.

**Dependencies:**
- DEBT-009 aligns with M13 (security hardening) — coordinate timing
- DEBT-004 and DEBT-012 are complementary — component splits make typing easier
- DEBT-014 is standalone and can ship anytime

**Risks/Mitigations:**
- DEBT-009 touches auth layer → pair with security review
- DEBT-004/012 are large scope → break into per-file PRs
- DEBT-016 is low-risk polish, no blockers

---

## Not In This Plan

The following items were considered but excluded:

- **Lineage/Policy overlay backends**: Requires new backend services (artifact tracking engine, policy engine). Scoped to M11+ roadmap milestones, not tech debt.
- **Agent SDK structured errors / TypeScript SDK**: Feature work (M12), not debt remediation.
- **Scope-based authorization**: Feature work (M13), though DEBT-009 is a prerequisite.
- **Console virtualization / large DAG perf**: Feature work (M14).
- **Playwright E2E suite**: Feature work (M15), though DEBT-005/010 improve test foundation.

---

## Backlog Conversion

| Debt ID | Wave | Owner | Target Milestone | Status |
|---|---|---|---|---|
| DEBT-003 | 1 | - | M10 | Pending |
| DEBT-013 | 1 | - | M10 | Pending |
| DEBT-007 | 1 | - | M10 | Pending |
| DEBT-011 | 1 | - | M10 | Pending |
| DEBT-006 | 1 | - | M10 | Pending |
| DEBT-002 | 1 | - | M10 | Pending |
| DEBT-010 | 2 | - | M12 | Pending |
| DEBT-001 | 2 | - | M12 | Pending |
| DEBT-008 | 2 | - | M12 | Pending |
| DEBT-015 | 2 | - | M13 | Pending |
| DEBT-005 | 2 | - | M15 | Pending |
| DEBT-014 | 3 | - | M14 | Pending |
| DEBT-009 | 3 | - | M13 | Pending |
| DEBT-004 | 3 | - | M14 | Pending |
| DEBT-012 | 3 | - | M14 | Pending |
| DEBT-016 | 3 | - | Anytime | Pending |
