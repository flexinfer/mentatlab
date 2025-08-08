# MentatLab Architecture (Mission Control–First)

This document describes the target system architecture aligned to the MVP roadmap and the Mission Control–first UX.

High-Level Diagram (Text)
- Client (Web UI)
  • Mission Control canvas (ReactFlow)
  • Overlays: Contracts, Lineage, Experiments
  • Panels: Console, Issues, Timeline
  • Status Bar: QoS/WS/Flags
  • Store: Zustand-backed app state
  → Communicates via HTTPS/WS to Backend Gateway

- Backend
  • Gateway: AuthN/Z, request shaping, policy ingress/egress
  • Orchestrator: DAG planner, run coordinator, variant strategies (A/B, canary)
  • Recorder: Flight recorder (runs, checkpoints, console events)
  • Observability: traces/metrics/logs, KPI aggregation
  • Lineage: provenance store keyed by lineage refs
  • Policy & Cost: rule evaluation, budget envelopes, remediation hints

- SDKs/Workers
  • Emits checkpoints/spans/lineage tags
  • Adapters for contract quick‑fixes

Data Flow (Simplified)
1) Graph edited in UI; contract linter validates pins/edges and renders overlay hints.
2) Run started → Orchestrator executes DAG; SDKs/Workers emit checkpoints/spans.
3) Recorder buffers run events; Observability aggregates KPIs; Lineage captures provenance refs.
4) UI polls/streams events, updates Console + Timeline; overlays decorate canvas with status.
5) Policy/Cost engines evaluate guardrails; UI surfaces explanations and remediation.

Frontend Architecture
- Frameworks
  • React + ReactFlow for canvas interactions
  • Zustand for global state
  • Tailwind with CSS tokens for theming
- Key UI Surfaces (code anchors)
  • Mission Control layout: [MissionControlLayout.tsx](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx)
  • Contract overlay: [ContractOverlay.tsx](services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx)
  • Console panel: [ConsolePanel.tsx](services/frontend/src/components/mission-control/panels/ConsolePanel.tsx)
  • Issues panel: [IssuesPanel.tsx](services/frontend/src/components/mission-control/panels/IssuesPanel.tsx)
  • Flow canvas: [FlowCanvas.tsx](services/frontend/src/components/FlowCanvas.tsx)
  • Theme tokens: [index.css](services/frontend/src/index.css)
  • Feature flags: [features.ts](services/frontend/src/config/features.ts)
  • Linter services: [services.ts](services/frontend/src/services/mission-control/services.ts)
  • Types: [types/index.ts](services/frontend/src/types/index.ts)
  • Store: [store/index.ts](services/frontend/src/store/index.ts)

Overlays & Panels (Phase 1 emphasis)
- Contract Overlay
  • Validates node pin contracts and edge type compatibility
  • Renders badges and tooltips with quick‑fix CTAs
  • Sources rules from FlowLinterService
- Console Panel
  • Streams/polls recorder events for the active run
  • Filters by level/component; correlates with timeline selection
- Timeline
  • Displays checkpoints along a scrubber
  • Selecting a checkpoint scrolls and focuses Console; prepares replay concept
- Issues Panel
  • Aggregates linter/policy issues; bubbles counts to layout badges
- Status Bar
  • WS health, feature flags summary, and QoS p95 latency with R/Y/G thresholds

Backend Surfaces (Conceptual)
- Gateway
  • Auth, RBAC, request shaping, rate limiting
  • Policy ingress/egress enforcement (e.g., safety filters)
- Orchestrator
  • DAG planner, execution runtime, retries
  • Variant strategies (A/B fixed split, canary time-slice)
  • Emits run/step events to Recorder
- Flight Recorder
  • Append-only store of runs, checkpoints, and console events
  • Query APIs: listRuns, listCheckpoints, streamEvents
- Observability
  • Trace ingestion (OTel-lite), metrics, logs
  • KPI registry and aggregations
- Lineage/Provenance
  • Artifact identities and parentage from emitted provenance refs
  • Subgraph materialization for lineage overlay
- Policy & Cost
  • Pre-flight envelopes; budget guardrails
  • “Explain why blocked” with remediation hints

Core Data Model (MVP)
- Graph
  • Flow(id, name, version)
  • Node(id, type, inputs[], outputs[], config)
  • Edge(id, from:PinRef, to:PinRef)
  • PinRef(nodeId, portKey, contract)
- Contracts
  • Contract(type, shape, constraints, version)
  • Violation(pinRef, expected, actual, ruleId, fixHints[])
- Runs & Checkpoints
  • Run(id, flowId, variant?, createdAt, status, kpis)
  • Checkpoint(id, runId, nodeId?, label, t, artifactRef?)
  • ConsoleEvent(runId, t, level, message, attrs)
- Lineage
  • ArtifactRef(kind, hash|uri, meta)
  • Provenance(link: parent→child, op, params)
- Observability
  • Span(traceId, spanId, parentId, attrs, status)
  • Metric(name, ts, value, dims)
  • Log(ts, level, message, fields)

Contract Linting and Quick‑Fixes
- Validation lifecycle
  • On graph edit, linter recomputes violations for changed nodes/edges/pins
  • Violations rendered as overlay badges and Issues list
- Quick‑fixes
  • Adapter insertion (e.g., json→text)
  • Rewire to compatible pin
  • Set missing timeout/config defaults
- Services
  • FlowLinterService rules (no-edges, isolated-node, no-timeout, untyped-pin, fanout-high)
  • Fix descriptors surfaced to UI for “Apply fix” CTA
- Code anchor: [services.ts](services/frontend/src/services/mission-control/services.ts)

Flight Recorder and Timeline
- Recorder accepts run/step events; persists checkpoints and console logs
- UI Timeline queries listCheckpoints(runId), streams events
- Selecting checkpoint correlates to console slice; prepares replay
- Console virtualization recommended for large runs

Observability and KPIs
- Spans correlated by flowId/runId/nodeId + checkpoint ids
- KPIs (latency, cost, quality score) aggregated per run and variant
- Status bar displays p95 latency vs thresholds; experiments tab compares variants

Policy and Cost Envelopes
- Ingress/egress safety nodes enforce constraints
- Pre-flight budget envelopes projected from graph
- Violations produce overlay badges with explanations and remediation

Feature Flags (initial)
- CONTRACT_OVERLAY: enable contract overlay and quick‑fix CTAs
- CONNECT_WS: toggle realtime vs polling
- EXPERIMENTS, LINEAGE, POLICY_GUARDRAILS: staged rollouts

Security & Privacy Considerations
- Principle of least privilege for Gateway/Orchestrator
- PII tagging in artifacts with policy enforcement
- Log/trace redaction at source; lineage metadata minimal by default

Performance Considerations
- Overlay virtualization and debounced linting on edits
- Timeline/Console virtualization and windowed queries
- Canvas render budget target ≤16ms/frame on medium graphs

Open Questions (to refine post‑MVP)
- Adapter catalog format and packaging
- Replay determinism guarantees and cache strategy
- KPI plugin interface and baseline comparison semantics

References
- Mission Control layout: [MissionControlLayout.tsx](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx)
- Contract overlay: [ContractOverlay.tsx](services/frontend/src/components/mission-control/overlays/ContractOverlay.tsx)
- Console panel: [ConsolePanel.tsx](services/frontend/src/components/mission-control/panels/ConsolePanel.tsx)
- Issues panel: [IssuesPanel.tsx](services/frontend/src/components/mission-control/panels/IssuesPanel.tsx)
- Flow linter service: [services.ts](services/frontend/src/services/mission-control/services.ts)
- Store/types/theme: [store/index.ts](services/frontend/src/store/index.ts), [types/index.ts](services/frontend/src/types/index.ts), [index.css](services/frontend/src/index.css)
- Roadmap: [mvp-roadmap.md](docs/mvp-roadmap.md)
- Overview: [overview.md](docs/overview.md)