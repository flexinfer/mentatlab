# Product Spec: MentatLab Docs + flexinfer-site Integration

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
