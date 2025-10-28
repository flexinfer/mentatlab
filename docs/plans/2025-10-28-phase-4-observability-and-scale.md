# Phase 4 — Observability, Scale, and UX Polish (Oct 28, 2025)

Objectives
- Observability: expand metrics and tracing for runs, SSE, and WS paths.
- Scale: tune resources + autoscaling; improve SSE backpressure handling.
- UX polish: streamline Mission Control interactions and docs.

Scope
- Orchestrator
  - Emit Prometheus metrics for run lifecycle, event fanout, per-run queue depth.
  - Add SSE backlog limits and slow-consumer detection; expose counters.
  - Structured logs with execution_id correlation; sampling for verbose paths.
- Gateway
  - Request/response timing histograms for proxied endpoints (/api/v1/agents, /runs, /streams).
  - Cloudflare Access token injection diagnostics (if configured).
- Frontend
  - StatusBar: show SSE reconnects, drops, and p95/avg latency tooltips.
  - GraphPanel: selection-to-console link; minor keyboard shortcuts.
- Kubernetes
  - HPA targets for gateway/orchestrator based on CPU and custom metrics (SSE connections, events/sec).
  - Resource requests/limits review; tolerations/affinity for spread.

Deliverables
- Metrics: new counters/gauges/histograms and dashboards (Grafana jsonnet or JSON).
- Feature flags for enabling advanced telemetry without changing code.
- Docs: runbook for debugging streaming, and a scaling guide.

Validation
- Load test with a synthetic agent emitting events at configurable QPS; verify p95 and reconnects captured.
- Observe HPA reacting to load (scale out/in) without dropped connections.
