# Archived Milestones (Index)

Purpose
- Provide a historical index of earlier planning documents and capture “Lessons applied” that informed the current Mission Control–first roadmap and architecture.
- These files remain for context; the canonical sources are now [overview.md](docs/overview.md), [architecture.md](docs/architecture.md), and [mvp-roadmap.md](docs/mvp-roadmap.md).

How To Use
- Skim the Lessons applied under each historical doc.
- If deeper background is needed, open the original file, then return to the canonical docs above for up-to-date guidance.

Historical Documents

1) beta_milestone_architecture.md
- File: [beta_milestone_architecture.md](docs/beta_milestone_architecture.md)
- Lessons applied:
  - Consolidate UI around a canvas-first “Mission Control” with right/bottom docks (inspector, console, timeline).
  - Elevate contract/type awareness to first-class overlays rather than ad-hoc validations.
  - Treat Flight Recorder (runs, checkpoints, console) as a product surface, not just logs.
  - Establish feature flags early to enable staged rollout of overlays/panels.

2) webui_rearchitecture_plan.md
- File: [webui_rearchitecture_plan.md](docs/webui_rearchitecture_plan.md)
- Lessons applied:
  - Normalize on Tailwind theme tokens and consistent dark/light theming in [index.css](services/frontend/src/index.css:1).
  - Centralize state via Zustand and keep canvas decorations virtualized for performance.
  - Define a predictable component layout: canvas, overlays, panels, and a QoS status bar.
  - Introduce a linter services layer to host rules/quick-fixes decoupled from components (see [services.ts](services/frontend/src/services/mission-control/services.ts:1)).

Context Kept Out of MVP Scope (Now Flag-Gated)
- Heavy multimodal upload/CDN flows and advanced media viewers.
- Rationale: focus on core differentiators (contracts, recorder/timeline, lineage, policy, QoS/cost) for MVP; keep media behind feature flags for later.

Canonical Documents (Current Source of Truth)
- Overview: [overview.md](docs/overview.md)
- Architecture: [architecture.md](docs/architecture.md)
- MVP Roadmap: [mvp-roadmap.md](docs/mvp-roadmap.md)

Next Steps for Archival
- In a subsequent small PR, physically move earlier milestone docs into this references/history/ folder (leaving this index intact).
- Keep links updated if filenames or paths change.

Code Anchors (for quick navigation)
- Mission Control layout: [MissionControlLayout.tsx](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:1)
- Contract overlay: [ContractOverlay.tsx](services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx:1)
- Console panel: [ConsolePanel.tsx](services/frontend/src/components/mission-control/panels/ConsolePanel.tsx:1)
- Issues panel: [IssuesPanel.tsx](services/frontend/src/components/mission-control/panels/IssuesPanel.tsx:1)
- Linter services: [services.ts](services/frontend/src/services/mission-control/services.ts:1)