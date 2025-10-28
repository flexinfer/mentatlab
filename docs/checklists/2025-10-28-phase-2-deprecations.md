# Checklist — Phase 2 (Oct 28, 2025)

- [ ] Remove `/legacy` FlowBuilder route from `src/App.tsx`
- [ ] Remove `components/AgentPalette.tsx` (ensure no imports remain)
- [ ] Remove `components/FlowCanvas.tsx` (ensure no imports remain)
- [ ] Remove `components/CommandPalette.tsx` (ensure no imports remain)
- [ ] Replace `PropertyInspector` in Mission Control with non-deprecated panel
- [ ] Remove `src/loadFlow.ts` and `src/services/websocketService.ts`
- [ ] Consolidate remote UI loader into `utils/remoteUi.ts` and update consumers
- [ ] Update docs to remove deprecated references
- [ ] Build + smoke test Mission Control
