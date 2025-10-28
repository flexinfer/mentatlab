# Checklist — Phase 2 (Oct 28, 2025)

- [x] Remove `/legacy` FlowBuilder route from `src/App.tsx`
- [x] Remove `components/AgentPalette.tsx` (ensure no imports remain)
- [x] Remove `components/FlowCanvas.tsx` (ensure no imports remain)
- [x] Remove `components/CommandPalette.tsx` (ensure no imports remain)
- [x] Replace `PropertyInspector` in Mission Control with non-deprecated panel
- [x] Remove `src/loadFlow.ts` and `src/services/websocketService.ts`
- [x] Consolidate remote UI loader into `utils/remoteUi.ts` and update consumers
- [x] Update docs to remove deprecated references
- [x] Build + smoke test Mission Control
