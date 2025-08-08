# MentatLab MVP Roadmap: Mission Control–First Agent Lab

This document is the single source of truth for the next 90 days.

North Star and Differentiators
1) Contract‑aware canvas (type-aware pins) with quick‑fix adapters
2) Flight recorder + timeline replay (checkpoints, console, traces)
3) Lineage/provenance at pin level with reproducible runs
4) Experimentation: A/B & canary at flow level with KPI compare
5) Policy guardrails (ingress/egress) with “explain why” remediation
6) Cost/latency observability and budget guardrails (QoS overlays)
7) Collaboration: presence, comments, role-aware editing

Target Architecture (Concise)
- Frontend: Mission Control shell (canvas + right dock + bottom dock),
  contract overlay, timeline, QoS status bar, lineage overlay, experiments tab.
- Backend: Gateway (auth, policy ingress, streaming), Orchestrator (DAG planner,
  run coordinator, variant strategies), Observability (OTel traces/metrics/logs,
  KPIs), Lineage store keyed by provenance refs, Policy & Cost engines.
- SDKs: Hooks for checkpoints, provenance tags, trace propagation, policy hints.

Phased Plan (90 Days)

Phase 1 (Weeks 1–4): Mission Control core + Contracts
- MC-01 Contract Overlay + Quick Fix stubs
  • Mount overlay behind CONTRACT_OVERLAY flag in layout; render node/edge
    contract states; badge issue counts; CTA for fixes.
- MC-02 Flight Recorder v1 + Console
  • In‑memory recorder service; Bottom Dock Console; Timeline stub with scrubber.
- MC-03 QoS Status Bar
  • WS health + feature flags + p95 latency aggregates with R/Y/G thresholds.

Phase 2 (Weeks 5–8): Lineage + A/B + Policy
- LN-01 Provenance/Lineage v1
  • Outputs emit provenance ids; lineage overlay for selected pins.
- AB-01 Variants & KPI Compare
  • Fixed split / time-sliced strategies; experiments panel with KPI compare.
- PL-01 Policy Guardrails
  • Ingress/egress safety nodes; policy badges; “Why blocked?” explainers.

Phase 3 (Weeks 9–12): Observability & Cost
- OBS-01 Trace correlation (OTel-lite)
  • Correlate spans with checkpoints via flow/run/node ids; open trace slice.
- COST-01 Pre‑flight envelopes & budgets
  • Node/edge projections; canvas budget guardrails; post‑run accounting.

Acceptance Criteria (Phase 1)
- Editing an incompatible edge immediately shows a red contract hint;
  hovering explains mismatch and suggests one quick‑fix.
- Clicking “Apply fix” inserts an adapter (or rewires edge) and clears the warning.
- Runs produce checkpoints; Timeline shows them; selecting a checkpoint scrolls Console.
- Status bar shows WS Connected and QoS green when p95 < threshold.

Initial PR Sequence (Docs + Product)
- PR-D1 Docs convergence foundation:
  • Create docs/overview.md, docs/architecture.md, docs/mvp-roadmap.md.
  • Move milestone specs to docs/references/history/ (no deletions yet).
- PR-D2 Mission Control UI doc:
  • docs/ui-mission-control.md with annotated wireframes and file anchors.
- PR-D3 Policy/Observability/Experimentation docs.
- PR-D4 Developer guide (flags, local run, testing, PR templates).
- PR-MC1 Contracts:
  • Mount ContractOverlay; extend FlowLinterService to return Fix descriptors;
    IssuesPanel count badge in layout.
- PR-MC2 Recorder/Console:
  • Wire ConsolePanel; Timeline stub; listRuns/listCheckpoints service.
- PR-MC3 Status bar QoS:
  • Status bar component + perf stats + flags.

Feature Flags
- CONTRACT_OVERLAY: enables contract overlay and quick‑fix CTAs.
- CONNECT_WS: governs WS connection surfaces.
- (Optional) EXPERIMENTS, LINEAGE, POLICY_GUARDRAILS: staged rollout.

De‑scoped Now (Flagged Optional)
- Heavy multimodal viewer/processing, advanced upload/CDN; retain placeholders behind flags.

KPIs / Success Metrics
- Diagnose failed run time reduced by ≥50% via contract hints + replay.
- ≥80% of tool calls produce checkpoints/spans correlated on timeline.
- Canvas render with overlays ≤16ms/frame on medium graphs.
- Budget guardrails warn before run and block when policy requires.

Risks & Mitigations
- Network/unreliable WS → polling fallback for recorder; console buffer caps.
- Validation false-positives → quick “dismiss/override” path + feedback capture.
- Overlay performance → virtualized decorations, debounced re-validate.

Market Context (short)
- Industry studio tools emphasize orchestration, observability, and experiment mgmt.
- MentatLab differentiates with stronger contract overlays, flight recorder timeline,
  pin‑level lineage, and integrated policy + budget guardrails in a canvas‑first UX.

References (code anchors)
- Mission Control layout: [MissionControlLayout](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:1)
- Contract overlay: [ContractOverlay](services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx:1)
- Console panel: [ConsolePanel](services/frontend/src/components/mission-control/panels/ConsolePanel.tsx:1)
- Issues panel: [IssuesPanel](services/frontend/src/components/mission-control/panels/IssuesPanel.tsx:1)
- Linter service: [services.ts](services/frontend/src/services/mission-control/services.ts:1)

Next Steps (immediate)
- Open PR-D1 with this roadmap and create docs/overview.md and docs/architecture.md skeletons.
- In parallel, open PR-MC1 to mount ContractOverlay and wire quick‑fix stubs.