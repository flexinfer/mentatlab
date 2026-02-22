# Product Specs

## 2026-02-20 Spec: Mission Control Functional UX Standardization (M16)

### Summary

Stabilize Mission Control so the UI is reliably functional under real backend conditions, then standardize visual and interaction patterns for a professional operator experience. The first milestone is connection reliability and clear runtime feedback; aesthetic polish follows only after functional parity.

### Goals

- Establish one connection/stream transport authority for Mission Control.
- Remove duplicate/conflicting connection status surfaces.
- Align frontend runtime defaults with Go gateway/orchestrator ports and routing.
- Standardize core layout/panel primitives and visual tokens across canvas, bars, and dock.
- Preserve existing DAG and panel capabilities while reducing cognitive overload.

### Non-Goals

- Rewriting Mission Control architecture from scratch.
- Building a new design system package in this slice.
- Shipping new orchestration features (gates/webhooks/cron/etc.) as part of this UX stabilization.

### Users / Stakeholders

- Operators running and debugging flows in Mission Control.
- Engineers building and validating orchestration features.
- Product/design owners responsible for platform polish and consistency.

### Functional Requirements

1. Single transport owner for live connection state used by top bar, canvas, network panel, and bottom dock.
2. One canonical connection status surface (global banner/toast/status bar), with deterministic retry behavior.
3. URL/base config normalization:
   - gateway default `http://127.0.0.1:8080` (or runtime origin in browser),
   - orchestrator default `http://localhost:7070`,
   - no legacy `localhost:8000` defaults in active path.
4. Streaming state transitions (`idle/connecting/connected/reconnecting/error`) are reflected consistently in all relevant components.
5. Legacy `/streaming` route either:
   - removed, or
   - feature-flagged and clearly labeled non-primary.

### Non-Functional Requirements

- No regression in existing frontend test pass baseline.
- TypeScript compile clean (`tsc --noEmit`).
- Visible latency for status updates < 1 second after transport events.
- UI text contrast and spacing meet current workspace accessibility baseline.

### UX Requirements

- Clear information hierarchy: run controls, connection state, selected-node context, and console visibility should not compete.
- Standardized spacing/radius/border/shadow tokens across top bar, sidebars, canvas shell, and bottom dock.
- Dark theme should be operationally legible (reduced neon/glow noise, restrained accent usage).
- Connection errors should appear once, with a clear next action.

### Acceptance Criteria

1. With backend offline, user sees one error status and one retry path; no duplicated banners.
2. With backend online, connect/disconnect/reconnect status transitions are coherent across all controls.
3. Launching from default dev settings connects to Go stack endpoints without manual URL edits.
4. `npm run lint` and `npm test -- --run --reporter=dot` pass.
5. Visual review screenshots show consistent panel chrome and typography across main Mission Control surfaces.

### Sources

- `services/frontend/src/App.tsx:17`
- `services/frontend/src/App.tsx:18`
- `services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:203`
- `services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx:250`
- `services/frontend/src/components/mission-control/layout/TopBar.tsx:107`
- `services/frontend/src/components/ui/ConnectionStatusBanner.tsx:36`
- `services/frontend/src/components/mission-control/layout/WorkspaceProvider.tsx:203`
- `services/frontend/src/components/mission-control/panels/NetworkPanel.tsx:609`
- `services/frontend/src/components/StreamingCanvas.tsx:42`
- `services/frontend/src/components/StreamingCanvas.tsx:89`
- `services/frontend/src/services/api/apiService.ts:113`
- `services/frontend/src/config/orchestrator.ts:10`
- `services/frontend/src/config/orchestrator.ts:75`
- `services/frontend/src/index.css:49`
- `services/frontend/tailwind.config.js:18`

---

## 2026-02-18 Spec: MentatLab Docs + flexinfer-site Integration

## Summary

Integrate MentatLab documentation as a first-class docs project in `services/flexinfer-site`, backed by synced markdown from `services/mentatlab/docs`, with a curated public doc set and internal navigation at `/docs/mentatlab`.

## Goals

- Publish MentatLab docs inside the existing FlexInfer docs hub UX.
- Replace external GitLab tree docs links with internal docs routes.
- Keep docs synchronization repeatable via existing `sync-docs.mjs` workflow.
- Provide a stable, curated public docs subset from MentatLab (`docs/site/`).

## Non-Goals

- Rewriting all historical MentatLab docs.
- Building a custom docs engine for MentatLab.
- Introducing new auth/content gating for docs routes.

## Users / Stakeholders

- FlexInfer platform operators evaluating MentatLab.
- Engineering contributors needing architecture/API/deployment references.
- Site maintainers operating `services/flexinfer-site`.

## Requirements

### Functional

- Add `mentatlab` docs source/target in `scripts/sync-docs.mjs`.
- Add `pnpm sync:mentatlab-docs` script.
- Add docs renderer instance in `lib/project-docs.ts`.
- Add docs routes:
  - `app/docs/mentatlab/page.tsx`
  - `app/docs/mentatlab/[...slug]/page.tsx`
- Add `content/mentatlab-docs/nav.yaml` and preserve it across sync.
- Update docs hub cards (`/docs`) to include MentatLab.
- Update product/docs links so MentatLab points to `/docs/mentatlab`.
- Add/adjust tests for updated docs link behavior.

### Non-Functional

- Keep parity with existing docs route patterns and styling.
- Ensure typecheck and targeted tests pass.
- Keep source docs ASCII/plain markdown.

## UX / Flows

- User opens `/docs` and sees a MentatLab docs card.
- User opens `/docs/mentatlab` and sees curated docs landing content.
- User drills into sidebar pages at `/docs/mentatlab/<slug>`.
- User on `/products/mentatlab` clicks "MentatLab docs" and stays on-site.

## Data / APIs

- No new backend APIs.
- Uses static markdown content synced at build/dev time.
- Uses existing `createProjectDocs()` markdown/nav parsing pipeline.

## Rollout / Migration

1. Add curated source docs under `services/mentatlab/docs/site`.
2. Add sync + route plumbing in `services/flexinfer-site`.
3. Run `node scripts/sync-docs.mjs mentatlab`.
4. Validate with typecheck + targeted tests.
5. Merge and deploy via existing site pipeline.

## Observability

- Logs: Next.js build logs and test logs.
- Metrics: N/A (static docs integration).
- Traces: N/A.

## Risks

- Future sync could overwrite nav if `preserveNavYaml` behavior changes.
- Curated docs may drift from internal docs unless maintained in `docs/site`.

## Open Questions

- Should `/docs/mentatlab` be added explicitly to sitemap/static SEO routes?
- Should additional MentatLab pages (e.g., mission control deep dives) be linked from docs hub cards?

## Sources

- `services/flexinfer-site/scripts/sync-docs.mjs:27`
- `services/flexinfer-site/lib/project-docs.ts:466`
- `services/flexinfer-site/app/docs/page.tsx:172`
- `services/flexinfer-site/data/portfolio-positioning.ts:186`
- `services/flexinfer-site/app/products/mentatlab/page.tsx:80`
- `services/flexinfer-site/app/docs/mentatlab/page.tsx:1`
- `services/flexinfer-site/app/docs/mentatlab/[...slug]/page.tsx:1`
- `services/mentatlab/docs/site/README.md:1`
