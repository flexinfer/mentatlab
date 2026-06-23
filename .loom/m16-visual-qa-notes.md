# M16 Visual QA Notes

> Captured: 2026-02-21
> Milestone: M16 — Unify Live Connection & UI Polish
> Issues: #43–#48 (M16.2–M16.8)

## Changes Reviewed

### M16.2 — Streaming store with session-based state (#43)
- Zustand store replaces scattered WebSocket state
- Single source of truth for connection status

### M16.3 — StreamingCanvas shared transport (#44)
- Canvas consumes store data instead of direct HTTP/WS polling
- No visual change expected; data flow cleanup

### M16.4 — Normalize frontend URL defaults (#45)
- All singletons wired through `config/orchestrator.ts`
- No hardcoded `localhost:8000` anywhere
- 17 URL resolver tests + drift guard

### M16.5 — Legacy /streaming route gated (#46)
- `/streaming` gated behind `LEGACY_STREAMING_PAGE` feature flag
- Off in prod (redirect to `/`), on in dev for diagnostics
- Lazy-loaded via `React.lazy()` for bundle size

### M16.6 — Visual tokens standardized (#47)
- **Dark theme tokens** — toned down from cyberpunk neon to restrained operator:
  - Foreground: `180 100% 90%` (cyan) → `210 20% 88%` (neutral gray)
  - Primary: `190 100% 50%` (neon cyan) → `186 60% 50%` (teal)
  - Secondary: `280 100% 60%` (electric purple) → `260 30% 50%` (muted slate-purple)
  - Accent: `320 100% 55%` (hot pink) → `250 50% 60%` (soft indigo)
  - Destructive: `0 100% 50%` → `0 72% 51%` (same as light mode)
- **Panel chrome** — normalized to consistent pattern:
  - `rounded-md` (was mix of `rounded-xl`, `rounded-lg`, `rounded-md`)
  - `shadow-lg` (was mix of `shadow-2xl`, `shadow-lg`)
  - `backdrop-blur` (was mix of `backdrop-blur-xl`, `backdrop-blur-md`, `backdrop-blur`)
  - `bg-card/80` semantic token (was mix of `bg-white/50`, `bg-zinc-900/50`, `bg-card/50`)
- **Glow reduction**:
  - React Flow node shadow: `0 4px 15px rgba(0,0,0,0.5)` → `0 2px 8px rgba(0,0,0,0.3)`
  - Handle glow: `0 0 8px` → `0 0 4px` at 40% opacity
  - Edge glow: `0 0 3px` → `0 0 2px` at 30% opacity
  - `neon-text` utility: double shadow → single shadow at 40% opacity
  - Badge variants: removed `shadow-[0_0_10px_...]` glow entirely
  - `glow` animation: `0 0 20px / 0.8` → `0 0 8px / 0.4`
- **Grid background** — dark mode grid lines changed from cyan to neutral gray

### M16.7 — Connection UX regression tests (#48)
- 14 ConnectionStatusBanner tests
- 4 connection retry regression tests
- 749 total frontend tests (18 new)

## Visual States Checklist

| State | Status | Notes |
|-------|--------|-------|
| Offline (disconnected) | Pass | Banner shows "Disconnected" with reconnect button |
| Connecting | Pass | Banner shows spinner + "Connecting" |
| Connected | Pass | Banner hidden |
| Reconnecting | Pass | Amber banner with spinner |
| Error | Pass | Red banner with retry button, no dismiss |
| Run active (streaming) | Pass | Console + graph update from store |
| Dark mode | Pass | Neutral tones, no neon glow bleed |
| Light mode | Pass | Clean professional look preserved |

## Acceptance Criteria

- [x] Visual diff shows consistent panel chrome across TopBar/Sidebar/Canvas/Dock
- [x] Dense states remain legible (errors + active run + logs)
- [x] No regression in interaction affordances
- [x] Tests fail on banner duplication regressions
- [x] Tests fail on `:8000` fallback regressions
- [x] Full frontend suite green (749 tests)

## Residual Notes

- Font loading: Inter and JetBrains Mono defined but not bundled — relies on CDN or system fallback. Consider self-hosting for offline/air-gapped deployments.
- The `neon-text` and `neon-border` utilities are still defined but usage is minimal (0 references after M16.6 cleanup). Can be removed in a future cleanup.
- E2E visual regression spec added at `e2e/visual-qa-m16.spec.ts` for Playwright screenshot comparisons.
