# PR-D2: Mission Control UI Doc

This PR adds the Mission Control UI documentation per the MVP roadmap PR sequence PR-D2. Primary artifact: [docs/ui-mission-control.md](docs/ui-mission-control.md:1). It contains annotated Mermaid wireframes and clickable file anchors to the Mission Control code surfaces:
- [MissionControlLayout](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:1)
- [ContractOverlay](services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx:1)
- [ConsolePanel](services/frontend/src/components/mission-control/panels/ConsolePanel.tsx:1)
- [IssuesPanel](services/frontend/src/components/mission-control/panels/IssuesPanel.tsx:1)
- [services.ts](services/frontend/src/services/mission-control/services.ts:1)

Changes
- Add [docs/ui-mission-control.md](docs/ui-mission-control.md:1)
- Add placeholder assets directory [docs/assets/ui/](docs/assets/ui/:1) with [docs/assets/ui/.gitkeep](docs/assets/ui/.gitkeep:1)
- Add this PR description file [docs/pr/PR-D2.md](docs/pr/PR-D2.md:1)

Why
- Satisfies PR-D2 from [docs/mvp-roadmap.md](docs/mvp-roadmap.md:1) “Mission Control UI doc: docs/ui-mission-control.md with annotated wireframes and file anchors.”
- Establishes a shared contract and file anchors to accelerate PR-MC1, PR-MC2, PR-MC3.

Validation
- Mermaid blocks compile in common viewers.
- All anchors resolve to existing files or directories:
  - [MissionControlLayout](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:1)
  - [ContractOverlay](services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx:1)
  - [ConsolePanel](services/frontend/src/components/mission-control/panels/ConsolePanel.tsx:1)
  - [IssuesPanel](services/frontend/src/components/mission-control/panels/IssuesPanel.tsx:1)
  - [services.ts](services/frontend/src/services/mission-control/services.ts:1)
  - [services/frontend/src/components/mission-control/panels/](services/frontend/src/components/mission-control/panels/:1)
  - [services/frontend/src/components/mission-control/overlays/](services/frontend/src/components/mission-control/overlays/:1)
  - [docs/assets/ui/](docs/assets/ui/:1)

Flags surfaced in doc
- CONTRACT_OVERLAY
- CONNECT_WS
- EXPERIMENTS (optional)
- LINEAGE (optional)
- POLICY_GUARDRAILS (optional)

Follow-ups enabled by this doc
- PR-MC1 (Contracts): Mount overlay, quick-fix stubs; references in [docs/ui-mission-control.md](docs/ui-mission-control.md:1)
- PR-MC2 (Recorder/Console): Console + Timeline stub; references in [docs/ui-mission-control.md](docs/ui-mission-control.md:1)
- PR-MC3 (Status bar QoS): Status surfaces; references in [docs/ui-mission-control.md](docs/ui-mission-control.md:1)

Checklist
- [x] Add [docs/ui-mission-control.md](docs/ui-mission-control.md:1) with Mermaid wireframes
- [x] Ensure anchors point to existing files/dirs
- [x] Add [docs/assets/ui/](docs/assets/ui/:1) with [docs/assets/ui/.gitkeep](docs/assets/ui/.gitkeep:1)
- [x] Add PR description [docs/pr/PR-D2.md](docs/pr/PR-D2.md:1)

Reviewer notes
- No frontend code changes in this PR; documentation only.
- Accept if anchors render as clickable links and wireframes are legible.