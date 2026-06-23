# Robustness Kill-Test — Results (Slice 0)

- **Plan**: `plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3`
- **Date run**: 2026-06-23
- **Harness**: native `go build` orchestrator + host Python agent (`agents/sleep/main.py`), local Redis on `:6379`.
- **Scripts**: `scripts/chaos/restart-midrun.sh`, `scripts/chaos/sse-gap-check.mjs`
- **Verdict**: **ASSUMPTION CONFIRMED** — proceed with full resilience scope (Slice 1). Static analysis *under-counted* the problem; live testing found additional P0 bugs.

## Why native, not docker-compose

The stock orchestrator image (`services/orchestrator-go/Dockerfile`) is minimal alpine with **no Python and no `agents/` dir**, so the subprocess driver cannot execute Python agents in compose — the existing e2e drives runs via manually-posted checkpoints, not real agent execution. Running the orchestrator natively gives real subprocess agent execution + direct `kill -TERM`/restart against the same Redis. (Finding in its own right: there is no compose image that can actually execute the bundled agents.)

## Part A — In-flight run survives orchestrator restart?

Procedure: start orchestrator, create+auto-start a run whose single node runs `sleep` agent (45s), confirm `running`, `kill -TERM` orchestrator mid-run, restart against same store, query run.

| Store mode | Post-restart `GET /runs/{id}` | Observed |
|---|---|---|
| `redis` | **HTTP 200, status `running`** (frozen) | State persists, but run is **never resumed and never cleanly failed**. `updated_at` stays at original start; node child process died with the old orchestrator. Orphaned "running" zombie indefinitely. |
| `memory` (the silent-fallback target) | **HTTP 404** | Run **vanished entirely** — total data loss. |

**Conclusion**: in-flight runs do **not** survive a restart with any deterministic, recoverable outcome. With Redis they zombie as `running` forever (no resume-on-restart machinery); with the in-memory store (which the silent fallback selects) they disappear. Confirms resilience findings #2 (silent fallback) and the absence of run recovery.

## Part B — SSE resumption lossless? (could not measure — found worse)

While building the SSE gap-checker, the live path surfaced **two additional P0 bugs** that block measurement and crash the service:

### B1 — Orchestrator SSE returns HTTP 500 in every environment (FIXED to proceed)
- **Symptom**: `GET /api/v1/runs/{id}/events` → `500 {"message":"streaming not supported"}`.
- **Root cause**: the status-capturing `responseWriter` (single type in `internal/api/middleware.go:146`, used by both `LoggingMiddleware` and `AuditMiddleware` per `internal/api/routes.go:61,144`) embeds the `http.ResponseWriter` *interface* and overrides `WriteHeader`, but does **not** implement `Flush()`. `Flush` is not part of the `http.ResponseWriter` interface, so the wrapper fails the `w.(http.Flusher)` assertion in `internal/api/sse.go:64`.
- **Impact**: orchestrator SSE is non-functional anywhere these middlewares are active (always). The frontend's reliance on this path is unvalidated; this is the "code-complete but never validated live" gap the plan predicted.
- **Action taken**: applied a minimal `Flush()` passthrough to `responseWriter` so the kill-test could proceed. **This fix is uncommitted and needs a regression test — formalize in Slice 1.**

### B2 — SSE reconnect panics and crashes the whole orchestrator
- **Symptom**: after a client disconnects and a second client connects to the same run, the process dies with:
  `panic: send on closed channel` at `internal/runstore/redis.go:962` (in `streamReader`, created by `Subscribe` at `:900`).
- **Root cause**: `Subscribe`'s `cleanup()` (`redis.go:902-910`) `close(ch)`s while the `streamReader` goroutine may still be in `case ch <- event:`. The `<-ctx.Done()` guard races with `cleanup()` and loses. Close-before-goroutine-exit.
- **Impact**: a single client reconnecting takes down the orchestrator for **all** runs. Far more severe than the "events silently dropped" static finding. SSE losslessness is moot until this is fixed.

### B3 — Inconsistent Redis URL db-index parsing → silent memory fallback (bonus)
- With `REDIS_URL=redis://localhost:6379/15`, the **runstore** parsed the `/15` DB index correctly, but the **registry** and **flow store** failed (`unknown port: lookup tcp/6379/15`) and **silently fell back to memory** (`orch-sse3.log`). A live reproduction of the silent-fallback resilience gap, plus a parsing inconsistency across stores.

## Net effect on the plan

- **Riskiest assumption → CONFIRMED (passed 2026-06-23).** Resilience scope (Slice 1, and the durability portions of Slices 4/5) stands.
- **New must-fix items for Slice 1** (discovered live, not in original static list):
  1. SSE `Flush()` passthrough on `responseWriter` (+ regression test). *(temporary fix already in working tree)*
  2. `streamReader`/`Subscribe` close-before-exit panic on reconnect (`redis.go:900-962`).
  3. Redis URL DB-index parsing unified across runstore/registry/flowstore (and the silent fallback made loud).
  4. Run recovery on restart: resume in-flight runs, or mark them failed with a reason — never leave `running` zombies.
- **New finding for Slice 3 (live validation)**: there is no container image capable of executing bundled agents; the compose e2e never exercises real subprocess agent execution. A real execution image/path is needed for honest e2e.
