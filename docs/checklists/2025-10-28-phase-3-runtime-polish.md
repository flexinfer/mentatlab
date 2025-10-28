# Checklist — Phase 3 (Oct 28, 2025)

- [x] Add unit tests for `utils/remoteUi.ts` (URL resolution, event dispatch)
- [ ] Add unit tests for StatusBar heartbeat/refresh behavior
- [x] Show inline hint when `ALLOW_REMOTE_COGPAK_UI` is false (CogPaks list)
- [ ] Sweep docs/ for FlowBuilder/AgentPalette references and update
- [ ] Build + run unit tests

Runtime fixes applied 2025-10-28:

- [x] Default `ALLOW_REMOTE_COGPAK_UI` to on in dev so the “UI” buttons work out of the box.
- [x] Dev server proxies: route `/api`, `/ws`, `/streaming` to Gateway; keep `/agents/*` to Orchestrator.
- [x] Gateway URL heuristics: when served from Vite (:5173), use `http://localhost:8080` instead of `window.origin` to avoid stuck “Connecting…”.
- [x] Stream → Graph: map common stream frames (`text:stream`, `progress`, `stream:status`, and `kind` router) into flight recorder checkpoints (`node:exec`, `edge:transmit`, `tool:call`) so the Network panel lights up.
- [x] Fix ws(s) computation: derive `ws://` vs `wss://` from the resolved Gateway URL to avoid mixed-content blocks under HTTPS.
- [x] Frontend production URL heuristic: prefer window.origin when build-time gateway is cluster-internal (gateway/orchestrator/.svc/RFC1918).
