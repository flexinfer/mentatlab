# Phase 2 — Remove Deprecated UI + Wire Updated Code (Oct 28, 2025)

Objective
- Remove or replace deprecated UI modules and references.
- Ensure updated streaming-first components are the only code paths.
- Update docs to align with current UI and APIs.

Targets
- Remove `/legacy` FlowBuilder route from `App.tsx` and delete `AgentPalette`, `FlowCanvas`, `CommandPalette` if unused.
- Replace `PropertyInspector` usage in Mission Control with a minimal non-deprecated inspector or inline panel.
- Remove deprecated helpers: `loadFlow.ts`, `websocketService.ts` (ensure features parity via streaming only).
- Update docs that reference deprecated components.
- Consolidate CogPak remote UI mounting into a single helper and add a minimal unit test.

Plan
- Audit imports to confirm any remaining usage paths for deprecated files.
- Implement replacements (or temporary “No Inspector” panel) to unblock removal.
- Remove code and run type/build checks.
- Update docs and examples.

Validation
- `npm run build` passes.
- Navigating Mission Control has no console warnings from deprecated components.
- CogPak UIs still mount via the consolidated helper.
