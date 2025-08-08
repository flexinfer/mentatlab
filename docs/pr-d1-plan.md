# PR-D1: Docs Convergence Foundation

Objective
- Establish a single, cohesive documentation baseline that reflects the Mission Control–first roadmap.
- Create skeletons for the new canonical docs and stage older milestone docs for archival under references/history.

Scope and Deliverables
- New canonical docs:
  - [overview.md](docs/overview.md)
  - [architecture.md](docs/architecture.md)
  - [mvp-roadmap.md](docs/mvp-roadmap.md) (already created)
- History index (staging area for older docs):
  - [references/history/README.md](docs/references/history/README.md)
- No deletions in PR-D1: we only add new docs and an index that lists files to archive in follow-up.

Files to Archive (to be moved in a follow-up commit/PR)
- [beta_milestone_architecture.md](docs/beta_milestone_architecture.md)
- [webui_rearchitecture_plan.md](docs/webui_rearchitecture_plan.md)
- If present: [phase2_core_features_architecture.md](docs/phase2_core_features_architecture.md), [local-development-guide.md](docs/local-development-guide.md)

Acceptance Criteria
- New docs exist with clear section scaffolds and forward links:
  - overview.md: value prop, personas, feature overview, glossary, links to architecture and roadmap.
  - architecture.md: system diagram (text), components, data flow, events, feature flags, code anchors.
  - mvp-roadmap.md: 90-day plan, phases, KPIs, risks, references to UI files. (done)
- History index lists existing milestone docs with “Lessons applied” bullets.
- All file references use clickable anchors to source files (filenames) where applicable.

Non-Goals
- Editing or removing existing milestone docs.
- Implementing UI or backend changes.

Implementation Plan
1) Create overview.md (skeleton)
   - Sections: Purpose, Who it's for, Differentiators, Core Features, Glossary, Links.
   - Cross-link: [architecture.md](docs/architecture.md), [mvp-roadmap.md](docs/mvp-roadmap.md).
2) Create architecture.md (skeleton)
   - Sections: High-level diagram (text), Frontend, Backend, SDKs, Data model, Tracing, Feature flags.
   - Code anchors (filenames):
     • [MissionControlLayout.tsx](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx)
     • [ContractOverlay.tsx](services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx)
     • [ConsolePanel.tsx](services/frontend/src/components/mission-control/panels/ConsolePanel.tsx)
     • [IssuesPanel.tsx](services/frontend/src/components/mission-control/panels/IssuesPanel.tsx)
     • [services.ts](services/frontend/src/services/mission-control/services.ts)
3) Create references/history/README.md
   - List to-be-archived docs with short “Lessons applied” bullets and links back to overview/architecture.
4) Leave a TODO in this file to migrate files physically in PR-D2 or a small follow-up.

Checklists
- [x] Create [mvp-roadmap.md](docs/mvp-roadmap.md)
- [ ] Create [overview.md](docs/overview.md)
- [ ] Create [architecture.md](docs/architecture.md)
- [ ] Add [references/history/README.md](docs/references/history/README.md)
- [ ] Open PR with title “PR-D1: Docs convergence foundation”

Templates to Use
- overview.md
  - Title: MentatLab Overview
  - Sections:
    • What is MentatLab
    • Who it’s for (personas)
    • Differentiators
    • Core features
    • Glossary
    • Links: [architecture.md](docs/architecture.md), [mvp-roadmap.md](docs/mvp-roadmap.md)
- architecture.md
  - Title: MentatLab Architecture (Mission Control–First)
  - Sections:
    • High-level diagram (text)
    • Frontend (React, Zustand, ReactFlow, Tailwind tokens)
    • Overlays & Panels
      – Contract overlay, Console, Timeline, Status bar
      – Code anchors: [MissionControlLayout.tsx](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx), [ContractOverlay.tsx](services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx), [ConsolePanel.tsx](services/frontend/src/components/mission-control/panels/ConsolePanel.tsx), [IssuesPanel.tsx](services/frontend/src/components/mission-control/panels/IssuesPanel.tsx)
    • Backend surfaces (Gateway, Orchestrator, Observability, Policy/Cost)
    • Data flow: runs, checkpoints, spans, lineage ids
    • Feature flags
    • References: [mvp-roadmap.md](docs/mvp-roadmap.md)
- references/history/README.md
  - Title: Archived Milestones (Index)
  - Sections:
    • Files
    • Lessons applied
    • Where to go next

Cross-References
- UI files to anchor:
  - [FlowCanvas.tsx](services/frontend/src/components/FlowCanvas.tsx)
  - [index.css](services/frontend/src/index.css)
  - [features.ts](services/frontend/src/config/features.ts)
- Services:
  - [services.ts](services/frontend/src/services/mission-control/services.ts)
- Types and store:
  - [types/index.ts](services/frontend/src/types/index.ts)
  - [store/index.ts](services/frontend/src/store/index.ts)

Timeline
- Day 0–1: Draft skeletons (overview, architecture, history index).
- Day 2: Fill in 1-pagers of each section; keep concise; link to code.
- Day 3: Open PR-D1; request review.

Post-PR-D1 Follow-ups
- PR-D2: docs/ui-mission-control.md with annotated overlays/panels
- PR-D3: docs/policy-and-safety.md, docs/observability.md, docs/experimentation.md
- PR-D4: docs/developer-guide.md (flags, local run, testing, PR templates)

Notes
- This plan aligns with [mvp-roadmap.md](docs/mvp-roadmap.md) and de-scopes heavy media features for now.
- Research enrichment via Tavily will be added when access stabilizes (citations in history index).

Status
- In progress