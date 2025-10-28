# Checklist — Phase 1 (Oct 28, 2025)

- [x] Identify remote UI loading bug (relative `remoteEntry` resolved against frontend origin -> 404)
- [x] Update MissionControl `openRemoteUi` to build relative `remoteEntry` with Gateway base URL
- [x] Add Vite dev proxy for `/agents` -> Orchestrator
- [x] Add Gateway route `/agents/{path}` -> Orchestrator static mount
- [x] Keep feature flag `ALLOW_REMOTE_COGPAK_UI` opt-in (no change)
- [x] Write plan and checklist docs for Phase 1
- [x] Prepare work summary doc

Follow‑ups queued for Phase 2:
- [ ] Remove/retire deprecated UI (FlowBuilder, AgentPalette, PropertyInspector) or replace usage
- [ ] Update docs mentioning deprecated components
- [ ] Unify remote UI loader logic (single helper) and add tests
