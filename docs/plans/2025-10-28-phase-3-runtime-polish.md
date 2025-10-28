# Phase 3 — Runtime Polish (SSE, Remote UI, Docs) — Oct 28, 2025

Objective
- Harden streaming/SSE resume behavior and UI telemetry.
- Add unit coverage for remote UI helper and selection bridging.
- Clean lingering docs that reference removed UI.

Scope
- Frontend: tests for `utils/remoteUi.ts` and `openCogpak` dispatch; StatusBar polling/heartbeat coverage.
- Docs: replace remaining references to FlowBuilder/AgentPalette in docs/*.
- Minor UX: add inline hint when remote UI flag is disabled.

Validation
- `npm run build` and `npm test` pass locally.
- Manual check: disable `VITE_FF_ALLOW_REMOTE_COGPAK_UI` shows hint and blocks UI button.
