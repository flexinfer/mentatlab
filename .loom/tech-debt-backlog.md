# Tech Debt Backlog — Implementation-Ready Slices

Generated: 2026-02-19
Source: `.loom/tech-debt-plan.md` (Wave 1-3)

---

## Wave 1 Slices

### SLICE-001: Fail-fast on Redis connection failure (DEBT-003)

**Problem:** `cmd/orchestrator/main.go:85-86` silently falls back to in-memory store when Redis is unreachable. In production (K8s), this means run state is lost on pod restart with no operator-visible signal beyond a warn-level log line.

**Changes:**
1. `cmd/orchestrator/main.go` — When `ORCH_RUNSTORE=redis`, call `os.Exit(1)` if Redis connection fails. Add `ORCH_ALLOW_MEMORY_FALLBACK=true` env var to preserve current behavior for local dev.
2. `internal/config/config.go` — Add `AllowMemoryFallback bool` field.
3. `internal/metrics/metrics.go` — Add `runstore_fallback_total` counter metric.

**Acceptance Criteria:**
- [ ] `ORCH_RUNSTORE=redis` + unreachable Redis = process exits non-zero
- [ ] `ORCH_ALLOW_MEMORY_FALLBACK=true` preserves current warn-and-continue behavior
- [ ] `runstore_fallback_total` metric incremented on fallback
- [ ] Existing tests pass unchanged

**Test Strategy:** Unit test in `cmd/orchestrator/` with mock Redis client returning connection error.

**Rollback:** Revert commit. No schema changes.

---

### SLICE-002: Remove optional: true from MinIO credentials (DEBT-013)

**Problem:** `k8s/minio.yaml:74-83` marks `minio-credentials` secret reference as `optional: true`. If the secret is missing, MinIO starts with blank root credentials, creating an unauthenticated storage endpoint.

**Changes:**
1. `k8s/minio.yaml` — Remove `optional: true` from both `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` secretKeyRef blocks.
2. Verify `minio-credentials` secret exists in cluster (or add a SealedSecret).

**Acceptance Criteria:**
- [ ] MinIO pod enters CrashLoopBackOff if `minio-credentials` secret is missing
- [ ] MinIO pod starts normally when secret is present
- [ ] No change to orchestrator's dataflow configuration

**Test Strategy:** `kubectl delete secret minio-credentials -n mentatlab` → verify pod fails. Recreate → verify pod starts.

**Rollback:** Re-add `optional: true`. Pod will start with blank creds (worse than failing).

---

### SLICE-003: Replace hardcoded IP in frontend K8s manifest (DEBT-007)

**Problem:** `k8s/frontend.yaml:54` sets `VITE_GATEWAY_BASE_URL=http://192.168.50.244:8080`. This IP is tied to a specific node and breaks if the gateway moves or the cluster is redeployed.

**Changes:**
1. `k8s/frontend.yaml` — Change `VITE_GATEWAY_BASE_URL` to use the ingress hostname (e.g., `https://mentatlab.flexinfer.ai` or gateway service DNS `http://gateway.mentatlab.svc.cluster.local:8080`).
2. If the frontend needs a browser-reachable URL (it does — this is a Vite build-time var), use the ingress URL from `k8s/ingress.yaml`.

**Acceptance Criteria:**
- [ ] No hardcoded IPs in `k8s/` manifests
- [ ] Frontend successfully calls gateway API after deployment
- [ ] Works in both K3s cluster and local dev (docker-compose gateway URL unchanged)

**Test Strategy:** Deploy to K3s. Verify browser console shows no CORS or connection errors to old IP.

**Rollback:** Revert to hardcoded IP. Document correct IP for current cluster.

---

### SLICE-004: Add Redis PVC for data persistence (DEBT-011)

**Problem:** `k8s/redis.yaml` uses `emptyDir: {}` for Redis data. All run state, API keys, and flow data stored in Redis is lost when the pod restarts.

**Changes:**
1. `k8s/redis.yaml` — Replace `emptyDir: {}` with a PVC using `storageClass: longhorn`.
2. Add Redis ConfigMap with `appendonly yes` and `appendfsync everysec`.
3. Mount ConfigMap at `/usr/local/etc/redis/redis.conf` and set container command to `redis-server /usr/local/etc/redis/redis.conf`.

**Acceptance Criteria:**
- [ ] Redis data directory backed by Longhorn PVC
- [ ] `appendonly yes` configured
- [ ] Run state survives `kubectl delete pod redis-xxx -n mentatlab`
- [ ] PVC size: 5Gi (sufficient for metadata-only workload)

**Test Strategy:**
1. Create a run via API
2. `kubectl delete pod redis-xxx -n mentatlab`
3. Verify run is still retrievable via `GET /api/v1/runs`

**Rollback:** Remove PVC, revert to emptyDir. Data will be ephemeral again. Delete orphaned PVC.

---

### SLICE-005: Pin image tags to CI_COMMIT_SHORT_SHA (DEBT-006)

**Problem:** `k8s/kustomization.yaml` uses `newTag: latest` for all images. This creates drift risk — Flux may reconcile with a stale `:latest` that doesn't match the expected commit. The recent fix (bbac64c) switched to `:latest` because SHA tags were unreliable, indicating a deeper build pipeline issue.

**Changes:**
1. `.gitlab-ci.yml` deploy stage — Set image tags to `CI_COMMIT_SHORT_SHA` via `kustomize edit set image`.
2. `k8s/kustomization.yaml` — Change `newTag: latest` to `newTag: v0.0.0-placeholder` (CI overrides, Flux never uses placeholder).
3. `.gitlab-ci.yml` build stage — Ensure both `SHA` and `latest` tags are pushed (BuildKit multi-name push). Debug why SHA tags were unreliable in bbac64c.
4. K8s deployments — Change `imagePullPolicy: Always` to `imagePullPolicy: IfNotPresent` for SHA-tagged images.

**Acceptance Criteria:**
- [ ] Deploy stage sets image tags to `CI_COMMIT_SHORT_SHA`
- [ ] Both `:latest` and `:$SHA` tags are verifiable in Harbor after build
- [ ] K8s pods run images matching the deployed commit SHA
- [ ] `imagePullPolicy: IfNotPresent` for SHA-tagged images

**Test Strategy:** Run CI pipeline on branch. Verify Harbor has both tags. Deploy and `kubectl describe pod` to confirm image SHA.

**Rollback:** Revert kustomization.yaml to `newTag: latest`. Revert imagePullPolicy to `Always`.

---

### SLICE-006: Add tests for auth, driver, dataflow, config packages (DEBT-002)

**Problem:** Four orchestrator packages covering security-critical and execution-critical paths have zero test coverage: `auth/` (API key store, OIDC middleware, rate limiter), `driver/` (subprocess + K8s execution), `dataflow/` (S3 artifact storage), `config/` (env var loading).

**Changes:**
1. `internal/auth/apikey_test.go` — Test API key creation, validation, revocation, Redis store operations.
2. `internal/auth/oidc_test.go` — Test OIDC middleware with mock token server.
3. `internal/auth/ratelimit_test.go` — Test per-IP rate limiting (allow, deny, expiry).
4. `internal/driver/subprocess_test.go` — Test process launch, output capture, cancellation, timeout.
5. `internal/driver/k8s_test.go` — Test job manifest generation, status polling (mock K8s client).
6. `internal/dataflow/s3_test.go` — Test upload/download with mock S3 client (aws-sdk-go-v2 mock).
7. `internal/config/config_test.go` — Test env var parsing, defaults, validation.

**Acceptance Criteria:**
- [ ] Each package has at least one `_test.go` file
- [ ] `go test -cover ./internal/auth/...` reports >60%
- [ ] `go test -cover ./internal/driver/...` reports >60%
- [ ] `go test -cover ./internal/dataflow/...` reports >60%
- [ ] `go test -cover ./internal/config/...` reports >60%
- [ ] All tests pass in CI (`test-go` stage)

**Test Strategy:** Unit tests with interfaces/mocks for external dependencies (Redis, K8s API, S3). No integration test dependencies.

**Rollback:** Tests are additive — no rollback needed.

---

## Wave 2 Slices

### SLICE-007: Add gateway test coverage (DEBT-010) ✅ DONE

**Problem:** Gateway has 4 test files for 16 Go source files. The `metrics/`, `traces/`, and `tracing/` packages plus WebSocket hub edge cases are untested.

**Changes delivered:**
1. `middleware/errors_test.go` — Tests for GetRequestID, RespondError, RespondErrorWithDetails, HTTPStatusToErrorCode
2. `middleware/logging_test.go` — Tests for request ID generation/propagation, skip paths, path normalization, log content
3. `middleware/tracing_test.go` — Tests for enabled/disabled tracing middleware behavior
4. `traces/handler_test.go` — Tests for GetTrace, QueryTraces, lookupTraceID header forwarding, error paths
5. `tracing/tracing_test.go` — Tests for DefaultConfig, Init (enabled/disabled), Shutdown, TracerProvider
6. `tracing/tracing.go` — Fixed resource.Merge schema URL conflict (v1.37.0 vs v1.26.0)

**Coverage achieved:**
- hub: 65.9% | middleware: 69.5% | traces: 81.8% | tracing: 89.3%

**Acceptance Criteria:**
- [x] Gateway `go test -cover ./...` reports >50% (all packages >65%)
- [x] Hub concurrency tested (register/deregister under load) — pre-existing in hub_test.go
- [ ] All tests pass in CI (pending push)

**Test Strategy:** Unit tests with httptest for HTTP handlers, mock HTTP servers for Tempo/orchestrator.

**Rollback:** Tests are additive.

---

### SLICE-008: Split handlers.go into domain files (DEBT-001)

**Problem:** `services/orchestrator-go/internal/api/handlers.go` is 1,216 lines containing all HTTP handlers. Code review, navigation, and testing are difficult.

**Changes:**
1. Extract run-related handlers → `handlers_runs.go`
2. Extract agent-related handlers → `handlers_agents.go`
3. Extract flow-related handlers → `handlers_flows.go`
4. Extract schedule/cron handlers → `handlers_schedules.go`
5. Extract webhook handlers → `handlers_webhooks.go`
6. Keep shared types/helpers in `handlers.go` (should be <200 lines)

**Acceptance Criteria:**
- [ ] No file in `internal/api/` exceeds 300 lines
- [ ] No public API signatures changed
- [ ] All existing handler tests pass without modification
- [ ] `go vet ./...` clean

**Test Strategy:** Run existing test suite. Verify no import cycles.

**Rollback:** Revert commit. Single-file version is functional.

---

### SLICE-009: Split scheduler.go into focused files (DEBT-008)

**Problem:** `services/orchestrator-go/internal/scheduler/scheduler.go` is 1,028 lines mixing DAG execution, retry logic, gate handling, and event emission.

**Changes:**
1. Extract retry backoff logic → `retry.go`
2. Extract gate approval/rejection → `gate.go` (if not already separate)
3. Extract event emission helpers → `events.go`
4. Core DAG walk remains in `scheduler.go` (<400 lines)

**Acceptance Criteria:**
- [ ] `scheduler.go` under 400 lines
- [ ] No exported API changes
- [ ] All scheduler tests pass
- [ ] `go vet ./...` clean

**Test Strategy:** Existing scheduler tests provide safety net. Run before and after split.

**Rollback:** Revert commit.

---

### SLICE-010: Add circuit breaker for Redis and K8s clients (DEBT-015)

**Problem:** `runstore/redis.go` and `driver/k8s.go` make calls to external services without circuit breaker protection. If Redis or K8s API degrades, the orchestrator can cascade failures to all in-flight runs.

**Changes:**
1. Add `sony/gobreaker` dependency.
2. `internal/runstore/redis.go` — Wrap Redis calls with circuit breaker. Open after 5 consecutive failures. Half-open after 30s.
3. `internal/driver/k8s.go` — Wrap K8s API calls with circuit breaker.
4. `internal/metrics/metrics.go` — Add `circuit_breaker_state{backend="redis|k8s"}` gauge.

**Acceptance Criteria:**
- [ ] Redis circuit breaker opens after 5 consecutive failures
- [ ] K8s circuit breaker opens after 5 consecutive failures
- [ ] `circuit_breaker_state` metric exposed on `/metrics`
- [ ] Load test (k6) validates circuit breaker behavior under degraded Redis

**Test Strategy:** Unit tests with mock clients that return errors. Verify state transitions.

**Rollback:** Remove gobreaker. Direct calls resume. No data impact.

---

### SLICE-011: Increase frontend test coverage to >60% (DEBT-005)

**Problem:** Frontend has 38 test files for 186 source files (~20% file coverage). Critical UI components and service integrations are untested.

**Changes (prioritized by complexity/risk):**
1. `MissionControlLayout.test.tsx` — Panel rendering, toggle behavior, dark mode
2. `ConsolePanel.test.tsx` — Event rendering, filtering, scroll behavior
3. `NetworkPanel.test.tsx` — Node rendering, agent status display
4. `services/api/*.test.ts` — API client methods, error handling
5. `stores/streaming/*.test.ts` — Session management, event batching

**Acceptance Criteria:**
- [ ] `npm test -- --coverage` reports >60% statement coverage
- [ ] Top-5 largest untested components have test files
- [ ] API service layer has >80% coverage

**Test Strategy:** Vitest + React Testing Library. Mock API responses. Snapshot tests for layout components.

**Rollback:** Tests are additive.

---

## Wave 3 Slices

### SLICE-012: Remove legacy store re-exports (DEBT-014)

**Problem:** `stores/index.ts:122-129` maintains legacy aliases (`useCanvasStore as useReactFlowStore`) and dual API surface (`LegacyStreamSession`).

**Changes:**
1. Search all imports of `useReactFlowStore` and replace with `useCanvasStore`.
2. Search all imports of `LegacyStreamSession` and migrate to `StreamSession`.
3. Remove legacy re-exports and adapter types from `stores/index.ts`.

**Acceptance Criteria:**
- [ ] No `useReactFlowStore` imports in codebase
- [ ] No `LegacyStreamSession` references
- [ ] `npm run lint` and `npm test` pass

**Test Strategy:** Global search-and-replace. Run full test suite.

**Rollback:** Revert commit.

---

### SLICE-013: Extract AuthProvider interface from gateway (DEBT-009)

**Problem:** `middleware/auth.go` (391 lines) hard-couples Cloudflare Access JWT validation into the auth middleware, making it impossible to test without Cloudflare or swap providers.

**Changes:**
1. Define `AuthProvider` interface: `Authenticate(r *http.Request) (*UserIdentity, error)`
2. Implement `CloudflareAccessProvider` (existing logic extracted)
3. Implement `NoopProvider` (for dev/testing)
4. `main.go` selects provider based on config

**Acceptance Criteria:**
- [ ] `AuthProvider` interface defined
- [ ] Cloudflare logic encapsulated in one provider
- [ ] Middleware works with any provider implementation
- [ ] Tests use NoopProvider

**Test Strategy:** Unit tests with NoopProvider. Integration test stub for Cloudflare provider.

**Rollback:** Revert commit. Cloudflare remains directly embedded.

---

### SLICE-014: Reduce 'any' type usage below 50 (DEBT-004)

**Problem:** 457 occurrences of `any` type across the frontend, concentrated in api-integration.ts, streaming types, store actions, and graph types.

**Changes (incremental):**
1. `types/streaming.ts` — Define discriminated union for SSE event types (run_status, node_status, log, output, error)
2. `types/api-integration.ts` — Type the 5 functions currently using `any` parameters
3. `stores/layout/index.ts` — Type store action creators
4. `types/graph.ts` — Replace `any[]` enum with proper union types
5. Enable `noImplicitAny` in `tsconfig.json`

**Acceptance Criteria:**
- [ ] `grep -r ': any' src/ | wc -l` < 50
- [ ] `noImplicitAny: true` in tsconfig
- [ ] `npm run lint` passes
- [ ] All tests pass

**Test Strategy:** TypeScript compiler catches regressions. Run `npm run lint` after each file.

**Rollback:** Revert tsconfig change. Individual type fixes are safe.

---

### SLICE-015: Split large frontend components (DEBT-012)

**Problem:** 7 components exceed 380 lines (up to 777), making review, testing, and maintenance difficult.

**Changes (prioritized by size):**
1. `NetworkPanel.tsx` (777 lines) → extract `AgentStatusCard`, `MetricsOverview`, `NodeTooltip`
2. `MissionControlLayout.tsx` (529 lines) → extract `PanelContainer`, `ToolbarSection`, `LayoutProvider`
3. `LineageOverlay.tsx` (430 lines) → extract `LineageGraph`, `ArtifactCard`
4. Remaining files → defer to follow-up PR

**Acceptance Criteria:**
- [ ] No component file exceeds 250 lines
- [ ] Extracted components have explicit props interfaces
- [ ] Visual behavior unchanged (manual verification)
- [ ] Existing tests pass

**Test Strategy:** Visual regression (screenshot comparison). Add tests for extracted components.

**Rollback:** Revert commits. Monolithic files are functional.

---

### SLICE-016: Add Docker Compose health checks (DEBT-016)

**Problem:** `docker-compose.dev.yml` services lack healthcheck blocks. Dev services can fail silently or consume unlimited resources.

**Changes:**
1. Add `healthcheck` blocks to gateway, orchestrator, redis, frontend services
2. Add `deploy.resources.limits` for CPU/memory
3. Add `depends_on` conditions for service startup order

**Acceptance Criteria:**
- [ ] All services have healthcheck in docker-compose.dev.yml
- [ ] `docker-compose ps` shows health status
- [ ] Services start in correct order

**Test Strategy:** `docker-compose up -d && docker-compose ps` — all services show "healthy".

**Rollback:** Remove healthcheck blocks. No impact on functionality.
