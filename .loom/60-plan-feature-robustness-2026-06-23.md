# MentatLab Feature Robustness (Full-Stack Vertical Hardening)

- **Plan ID**: `plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3`
- **Phase**: draft
- **Project**: services/mentatlab
- **Namespace**: mentatlab/feature-robustness
- **Created by**: claude-code
- **Created**: 2026-06-23T09:18:55Z
- **Updated**: 2026-06-23T10:27:16Z

> Rendered from the Loom plan store (canonical). Edit via `agent_plan_*` tools, not this file.

## Spec

## Summary

Harden MentatLab's flagship user journeys **end-to-end** (frontend → gateway → orchestrator → agent) across four robustness dimensions: **runtime resilience**, **live validation**, **test & regression safety**, and **security**. Approach is *full-stack vertical*: rather than horizontal sweeps, we pick a small number of flagship journeys and make each bulletproof through all four dimensions, proving the fix with a fault-injection harness.

Flagship journeys:
- **J1 — Core run loop**: build flow → create run → schedule DAG → execute agent (subprocess/K8s) → stream events (SSE/WS) → render in Mission Control. *The* flagship; everything else builds on it.
- **J2 — Gated/approval workflow**: gate node blocks → operator approves/rejects via API → downstream resumes.
- **J3 — Triggered runs**: webhook + cron auto-create and start runs.

## Riskiest assumption + kill-test

**Load-bearing assumption**: MentatLab's persistence layer does **not** actually preserve in-flight run state across an orchestrator restart, and live event streams (SSE) silently lose events under disconnect/backpressure — i.e. the resilience gaps found by static analysis are real and reproducible, not masked by some recovery path the static read missed. The entire resilience track (Slices 1, 4, 5) is sized against these being true.

**Kill test** (Slice 0, ≤30 min, run on docker-compose stack with Redis):
1. Start the full stack, create a flow with a long-running agent node (e.g. a 60s sleep agent), start a run, confirm it is `running` and emitting events.
2. `kill -TERM` the orchestrator mid-run.
3. Observe: does the run resume/recover, get marked failed cleanly, or vanish? Query `GET /api/v1/runs/{id}` and `/events` after restart.
4. Separately: subscribe to SSE, force a client disconnect during high event volume, reconnect with `Last-Event-ID`, and diff received event IDs against the orchestrator's stored stream to detect drops/gaps.

**Observable outcome**: a written record of exactly what happens to an in-flight run on restart and whether SSE resumption is lossless. If runs vanish / SSE gaps appear → assumption confirmed. If runs recover cleanly and SSE is lossless → assumption FALSE, de-scope Slice 1 durability work.

**Failure mode if wrong**: we'd build run-recovery machinery for a system that already recovers, wasting the largest resilience slice.

**Status**: **PASSED / CONFIRMED 2026-06-23** — see `.loom/robustness-killtest-notes.md`.
- Restart, `redis` store: run state persists but becomes an orphaned `running` zombie (no resume, no clean-fail).
- Restart, `memory` store (the silent-fallback target): run vanishes entirely (HTTP 404).
- SSE: losslessness *could not be measured* because live testing found two worse P0 bugs — (1) orchestrator SSE returns 500 everywhere (`responseWriter` middleware strips `http.Flusher`, `internal/api/middleware.go:146`); (2) SSE reconnect panics the whole orchestrator (`send on closed channel`, `internal/runstore/redis.go:962`). Plus Redis-URL db-index parsing is inconsistent across stores → silent memory fallback. These are folded into Slice 1.

## Evidence base (static analysis, 2026-06-23)

Resilience (orchestrator-go):
- Silent in-memory fallback masks Redis loss; state lost on restart — `internal/factories/factories.go:32-52`, `:83-114`
- State writes dropped when circuit breaker open, no buffer/WAL — `internal/runstore/redis.go:194-263`
- SSE events silently skipped when channel full — `internal/api/sse.go` + `internal/runstore/redis.go:967`; stream hard-trimmed at MaxLen=5000 — `redis.go:799-806`
- K8s job watch restarts without resourceVersion → misses completion events — `internal/k8s/watch.go:71-124`
- Heartbeat-timeout job deletion error ignored, uses background ctx — `internal/driver/k8s.go:187-210`
- No scheduler drain on shutdown — `cmd/orchestrator/main.go:260-284`

Live-confirmed bugs (kill-test, 2026-06-23) — see `.loom/robustness-killtest-notes.md`:
- SSE 500 everywhere: `responseWriter` (middleware.go:146, used by Logging+Audit per routes.go:61,144) strips `http.Flusher`.
- SSE reconnect panics orchestrator: `send on closed channel` at `internal/runstore/redis.go:962` (Subscribe.cleanup close-before-exit race).
- Redis URL db-index parsing inconsistent: runstore parses `redis://host:6379/15`; registry+flowstore fail and silently fall back to memory.
- No run recovery on restart (redis: zombie `running`; memory: vanishes).
- No compose image can execute bundled agents (orchestrator image lacks Python) — compose e2e never exercises real subprocess execution.

Testing:
- Zero unit tests: scheduler core (12 files), API handlers (17 files incl `sse.go`, `routes.go`, validation), `runstore/{store,memory,redis}.go`, `flowstore/{store,redis}.go`, driver (5 files)
- Frontend untested: `services/streaming/{orchestratorSSE,parse,streamRegistry,workerManager}.ts`, `transport/event-pipeline.ts`, `services/api/{httpClient,websocketClient,streamingService}.ts`
- CI: coverage regex is informational only, no `--fail-under`; no load/chaos/e2e-depth gates — `.gitlab-ci.yml`

Security:
- API-key scopes stored but never enforced per-endpoint — `internal/auth/apikey.go:22-30`, `internal/auth/middleware.go:96-112`
- Agent secrets passed as plaintext env (no K8s Secrets) — `internal/k8s/job.go:122-129`, `internal/driver/subprocess.go:59-72`
- Subprocess driver has no resource/isolation limits — `internal/driver/subprocess.go`
- (Already solid: audit logging `internal/api/audit.go`; K8s securityContext + NetworkPolicy `k8s/job.go:163-183`, `k8s/network-policies.yaml:313-356`)

Live validation (coded, unproven e2e): K8s job driver, MinIO/S3 dataflow (`internal/dataflow/s3.go`, feature-flagged, not wired into run outputs), gates/webhooks/cron (`internal/api/handlers_m5m6.go`, `internal/scheduler/{gate,cron}.go`), MCP node exec + agent-context (`internal/mcpclient/hub.go`, `agents/common/context.py`).

## Non-Goals

- New orchestration features. This is hardening of existing features only.
- Frontend visual redesign (M16 owns that).
- Rewriting the persistence or scheduler architecture from scratch — incremental, test-gated changes only.
- TypeScript SDK / checkpoint-resume feature build-out beyond what existing journeys already use.

## Success Criteria

1. Kill-test run and recorded; resilience scope confirmed or re-pointed. ✅ (CONFIRMED 2026-06-23)
2. An in-flight run survives an orchestrator restart with a deterministic, documented outcome (recover or clean-fail — no silent vanish), and SSE resumption is lossless within the retained window.
3. CI enforces a coverage floor on orchestrator-go + gateway-go + frontend; the previously-zero-coverage critical packages (scheduler, runstore, sse, frontend streaming) have meaningful tests.
4. Each flagship journey (J1/J2/J3) has a live e2e test running against a real stack in CI.
5. API-key scopes are enforced per-endpoint; agent secrets flow via K8s Secrets, not plaintext env.

## Slices

### 1. Slice 0 — Fault-injection harness + kill-test — `implemented`

- **Slice ID**: `plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#1`
- **Goal**: Build a reproducible chaos/fault-injection harness on the docker-compose stack and run the riskiest-assumption kill-test: does an in-flight run survive an orchestrator restart, and is SSE resumption lossless? Record the observed outcome and confirm or re-point the resilience scope (gates Slice 1).
- **Files**: docker-compose.yml, docker-compose.ci.yml, agents/sleep/main.py, scripts/chaos/restart-midrun.sh, scripts/chaos/sse-gap-check.mjs, .loom/robustness-killtest-notes.md
- **Branch**: test/robustness-fault-harness
- **Acceptance**: 1) A long-running test agent (configurable sleep) exists and can be scheduled. 2) `scripts/chaos/restart-midrun.sh` starts a run, restarts orchestrator mid-run, and reports the run's post-restart status from the API. 3) `scripts/chaos/sse-gap-check.mjs` subscribes to SSE, forces a disconnect under load, reconnects with Last-Event-ID, and reports any event-ID gaps. 4) Outcome written to `.loom/robustness-killtest-notes.md` with verdict: resilience scope CONFIRMED or RE-POINTED. 5) Plan riskiest-assumption Status updated to passed/FAILED with date.
- **Decision**: DONE 2026-06-23. Harness built (agents/sleep/main.py, scripts/chaos/restart-midrun.sh, scripts/chaos/sse-gap-check.mjs) and kill-test executed. Verdict: ASSUMPTION CONFIRMED. Results + 3 discovered P0/parsing bugs in .loom/robustness-killtest-notes.md. Note: docker-compose orchestrator image cannot execute bundled agents (no python), so harness runs orchestrator natively — flagged for Slice 3 (need a real agent-exec image for honest e2e).

### 2. Slice 1 — J1 core run loop: durability & resilience — `implementing`

- **Slice ID**: `plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#2`
- **Goal**: Make the core run loop survive infrastructure faults deterministically. Eliminate silent data loss: make the memory fallback explicit/alerting (not a silent default), recover or cleanly fail in-flight runs on orchestrator restart, buffer/retry state writes when Redis is briefly unavailable, ensure SSE resumption is lossless within the retained window, and drain the scheduler on shutdown.
- **Files**: services/orchestrator-go/internal/factories/factories.go, services/orchestrator-go/internal/runstore/redis.go, services/orchestrator-go/internal/runstore/store.go, services/orchestrator-go/internal/api/sse.go, services/orchestrator-go/internal/k8s/watch.go, services/orchestrator-go/internal/driver/k8s.go, services/orchestrator-go/cmd/orchestrator/main.go, services/orchestrator-go/internal/scheduler/run_lifecycle.go
- **Branch**: feat/robustness-runloop-durability
- **Depends on**: plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#1
- **Acceptance**: 1) Memory fallback requires explicit ORCH_ALLOW_MEMORY_FALLBACK and emits a loud, repeated WARN + metric; default behavior fails fast. 2) On orchestrator restart with Redis backing, in-flight runs are either resumed or transitioned to a terminal failed state with a reason — never silently lost (verified by Slice 0 harness). 3) State writes during a transient Redis outage are retried/buffered, not dropped on circuit-breaker-open. 4) SSE Last-Event-ID resumption returns no gaps within the retained stream window; trimming is observable (metric/log) so clients can detect it. 5) K8s job watch resumes from resourceVersion and does not miss completion events across an API flap. 6) Heartbeat-timeout job deletion uses a bounded context and retries; failures surface. 7) SIGTERM drains the scheduler (bounded) before stores close. 8) Slice 0 harness reruns green for restart + SSE scenarios.
- **MR**: https://github.com/flexinfer/mentatlab/pull/3
- **Decision**: Kill-test (Slice 0) confirmed scope and surfaced 4 concrete must-fix items for this slice, some not in the original static list: (1) SSE returns 500 everywhere — responseWriter middleware (middleware.go:146, used by Logging+Audit) strips http.Flusher; minimal Flush() passthrough already applied in working tree, needs regression test. (2) SSE reconnect panics whole orchestrator 'send on closed channel' redis.go:962 — Subscribe.cleanup() closes ch while streamReader still sending; close-before-goroutine-exit race. (3) Redis URL db-index parsing inconsistent: runstore parses redis://host:6379/15, registry+flowstore fail and silently fall back to memory — unify parsing AND make fallback loud. (4) Run recovery on restart: redis-backed in-flight runs zombie as 'running' forever (no resume); must either resume or mark failed-with-reason. Add files: internal/api/middleware.go. Evidence: .loom/robustness-killtest-notes.md
- **Decision**: PARTIAL: shipped + merged (PR #3) the two P0 SSE fixes discovered by the kill-test — (1) responseWriter Flush() passthrough (SSE no longer 500s); (2) Subscribe/streamReader close-before-exit fix (no more 'send on closed channel' panic on reconnect). Both have regression tests (incl -race); full orchestrator-go suite green; verified live (0 panics, lossless Last-Event-ID resumption). STILL PENDING for this slice: memory-fallback gating (explicit ORCH_ALLOW_MEMORY_FALLBACK + loud warn/metric, fail-fast default), run recovery on restart (resume or mark-failed; no 'running' zombies), Redis write retry/buffer on circuit-breaker-open, unified Redis URL db-index parsing across runstore/registry/flowstore, K8s watch resourceVersion resume, heartbeat-timeout bounded ctx, scheduler drain on SIGTERM.

### 3. Slice 2 — J1 core run loop: test & regression safety — `pending`

- **Slice ID**: `plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#3`
- **Goal**: Close the zero-coverage gaps on the code paths the core run loop depends on, and turn on enforcement so coverage can't silently regress. Target the highest-risk untested units: runstore/flowstore (memory↔redis parity), scheduler core, SSE handler, and frontend streaming/event-pipeline.
- **Files**: services/orchestrator-go/internal/runstore/redis_test.go, services/orchestrator-go/internal/runstore/memory_test.go, services/orchestrator-go/internal/flowstore/redis_test.go, services/orchestrator-go/internal/scheduler/scheduler_test.go, services/orchestrator-go/internal/scheduler/run_lifecycle_test.go, services/orchestrator-go/internal/api/sse_test.go, services/frontend/src/services/streaming/orchestratorSSE.test.ts, services/frontend/src/services/streaming/parse.test.ts, services/frontend/src/transport/event-pipeline.test.ts, .gitlab-ci.yml
- **Branch**: test/robustness-runloop-coverage
- **Depends on**: plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#2
- **Acceptance**: 1) runstore + flowstore have parity tests proving memory and redis backends behave identically for the core operations (create/get/update/events). 2) scheduler core + run lifecycle have tests covering success, node failure, retry, and partial-DAG-failure propagation. 3) SSE handler has tests for Last-Event-ID resumption and disconnect handling. 4) Frontend orchestratorSSE/parse/event-pipeline have tests for event ordering, malformed events, and reconnection. 5) CI enforces a coverage floor (`go test -coverprofile` with a fail-under check on orchestrator-go + gateway-go; vitest threshold on frontend) — builds fail below floor. 6) New tests run in CI and pass.

### 4. Slice 3 — J1 core run loop: live validation in CI — `pending`

- **Slice ID**: `plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#4`
- **Goal**: Prove the core run loop works against a real stack, not just mocks, and gate it in CI. Validate the K8s job driver end-to-end, the subprocess heartbeat-timeout kill path, and the MinIO/S3 artifact round-trip (wiring it into run outputs if not already). Promote the Slice 0 harness into a CI e2e/chaos job.
- **Files**: services/orchestrator-go/internal/driver/k8s_integration_test.go, services/orchestrator-go/internal/dataflow/s3_integration_test.go, services/orchestrator-go/internal/scheduler/node_exec.go, services/frontend/e2e/orchestrator-live.spec.ts, .gitlab-ci.yml, docker-compose.ci.yml
- **Branch**: test/robustness-runloop-e2e
- **Depends on**: plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#1
- **Acceptance**: 1) K8s job driver runs a real job against a Kind/k3s cluster in CI: job created, logs streamed, exit code + events captured, securityContext applied. 2) Subprocess + K8s heartbeat-timeout e2e: an agent that stops emitting heartbeats is killed and the node reports heartbeat_timeout with no zombie job. 3) MinIO artifact round-trip e2e: a run with an artifact output uploads to MinIO and a downstream node reads it back (DATAFLOW_TYPE=minio); wire artifact outputs into run outputs if currently only infra. 4) Playwright live spec covers build→run→SSE→completion against the docker-compose stack. 5) A CI e2e/chaos stage runs these against ephemeral infra and gates merges. 6) Failures produce useful artifacts (logs, screenshots).

### 5. Slice 4 — J2 gated/approval workflow hardening — `pending`

- **Slice ID**: `plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#5`
- **Goal**: Harden the gate/approval journey across all four dimensions: a waiting gate must survive an orchestrator restart (durability), approve/reject must be proven e2e (live validation), the gate state machine + timeout must be unit-tested (regression safety), and gate decisions must be authorized + audited (security).
- **Files**: services/orchestrator-go/internal/scheduler/gate.go, services/orchestrator-go/internal/api/handlers_m5m6.go, services/orchestrator-go/internal/scheduler/gate_test.go, services/orchestrator-go/internal/api/handlers_m5m6_test.go, services/frontend/e2e/gate-approval.spec.ts
- **Branch**: feat/robustness-gates
- **Depends on**: plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#2
- **Acceptance**: 1) A run waiting on a gate survives orchestrator restart: gate state is reconstructed from the store and approve/reject still works (no in-memory-only channel that evaporates). 2) Gate timeout behavior is deterministic and tested (timeout → reject/fail with reason). 3) Unit tests cover approve, reject, timeout, double-approve, and approve-after-restart. 4) e2e: create run with gate node → node enters waiting_approval → approve via API → downstream executes; and the reject path blocks downstream. 5) Approve/reject require appropriate scope (ties into Slice 6) and emit audit entries (verify existing audit path fires).

### 6. Slice 5 — J3 triggered runs hardening (webhook + cron) — `pending`

- **Slice ID**: `plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#6`
- **Goal**: Harden automated run triggers. Webhook: tighten token auth (rejection paths, rotation) and prove e2e. Cron: make scheduling durable across restart (no missed/duplicate triggers, defined catch-up behavior) and prove a schedule fires. Add the missing tests for both.
- **Files**: services/orchestrator-go/internal/scheduler/cron.go, services/orchestrator-go/internal/api/handlers_m5m6.go, services/orchestrator-go/internal/scheduler/cron_test.go, services/orchestrator-go/internal/api/webhook_test.go
- **Branch**: feat/robustness-triggers
- **Depends on**: plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#2
- **Acceptance**: 1) Webhook trigger rejects missing/invalid tokens with 403 (tested) and supports token rotation via an endpoint. 2) Cron schedules are persisted and re-loaded on restart; behavior for ticks missed during downtime is defined and tested (skip vs catch-up). 3) No duplicate triggers when multiple orchestrator replicas run (or single-runner invariant is documented + enforced). 4) Unit tests cover cron parsing/matching edge cases (already partially present — extend to restart + missed-tick) and webhook auth paths. 5) e2e: a near-term schedule fires and creates a run; a webhook POST with a valid token starts a run.

### 7. Slice 6 — Cross-cutting security hardening — `pending`

- **Slice ID**: `plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#7`
- **Goal**: Close the two platform-wide security gaps that make features unsafe to expose: enforce API-key scopes per-endpoint (they're stored but ignored today), and stop passing agent secrets as plaintext env (route through K8s Secrets). Add subprocess resource limits or gate untrusted execution to the K8s driver, and add dependency/secret scanning to CI.
- **Files**: services/orchestrator-go/internal/auth/middleware.go, services/orchestrator-go/internal/auth/apikey.go, services/orchestrator-go/internal/api/routes.go, services/orchestrator-go/internal/k8s/job.go, services/orchestrator-go/internal/driver/subprocess.go, services/orchestrator-go/internal/auth/middleware_test.go, .gitlab-ci.yml
- **Branch**: feat/robustness-security
- **Depends on**: plan-mentatlab-feature-robustness-full-stack-vertical-hardening-cc0ae3#3
- **Acceptance**: 1) Per-endpoint scope enforcement: a read-scoped API key is rejected (403) on write endpoints; required scopes defined per route and tested. 2) Agent secrets delivered via K8s Secrets (mounted env/files), not inline plaintext in the Job spec; secret values redacted from logs. 3) Subprocess driver enforces resource limits (cgroup/ulimit) OR untrusted agents are required to run via the K8s driver (documented + enforced). 4) CI adds dependency vulnerability scanning and secret scanning as gates. 5) Existing audit logging confirmed to cover the newly-guarded actions. 6) Scope-enforcement unit tests pass and are wired into CI.
