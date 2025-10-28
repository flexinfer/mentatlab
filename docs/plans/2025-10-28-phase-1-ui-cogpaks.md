# Phase 1 — UI + CogPak Integration Stabilization (Oct 28, 2025)

Objective
- Fix remote CogPak UI loading and ensure local agent UIs (remoteEntry.js) work across dev/preview/prod.
- Keep streaming and mission control wiring intact.
- Avoid broad UI refactors; defer removal of large deprecated areas to Phase 2.

Scope
- Frontend: MissionControl remote UI loader; Vite dev proxy; feature flags unchanged.
- Gateway: Add `/agents/*` static proxy to Orchestrator.
- Orchestrator: No changes required for static mounting (already mounts `/agents`).

Changes Planned
- Frontend: build remote UI URLs against Gateway base when `remoteEntry` is relative.
- Frontend: proxy `/agents` to Orchestrator in Vite dev server.
- Gateway: expose `/agents/*` that proxies to Orchestrator StaticFiles mount.
- Docs: capture plan and checklist; follow-up documentation of work.

Out of Scope
- Removing deprecated components (FlowBuilder, AgentPalette, legacy inspector) — move to Phase 2.
- Visual polish and broader store/worker toggles.

Validation
- In dev: `npm run dev` for frontend, `uvicorn` gateway/orchestrator. Open CogPaks list; clicking UI should load remoteEntry.js and render.
- In preview/prod: Frontend origin calls Gateway `/agents/...` which proxies to Orchestrator.

