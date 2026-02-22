# Technical Debt Remediation Plan

## Summary

- Planning date: 2026-02-20
- Scope: MentatLab (services/mentatlab) — all components
- Total items considered: 20
- Scoring model: impact 35%, risk reduction 30%, drag reduction 20%, effort inverse 15%
- Ranking artifact: `.loom/tech-debt-priority.md`

## Scoring Snapshot

| Rank | ID | Score | Wave |
|---:|---|---:|---|
| 1 | DEBT-002 (orchestrator test gaps) | 86.00 | 1 |
| 2 | DEBT-003 (silent Redis fallback) | 79.50 | 1 |
| 3 | DEBT-005 (frontend test coverage) | 70.00 | 2 |
| 4 | DEBT-011 (Redis emptyDir) | 70.00 | 1 |
| 5 | DEBT-019 (Go Options pattern) | 68.00 | 1 |
| 6 | DEBT-006 (:latest image tags) | 65.00 | 1 |
| 7 | DEBT-013 (MinIO optional creds) | 64.50 | 1 |
| 8 | DEBT-020 (Orchestrator Factories) | 61.00 | 2 |
| 9 | DEBT-007 (hardcoded IP) | 60.50 | 1 |
| 10 | DEBT-015 (circuit breaker) | 60.00 | 2 |
| 11 | DEBT-010 (gateway test gaps) | 59.00 | 2 |
| 12 | DEBT-001 (monolithic handlers.go) | 58.00 | 2 |
| 13 | DEBT-008 (Strategy pattern scheduler) | 58.00 | 2 |
| 14 | DEBT-017 (Agent Template SDK) | 58.00 | 2 |
| 15 | DEBT-004 (frontend any types) | 57.00 | 3 |
| 16 | DEBT-009 (Cloudflare auth coupling) | 53.00 | 3 |
| 17 | DEBT-018 (CLI Builder pattern) | 50.00 | 3 |
| 18 | DEBT-012 (large components) | 48.00 | 3 |
| 19 | DEBT-014 (legacy store exports) | 47.00 | 3 |
| 20 | DEBT-016 (docker-compose health) | 41.00 | 3 |

---

## Wave 1 — Quick Wins & Infrastructure (Score >= 60.5)

**Goal:** Fix data-loss risks, establish clean Go initialization patterns, and secure production manifests.

**Items:**

| ID | Title | Effort | Component |
|---|---|---|---|
| DEBT-003 | Silent Redis-to-memory fallback | S (1.5) | orchestrator-go/main |
| DEBT-019 | Go service initialization (Options Pattern) | S (2) | orchestrator-go |
| DEBT-013 | MinIO credentials optional: true | S (1.5) | k8s/minio |
| DEBT-007 | Hardcoded IP in frontend manifest | S (1.5) | k8s/frontend |
| DEBT-011 | Redis emptyDir (data loss on restart) | S (2) | k8s/redis |
| DEBT-006 | :latest image tags in production | S (2) | k8s |
| DEBT-002 | Zero test coverage for critical packages | M (3) | orchestrator-go |

**Key Changes:**
- **DEBT-019**: Move `NewScheduler`, `NewHub`, `NewRegistry` to Functional Options pattern. Simplifies testing and future expansion.
- **DEBT-002**: Primary focus on `auth/`, `driver/`, and `config/` packages.

---

## Wave 2 — Architectural Refactors (Score 58-61)

**Goal:** Decouple monolithic services, simplify `main.go` via Factories, and standardize agent SDKs.

**Items:**

| ID | Title | Effort | Component |
|---|---|---|---|
| DEBT-020 | Orchestrator Factories (Clean main.go) | S (2) | orchestrator-go/cmd |
| DEBT-015 | No circuit breaker for Redis/K8s | M (3) | orchestrator-go |
| DEBT-001 | Monolithic handlers.go (SRP split) | M (3) | orchestrator-go/api |
| DEBT-008 | Strategy Pattern for scheduler | M (3) | orchestrator-go/scheduler |
| DEBT-017 | Agent Template Method SDK | M (3) | agents/common |
| DEBT-010 | Gateway test coverage ~50% | S (2) | gateway-go |
| DEBT-005 | Frontend test coverage ~60% | L (4) | frontend |

**Key Changes:**
- **DEBT-020**: Move switch-case instantiation from `main.go` to `pkg/factories/`.
- **DEBT-008**: Implement Strategy pattern for node dispatch (Conditional, ForEach, Agent).
- **DEBT-017**: Introduce `MentatAgent` base class to reduce boilerplate in `psyche-sim` and `echo`.

---

## Wave 3 — Strategic Polish (Score < 58)

**Goal:** Type hardening, component decomposition, and CLI improvement.

**Items:**

| ID | Title | Effort | Component |
|---|---|---|---|
| DEBT-018 | CLI Builder Pattern for scaffolding | S (2) | cli/mentatctl |
| DEBT-004 | Frontend 'any' type reduction (<50) | L (4) | frontend |
| DEBT-009 | Cloudflare auth abstraction | M (3) | gateway-go/middleware |
| DEBT-012 | Large component decomposition | L (4) | frontend/components |
| DEBT-014 | Legacy store cleanup | S (2) | frontend/stores |
| DEBT-016 | Docker Compose health checks | S (1.5) | docker-compose |

**Key Changes:**
- **DEBT-018**: Move from string replacement to a structured `AgentBuilder`.
- **DEBT-009**: Decouple gateway from Cloudflare Access to support local OIDC (Keycloak).
