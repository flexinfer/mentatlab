# MentatLab Docs Index

Canonical Docs (source of truth)
- Overview: [overview.md](docs/overview.md:1)
- Architecture: [architecture.md](docs/architecture.md:1)
- MVP Roadmap: [mvp-roadmap.md](docs/mvp-roadmap.md:1)

Planning
- PR-D1 Plan: [pr-d1-plan.md](docs/pr-d1-plan.md:1)

History and Archived Materials
- History Index: [references/history/README.md](docs/references/history/README.md:1)
- Archived (tagged at top of file):
  - [beta_milestone_architecture.md](docs/beta_milestone_architecture.md:1)
  - [webui_rearchitecture_plan.md](docs/webui_rearchitecture_plan.md:1)

Authoring Guidelines
- Keep canonical docs current: update [overview.md](docs/overview.md:1), [architecture.md](docs/architecture.md:1), and [mvp-roadmap.md](docs/mvp-roadmap.md:1) as features land.
- For legacy/obsolete docs, either:
  1) Move into [references/history/](docs/references/history/README.md:1), or
  2) Add an ARCHIVED banner at the top with links back to this index and the canonical docs (as done for the files above).
- When linking to code, use clickable anchors to filenames with line numbers where appropriate:
  - Mission Control layout: [MissionControlLayout.tsx](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:1)
  - Contract overlay: [ContractOverlay.tsx](services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx:1)
  - Console panel: [ConsolePanel.tsx](services/frontend/src/components/mission-control/panels/ConsolePanel.tsx:1)
  - Issues panel: [IssuesPanel.tsx](services/frontend/src/components/mission-control/panels/IssuesPanel.tsx:1)
  - Linter services: [services.ts](services/frontend/src/services/mission-control/services.ts:1)

Status
- Directory cleaned: canonical docs established; historical docs tagged as ARCHIVED; central index present.