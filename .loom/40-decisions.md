# Decisions

Record decisions as they are made, with date, rationale, and sources.

## 2026-02-20: Functional-first UX stabilization before visual redesign

- Decision: Prioritize connection reliability and status consistency in Mission Control before broader visual polish.
- Rationale: Current UX issues are primarily behavioral (duplicate banners, fragmented connection ownership, inconsistent endpoints). Visual cleanup without fixing runtime behavior would keep operator trust low.
- Alternatives considered:
  - Visual redesign first: Rejected because it does not address connection/state failure modes.
  - Full frontend rewrite: Rejected as high risk with unnecessary scope expansion.
- Consequences:
  - M16 starts with transport unification and status normalization.
  - Styling/token cleanup is gated behind functional acceptance criteria.
- Sources:
  - [S1] `services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:250`
  - [S2] `services/frontend/src/components/mission-control/layout/TopBar.tsx:107`
  - [S3] `services/frontend/src/components/ui/ConnectionStatusBanner.tsx:36`
  - [S4] `services/frontend/src/components/StreamingCanvas.tsx:42`
  - [S5] `services/frontend/src/components/mission-control/layout/WorkspaceProvider.tsx:203`

## 2026-02-20: Standardize on a single frontend connection authority

- Decision: Consolidate live connection control through one transport authority (target: `useStreamingTransport`/connection-manager path) and remove duplicate ad-hoc connect logic.
- Rationale: Mission Control currently has multiple independent connection entry points (`WorkspaceProvider`, `NetworkPanel`, `StreamingCanvas`) that can diverge in behavior and status reporting.
- Alternatives considered:
  - Keep multiple connect paths with shared helpers: Rejected because ownership remains ambiguous.
  - Keep legacy `/streaming` and Mission Control connection stacks in parallel: Rejected due maintenance/behavior drift.
- Consequences:
  - `startLiveConnection` and panel-level connect actions must delegate to one shared transport path.
  - URL default handling will be centralized around orchestrator/gateway config helpers.
  - Legacy `localhost:8000` defaults in active paths should be removed.
- Sources:
  - [S1] `services/frontend/src/components/mission-control/layout/WorkspaceProvider.tsx:203`
  - [S2] `services/frontend/src/components/mission-control/panels/NetworkPanel.tsx:609`
  - [S3] `services/frontend/src/components/StreamingCanvas.tsx:89`
  - [S4] `services/frontend/src/services/api/apiService.ts:113`
  - [S5] `services/frontend/src/hooks/useStreamingTransport.ts:106`

## 2026-02-14: Adopt Go-first backend strategy

- Decision: Use Go services (gateway-go, orchestrator-go) as the sole production backend. Deprecate Python gateway and orchestrator.
- Rationale: Go services already have the more complete implementation (scheduler with foreach/conditional/expressions, proper middleware, passing tests). Python services are well-written but represent unmaintained legacy code. K8s manifests already reference Go images. Maintaining both stacks doubles the surface area for bugs and confusion.
- Alternatives considered:
  - Python-first: Rejected because Python services are already superseded and K8s deploys Go
  - Hybrid (formalize current state): Rejected because it perpetuates confusion and doubles maintenance
- Consequences:
  - Must fix CI/CD to build Go Dockerfiles (currently builds Python with Go names)
  - Must update docker-compose to use Go services
  - Python agents are unaffected (they use stdin/stdout contract, backend-agnostic)
  - Python services should be archived, not deleted (reference value)
- Sources:
  - [S1] `.loom/10-research.md` - Assessment findings
  - [S2] `k8s/gateway.yaml:44` - K8s expects Go image
  - [S3] `k8s/orchestrator.yaml:45` - K8s expects Go image
  - [S4] `.gitlab-ci.yml:158-211` - CI builds Python with Go names

## 2026-02-14: Replace aspirational milestone specs with evidence-based roadmap

- Decision: Archive v1.0/v1.1/v2.0 milestone specs to `docs/archive/`. Replace ROADMAP.md with implementation plan grounded in actual code capabilities.
- Rationale: Current milestone specs describe features (WASM runtime, PKI, Agent Marketplace, cost metering) that have zero implementation. They create a false sense of progress and make it impossible to plan realistic work. The 10 completed enhancements in ENHANCEMENTS_SUMMARY.md are the only verified deliverables.
- Alternatives considered:
  - Keep milestone specs as aspirational targets: Rejected because they actively mislead about project state
  - Rewrite milestone specs to match reality: Rejected because they'd need to be completely rewritten; better to start fresh
- Consequences:
  - ROADMAP.md will reflect the M0-M4 implementation plan
  - Aspirational features (WASM, marketplace, cost metering) can be re-proposed once the foundation works
  - GitLab issues #2-#12 (from reconciliation) should be re-evaluated against new roadmap
- Sources:
  - [S1] `docs/v1.0_milestone_spec.md` - WASM/PKI spec with zero code
  - [S2] `docs/v1.1_milestone_spec.md` - Marketplace spec with zero code
  - [S3] `docs/v2.0_milestone_spec.md` - Observability spec with zero code
  - [S4] `ENHANCEMENTS_SUMMARY.md` - Verified completed features
  - [S5] `ROADMAP.md` - Claims v1.0 complete (inaccurate)

## 2026-02-14: Keep Python agents, archive Python services

- Decision: Python agent implementations (echo, psyche-sim, ctm-cogpack) remain in the main codebase. Python gateway and orchestrator move to archive.
- Rationale: Agents communicate via stdin/stdout NDJSON contract, making them backend-agnostic. The Go orchestrator launches agents as subprocesses or K8s Jobs regardless of agent language. The common emit library (`agents/common/emit.py`) is shared infrastructure for Python agents.
- Alternatives considered:
  - Remove all Python code: Rejected because agents are functional and language-independent
  - Keep Python services as "reference implementation": Rejected because it suggests they're maintained when they're not
- Consequences:
  - `agents/` directory stays in main codebase
  - `services/gateway/` and `services/orchestrator/` move to `archive/` or `legacy/` branch
  - `pyproject.toml` and `pytest.ini` updated to remove service test paths
  - Agent tests remain in CI
- Sources:
  - [S1] `agents/common/emit.py` - Backend-agnostic NDJSON protocol
  - [S2] `agents/echo/main.py` - Working reference agent
  - [S3] `agents/psyche-sim/src/main.py` - Sophisticated streaming agent
