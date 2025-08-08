# MentatLab Overview

Purpose
MentatLab is a Mission Control–first AI agent lab. It provides a canvas‑centric UX to design, validate, observe, and iterate on agentic workflows with contract‑aware correctness, a flight recorder timeline for replay, and built‑in policy, experimentation, lineage, and cost/latency overlays.

Who It’s For
- Research engineers: Rapidly prototype and compare agent strategies with reproducible runs.
- Platform teams: Standardize contracts, guardrails, and observability across AI use cases.
- Application teams: Ship reliable, cost‑aware AI features with workflow‑level safety and KPIs.

Differentiators
- Contract‑aware canvas with quick‑fix adapters for mis‑typed pins and edges.
- Flight recorder with checkpoints, console, and timeline replay for debugging.
- Pin‑level provenance/lineage to trace artifacts and reproduce outputs.
- Built‑in A/B and canary flows with KPI overlays and basic statistical guardrails.
- Policy guardrails (ingress/egress) with “explain why blocked” and remediation paths.
- Cost/latency overlays and QoS status bar for operator‑grade visibility.
- Collaboration foundations: presence, comments, and role‑aware editing.

Core Features (Phase 1 focus)
1) Contracts and Quick Fixes
   - Type‑aware validation of node pins and edges.
   - Overlay hints and one‑click fixes (adapter insertion/rewire).
2) Flight Recorder + Console
   - Checkpoints emitted during runs, correlated to a console and a timeline scrubber.
3) QoS Status Bar
   - WebSocket connectivity, feature flags, and p95 latency thresholds with R/Y/G states.

Roadmap Summary
- Phase 1 (Weeks 1–4): Contracts, Flight Recorder v1, QoS bar.
- Phase 2 (Weeks 5–8): Lineage v1, Variants/KPI compare, Policy guardrails.
- Phase 3 (Weeks 9–12): Trace correlation (OTel‑lite) and cost/budget guardrails.

Glossary
- Contract: A type/shape expectation for data at a pin or edge.
- Quick‑fix: A suggested automatic change (e.g., adapter insertion) to resolve a contract violation.
- Checkpoint: A recorded run state or artifact at a point in time.
- Lineage/Provenance: References that allow tracing how an artifact was produced.
- KPI: Key performance indicator, e.g., quality score, latency, cost.
- QoS: Quality of Service; operational health metrics such as p95 latency and WS status.

Links
- Architecture: [architecture.md](docs/architecture.md)
- MVP Roadmap: [mvp-roadmap.md](docs/mvp-roadmap.md)

Code Anchors (UI references)
- Mission Control layout: [MissionControlLayout](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:1)
- Contract overlay: [ContractOverlay](services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx:1)
- Console panel: [ConsolePanel](services/frontend/src/components/mission-control/panels/ConsolePanel.tsx:1)
- Issues panel: [IssuesPanel](services/frontend/src/components/mission-control/panels/IssuesPanel.tsx:1)
- Linter service: [services.ts](services/frontend/src/services/mission-control/services.ts:1)

Notes
- Heavy multimodal upload/viewing is de‑scoped initially and gated behind feature flags.
- This overview is intentionally concise; see the architecture for system details and the roadmap for acceptance criteria and KPIs.