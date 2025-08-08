# MentatLab Overview

MentatLab is a canvas-first experimentation and orchestration environment for composing agent-driven flows, observing runs, and iterating quickly. The repository organizes the user-facing Mission Control experience, backend orchestrator, agent (Cog‑Pak) SDKs, and CI hooks.

Key docs:
- Roadmap: [`docs/mvp-roadmap.md`](docs/mvp-roadmap.md:1)
- Architecture: [`docs/architecture.md`](docs/architecture.md:1)
- Flows: [`docs/flows.md`](docs/flows.md:1)
- Agents: [`docs/agents.md`](docs/agents.md:1)
- Orchestrator: [`docs/orchestrator_design.md`](docs/orchestrator_design.md:1)
- Status (machine-readable): [`docs/status/project-status.yaml`](docs/status/project-status.yaml:1) and [`docs/status/anchors.json`](docs/status/anchors.json:1)

Next steps (project structure & agent consumption)
- Keep [`docs/status/project-status.yaml`](docs/status/project-status.yaml:1) updated after any roadmap-affecting PRs (weekly minimum).
- Keep [`docs/status/anchors.json`](docs/status/anchors.json:1) in sync when moving/renaming code or doc anchors.
- CI: Add a linter that verifies feature anchors resolve to keys in [`docs/status/anchors.json`](docs/status/anchors.json:1).
- Doc edits proposed (ready-to-commit): updates to [`docs/architecture.md`](docs/architecture.md:1), [`docs/flows.md`](docs/flows.md:1), [`docs/agents.md`](docs/agents.md:1), and [`docs/orchestrator_design.md`](docs/orchestrator_design.md:1). These are described in the change plan in [`docs/status/README.md`](docs/status/README.md:1).

How agents should use the repo
- Read [`docs/status/project-status.yaml`](docs/status/project-status.yaml:1) first for authoritative machine state.
- Resolve anchors via [`docs/status/anchors.json`](docs/status/anchors.json:1) to find code or doc locations.
- If discrepancies are detected between status, anchors, and docs, open an issue linking the three files.