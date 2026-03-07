# M16 Issue Checklist (PR-Sized)

Execution checklist for Mission Control functional UX standardization.

## How To Use

- One issue = one PR.
- Keep each PR independently testable and releasable.
- Do not combine connection-logic refactors with visual-theme refactors in the same PR.

## GitLab Mapping (2026-02-20)

- `M16.1` -> `#42` `Roadmap: M16.1 Unify live connection ownership`
- `M16.2` -> `#43` `Roadmap: M16.2 Canonicalize connection status surface`
- `M16.3` -> `#44` `Roadmap: M16.3 Refactor StreamingCanvas to shared transport`
- `M16.4` -> `#45` `Roadmap: M16.4 Normalize frontend URL defaults`
- `M16.5` -> `#46` `Roadmap: M16.5 Resolve legacy /streaming route strategy`
- `M16.6` -> `#47` `Roadmap: M16.6 Standardize visual tokens and panel chrome`
- `M16.7` -> `#48` `Roadmap: M16.7 Add connection UX regression tests`
- `M16.8` -> `#49` `Roadmap: M16.8 Capture visual QA snapshot baseline`

---

## Issue 1: Establish Single Connection Authority

- Title: `M16.1: Unify live connection ownership in Mission Control`
- Goal: Route all connect/disconnect actions through one authority (`useStreamingTransport` path).
- Files in scope:
  - `services/frontend/src/hooks/useStreamingTransport.ts`
  - `services/frontend/src/components/mission-control/layout/WorkspaceProvider.tsx`
  - `services/frontend/src/components/mission-control/panels/NetworkPanel.tsx`
  - `services/frontend/src/components/mission-control/layout/TopBar.tsx`
  - `services/frontend/src/components/mission-control/layout/BottomDock.tsx`
- Tasks:
  - [ ] Expose a single connect/disconnect API via `WorkspaceProvider` context.
  - [ ] Replace dynamic-import `streamingService.connect()` calls in `WorkspaceProvider` and `NetworkPanel`.
  - [ ] Ensure top bar and dock buttons call same context action.
- Acceptance:
  - [ ] Only one connect path remains in code.
  - [ ] Manual connect from top bar and network panel yields identical status transitions.
  - [ ] `npm run lint` passes in `services/frontend`.

## Issue 2: Remove Duplicate Connection Status Surfaces

- Title: `M16.2: Canonicalize connection status banner`
- Goal: One status surface with deterministic retry behavior.
- Files in scope:
  - `services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx`
  - `services/frontend/src/components/mission-control/layout/TopBar.tsx`
  - `services/frontend/src/components/ui/ConnectionStatusBanner.tsx`
- Tasks:
  - [ ] Remove duplicate banner mount(s).
  - [ ] Keep one canonical placement.
  - [ ] Ensure retry action always triggers unified connection authority.
- Acceptance:
  - [ ] No overlapping banners in error state.
  - [ ] Exactly one retry control visible at a time.
  - [ ] Existing layout tests still pass.

## Issue 3: Refactor StreamingCanvas to Shared Transport State

- Title: `M16.3: Stop raw socket ownership inside StreamingCanvas`
- Goal: `StreamingCanvas` renders shared state, not its own transport lifecycle.
- Files in scope:
  - `services/frontend/src/components/StreamingCanvas.tsx`
  - `services/frontend/src/stores/streaming/*`
  - `services/frontend/src/hooks/useStreamingTransport.ts`
- Tasks:
  - [x] Remove direct `/api/v1/streams` polling loop from canvas.
  - [x] Remove direct `new WebSocket(...)` lifecycle in canvas.
  - [x] Subscribe canvas to store/session data populated by connection authority.
- Acceptance:
  - [x] Canvas still renders active stream visuals.
  - [x] No duplicate websocket clients created by canvas.
  - [x] `npm test -- --run --reporter=dot` passes in `services/frontend`.

## Issue 4: Normalize URL Defaults and Kill `localhost:8000` Drift

- Title: `M16.4: Align frontend runtime defaults with gateway/orchestrator`
- Goal: Remove active-path defaults that target old ports/services.
- Files in scope:
  - `services/frontend/src/services/api/apiService.ts`
  - `services/frontend/src/config/orchestrator.ts`
  - `services/frontend/src/services/api/streamingService.ts`
  - `services/frontend/src/services/streaming/orchestratorSSE.ts`
  - `services/frontend/src/services/api/websocketClient.ts`
- Tasks:
  - [x] Replace `localhost:8000` defaults in active code paths.
  - [x] Centralize base URL derivation through config helpers.
  - [x] Keep dev fallback behavior explicit and documented.
- Acceptance:
  - [x] Search check has no active-path `localhost:8000` defaults.
  - [x] Local dev works with gateway `8080` and orchestrator `7070`.
  - [x] Add/update unit tests for URL resolver behavior.

## Issue 5: Resolve Legacy `/streaming` Route Strategy

- Title: `M16.5: Deprecate or gate legacy streaming route`
- Goal: Prevent split-primary UX behavior.
- Files in scope:
  - `services/frontend/src/App.tsx`
  - `services/frontend/src/components/StreamingPage.tsx`
  - `services/frontend/src/components/StreamingPage.new.tsx`
  - `services/frontend/src/config/features.ts`
- Tasks:
  - [x] Decide: remove route or gate behind feature flag.
  - [x] If gated, add clear non-primary labeling.
  - [x] Update routing tests accordingly.
- Acceptance:
  - [x] Primary path is unambiguous (`/` Mission Control).
  - [x] No accidental navigation to legacy path in normal flow.

## Issue 6: Visual Token and Panel Chrome Standardization

- Title: `M16.6: Professionalize core visual primitives`
- Goal: Improve legibility and consistency without feature churn.
- Files in scope:
  - `services/frontend/src/index.css`
  - `services/frontend/tailwind.config.js`
  - `services/frontend/src/components/mission-control/layout/*`
  - `services/frontend/src/components/mission-control/panels/*`
- Tasks:
  - [ ] Reduce neon/glow defaults in dark mode token set.
  - [ ] Standardize spacing/border/radius/shadow across main shells.
  - [ ] Define typography rule: sans for UI, mono for telemetry-only.
- Acceptance:
  - [ ] Visual diff shows consistent panel chrome.
  - [ ] Dense views (canvas + inspector + dock) remain legible.
  - [ ] No regressions in interaction affordances.

## Issue 7: Regression Tests for Connection UX

- Title: `M16.7: Add focused tests for connection UX consistency`
- Goal: Lock in the behavior fixed by M16.1-M16.4.
- Files in scope:
  - `services/frontend/src/components/mission-control/layout/__tests__/*`
  - `services/frontend/src/components/mission-control/panels/__tests__/*`
  - `services/frontend/src/services/api/__tests__/*`
  - `services/frontend/src/config/__tests__/*` (new if needed)
- Tasks:
  - [x] Add test that only one `ConnectionStatusBanner` renders in error state.
  - [x] Add test that retry calls unified connect action.
  - [x] Add tests for URL resolver defaults.
- Acceptance:
  - [x] Tests fail on banner duplication regressions.
  - [x] Tests fail on `8000` fallback regressions.
  - [x] Full frontend test suite remains green.

## Issue 8: Visual QA Snapshot Pass

- Title: `M16.8: Capture before/after UI baselines`
- Goal: Ensure measurable UX improvement from M16 changes.
- Files in scope:
  - `services/frontend` runtime
  - `docs/` or `.loom/` screenshot note (as decided)
- Tasks:
  - [ ] Capture baseline screenshots (offline, connecting, connected, run-active).
  - [ ] Capture post-change screenshots for same states.
  - [ ] Record QA notes on status clarity, hierarchy, and readability.
  - [x] Place in `docs/architecture/ui/m16-baselines/` (directory initialized)
- Acceptance:
  - [ ] Screenshot set covers all required states.
  - [ ] QA notes identify no blocker-level UX regressions.

---

## Sequencing

1. Issue 1
2. Issue 2
3. Issue 4
4. Issue 3
5. Issue 7
6. Issue 5
7. Issue 6
8. Issue 8

## Baseline Commands

- `cd services/frontend && npm run lint`
- `cd services/frontend && npm test -- --run --reporter=dot`
- Optional spot-check: `cd services/frontend && npm run dev`
