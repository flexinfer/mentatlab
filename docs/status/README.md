# MentatLab Status System for Agents

Purpose
- Provide a single machine-readable source of truth so autonomous agents can:
  - infer current phase and feature statuses
  - resolve doc sections to concrete code anchors
  - locate acceptance criteria, KPIs, and risks

Files
- [`docs/status/project-status.yaml`](docs/status/project-status.yaml:1) — status instance (with x-spec header)
- [`docs/status/anchors.json`](docs/status/anchors.json:1) — normalized anchor index (doc ↔ code)

Consumption contract (how agents should read these files)
- Parse [`docs/status/project-status.yaml`](docs/status/project-status.yaml:1):
  - meta: provenance for updates (version, generatedAt, sourceDocs)
  - phases: timeline and coarse status
  - features[*]: authoritative list keyed by IDs (MC-01...); each feature contains anchors that resolve via anchors.json
  - flags: current feature-flag snapshot to guide agent decision logic
  - surfaces: doc-section → anchor keys mapping for deep-linking
  - kpis, risks: signals for runtime checks and planning
- Resolve anchors via [`docs/status/anchors.json`](docs/status/anchors.json:1):
  - Lookup a feature.anchors key (e.g., "frontend.overlay.contracts")
  - Each anchors.json entry includes:
    - doc: human-readable section link (e.g., docs/architecture.md#console-panel)
    - code: clickable reference in the form [`filename or language.declaration()`](relative/path.ext:line)
- Trust precedence (for agents):
  1. [`docs/status/project-status.yaml`](docs/status/project-status.yaml:1) is authoritative for automation decisions
  2. [`docs/status/anchors.json`](docs/status/anchors.json:1) is authoritative for resolving doc → code links
  3. Human-readable docs (docs/*.md) provide context; discrepancies should be opened as an issue

Update cadence & ownership
- Human-updated after each merged PR that touches roadmap-critical areas; minimum weekly.
- generatedAt must be updated on each change.
- Owners for features are recorded in each feature entry (feature.owners).

Change process
- Small edits: update status + anchors in same PR as code/doc changes.
- Larger shifts: open a "status proposal" PR with acceptance checklist and link to impacted features.
- CI: Add a linter that verifies:
  - All feature.anchors entries exist in [`docs/status/anchors.json`](docs/status/anchors.json:1).
  - All anchors marked exists: true actually exist (optional heuristic).
  - No malformed clickable references.

Consumption examples (pseudocode)
- Resolve feature anchors:
  - feature = project_status.features.find(f => f.id === 'MC-01')
  - anchors = feature.anchors.map(k => anchorsIndex[k])
- Surface status to UI:
  - Show flags snapshot from project_status.flags
  - Link UI badges to anchor.code (clickable) for quick jump to code

Notes
- The spec is intentionally minimal to keep parsing simple. Additions may be made under x-spec / _schema with backward compatibility in mind.
- Agents should treat project-status.yaml as an agreed coordination contract; human review is required before automated enforcement.