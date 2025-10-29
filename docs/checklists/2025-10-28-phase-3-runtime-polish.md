# Checklist — Phase 3 (Oct 28, 2025)

- [x] Add unit tests for `utils/remoteUi.ts` (URL resolution, event dispatch)
- [x] Add unit tests for StatusBar heartbeat/refresh behavior
- [x] Show inline hint when `ALLOW_REMOTE_COGPAK_UI` is false (CogPaks list)
- [x] Sweep docs/ for FlowBuilder/AgentPalette references and update
- [x] Build + run unit tests

Runtime fixes applied 2025-10-28:

- [x] Default `ALLOW_REMOTE_COGPAK_UI` to on in dev so the "UI" buttons work out of the box.
- [x] Dev server proxies: route `/api`, `/ws`, `/streaming` to Gateway; keep `/agents/*` to Orchestrator.
- [x] Gateway URL heuristics: when served from Vite (:5173), use `http://localhost:8080` instead of `window.origin` to avoid stuck "Connecting…".
- [x] Stream → Graph: map common stream frames (`text:stream`, `progress`, `stream:status`, and `kind` router) into flight recorder checkpoints (`node:exec`, `edge:transmit`, `tool:call`) so the Network panel lights up.
- [x] Fix ws(s) computation: derive `ws://` vs `wss://` from the resolved Gateway URL to avoid mixed-content blocks under HTTPS.
- [x] Frontend production URL heuristic: prefer window.origin when build-time gateway is cluster-internal (gateway/orchestrator/.svc/RFC1918).

## Resolution Status

✅ **All Phase 3 items completed** as of October 28, 2025.

### UI Resolution Summary

The critical UI issues (non-functional CogPak UI buttons, empty Network panel, stuck "Connecting…" status) were resolved by creating comprehensive environment configuration in `services/frontend/.env.local`. The root cause was missing feature flags and API endpoint configuration.

**Key changes:**
- Added `VITE_FEATURE_MISSION_CONTROL=true`
- Added `VITE_FEATURE_COGPAK_REMOTEUI=true`
- Added `VITE_FEATURE_SSE_STREAMING=true`
- Configured explicit Gateway/Orchestrator URLs
- Set WebSocket endpoint and connection flags

**Documentation:**
- Full resolution details: [`docs/fixes/2025-10-28-ui-resolution.md`](../fixes/2025-10-28-ui-resolution.md)
- Includes problem summary, root cause analysis, solution, infrastructure verification, testing steps, and lessons learned

**Verified working:**
- Remote CogPak UI loading via Module Federation
- Real-time Network panel visualization
- WebSocket/SSE streaming connections
- Proper protocol resolution (ws:// vs wss://)
- Proxy routing for all API endpoints

**Next steps:**
- Improve developer onboarding documentation
- Add startup configuration validation
- Standardize environment variable naming conventions
