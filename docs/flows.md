# MentatLab Flows & Canvas
*Last updated: 2025‑07‑22*

> **TL;DR** A *Flow* is a declarative, Git‑tracked JSON/YAML document (`*.mlab`) that
> 1. lays out **nodes** (agents, tools, data sources, UI widgets)
> 2. connects them with **typed edges** (data, control, event)
> 3. stores **layout hints** so the canvas re‑opens exactly as you left it
> 4. is runnable via `mentatctl run <file>.mlab` or the Play ▶ button in the UI.

---

## 0 Why a Flow Spec?
*Grounding in **§1 Product Vision – Composable Canvas & Configuration **
and **§2 Reference Architecture***

MentatLab’s north star is **“drag, drop, run, iterate.”**
To achieve that we need a portable artefact that:

1. **Describes computation** (what agents run, in what order).
2. **Captures presentation** (pane positions, chat tabs, hidden/expanded nodes).
3. **Round‑trips losslessly** between:
   * Canvas UI ↔ Git‑tracked file (*DevOps*) ↔ REST/GraphQL API (*Programmatic control*).

---

## 1 Flow File Format `*.mlab`

```yaml
apiVersion: v1alpha1           # schema evolves with SemVer
kind: Flow
meta:
  id: demo.echo‑flow           # unique within workspace
  name: "Hello Mentat"
  description: "Prompt → Ollama‑LLM → Console"
  version: 0.1.0
  createdBy: "@flexinfer"
  createdAt: "2025‑07‑22T14:05:00Z"
graph:
  nodes:
    - id: prompt1
      type: ui.prompt          # built‑in text input widget
      position: {x: 120, y: 80}
      outputs:
        text: "Hello, Mentat!"
    - id: llm1
      type: flexinfer.ollama.chat:0.2.1   # Cog‑Pak ref (id:version)
      position: {x: 400, y: 80}
      params: {model: "llama3:8b"}
    - id: console1
      type: ui.console
      position: {x: 680, y: 80}
  edges:
    - from: prompt1.text
      to:   llm1.text
    - from: llm1.text
      to:   console1.text
layout:
  zoom: 0.9
  viewport: {x: 0, y: 0}
runConfig:                    # execution overrides
  maxTokens: 2048
  temperature: 0.7
  secrets: ["OLLAMA_BASE_URL"]

	•	graph.nodes[*].type can reference:
	•	Built‑in UI widgets: ui.prompt, ui.console, ui.chatPanel, …
	•	Cog‑Pak agents: <id>:<version> (see agents.md).
	•	edges use pin‑notation nodeId.pinName.  The linter (Sprint 0) checks type compatibility.
	•	layout persists camera & node positions—ensures WYSIWYG Git diffs.
	•	runConfig allows per‑run overrides without changing each node’s manifest.

A full JSON Schema lives at [`schemas/flow.schema.json`](schemas/flow.schema.json:1) (added during Sprint 0).

⸻

2 Runtime Lifecycle

Hooks into §2 Reference Architecture → Orchestrator & Gateway

sequenceDiagram
    participant UI
    participant Gateway
    participant Orchestrator
    participant K8s
    UI->>Gateway: POST /runs (flow.mlab)
    Gateway->>Orchestrator: enqueueRun(flowHash)
    Orchestrator->>K8s: create Jobs (nodes)
    K8s-->>Orchestrator: Pod status, logs
    Orchestrator-->>UI: WebSocket events
    UI-->>User: Live chat & heat‑map

	•	Granularity – Each agent node maps to one Job/Deployment pod; UI‑only nodes execute in‑browser.
	•	Ordering – The DAG is topologically sorted by the orchestrator; parallel branches run concurrently.
	•	Back‑pressure – Edges are buffered via Redis Streams (Sprint 2).
	•	Redraw – Position changes in the browser raise PATCH /flows/{id}; Git commit hooks format & validate.

⸻

## Execution Modes

Flows can be executed in two primary modes via `POST /flows?mode=<mode>&cron=<cron>`:

- **plan** (default): return the topological execution plan only.
- **redis** (lightweight dev): tasks are published to Redis (`agent_tasks:<agent_id>`) and processed by Redis-based agents; UI events stream via WebSocket on `orchestrator_ui_events`.
- **k8s** (production): schedule a Kubernetes Job per agent via the orchestrator’s **SchedulingService**; supply an optional cron schedule, e.g. `?mode=k8s&cron=0+*+*+*+*`.
⸻

### Execution Modes (status)

| Mode | Status | Notes | API Reference |
|------|--------|-------|---------------|
| plan | done | returns topological execution plan only | POST /runs (mode=plan) |
| redis | in_progress | lightweight dev via Redis streams / agent tasks | POST /runs; GET /runs/{id}/checkpoints; GET /runs/{id}/events |
| k8s | planned | production: schedule a Job per agent | POST /runs?mode=k8s; GET /runs/{id}/checkpoints |

See the Orchestrator API surface in [`docs/orchestrator_design.md`](docs/orchestrator_design.md:1) for endpoint details.

3 Edge Types & Semantics

Edge Kind	Icon	Payload	When to Use
data (default)	→	Arbitrary JSON, blob or binary	Prompt → LLM, CSV → Pipeline
control	⚡	Empty (just a tick)	Event triggers, cron ticks
event	🛈	Structured message {topic, payload}	Kafka‑like broadcast between nodes
chat	💬	{role, content, meta} tokens	Maintains chat transcript consistency

All edge kinds are first‑class in the spec; the heat‑map extension (Vision §1) colours them by throughput (tokens /s).

⸻

4 Canvas UI Anatomy

(Maps to Vision §1 – Chat & Observation Panel)
	•	Graph Pane – React‑Flow instance; edges light up on data transfer.
	•	Inspector Pane – JSON/YAML editor (monaco) for selected node.
	•	Run Panel – Tabs: Logs, Chat, Metrics (powered by Prometheus‑FLAME).
	•	Command Palette – ⌘/Ctrl + K: “Add Node”, “Explain Trace” etc.

Sprint checkpoints:

Sprint	UI Milestone
1	Drag‑drop + Inspector
3	Chat tab w/ token streaming
4	Heat‑map + Metrics tab


⸻

5 Versioning & GitOps

(Relates to Vision §1 – Configuration & Versioning and Practices §5>1)
	•	Immutable flow hash = SHA‑256 of canonicalised JSON.
	•	Store flows/ directory beside code; PR previews auto‑deploy to pr‑###.mentatlab.lan.
	•	Diff Rules – Node position changes are always last in the file → clean review of logic vs layout.

⸻

6 Embedding Flows in Docs & Tickets

Copy any node(s), paste into GitHub Issues/Notion—MentatLab emits a PNG preview + deep‑link (?selection=node123).
Helps design discussions without launching the full app.

⸻

7 Security Notes

All edges respect workspace RBAC (Practices §5>4).
If node A outputs sensitive PII, only downstream nodes owned by an authorised role can wire to it; otherwise the edge linter fails.

⸻

8 CLI Shortcuts

# Dry‑run: validate only, show plan (Terraform‑style)
mentatctl plan flows/hello.mlab

# Run with live logs to console (plan-only)
mentatctl run flows/hello.mlab --follow

# Run in Redis mode (lightweight execution)
mentatctl run flows/hello.mlab --mode redis --follow

# Run in K8s mode (production Jobs)
mentatctl run flows/hello.mlab --mode k8s --follow

# Convert legacy YAML to *.mlab
mentatctl convert legacy_flow.yaml > flows/legacy.mlab


⸻

9 FAQ

<details>
<summary>Do I need to check in layout info?</summary>
Yes.  Visual diffs help reviewers understand **why** a node moved (often correlates with logical rewiring) and enable deterministic heat‑map overlays on re‑open.
</details>


<details>
<summary>Can multiple users edit the same flow in real time?</summary>
Not yet.  Collaborative cursors & conflict‑free merges arrive with the **“Figma‑style live‑cursor”** extension in the *Desirable* column of §1.  Until then, use PRs or branch previews.
</details>


<details>
<summary>How are secrets referenced?</summary>
Add key names under `runConfig.secrets`.  The executor injects them as env‑vars from your sealed‑secrets store.  They **never** live in the `*.mlab` file.
</details>



⸻

10 Road‑map Snapshot (Flows‑Specific)

Release	Highlight	Status
0.1.0 (Sprint 1)	POC JSON export/import	✅ done
0.2.0 (Sprint 2)	DAG execution via Jobs	⏳ in‑progress
0.3.0 (Sprint 3)	Chat panel & WebSocket streaming	🔜
0.4.0 (Sprint 4)	Throughput heat‑map & cost metrics	🚧 planned
0.5.0 (Sprint 5)	Signed *.mlab attestations	🗓 ETA ≈ 8 weeks


⸻

Compose boldly, deploy safely, observe instantly — welcome to MentatLab Flows.

---

### How this closes the gap

* **Front‑end composability** is now front‑and‑centre: the flow file, canvas elements, edge semantics and UI panels are all documented.
* Every section explicitly references the parts of your **original proposal (VISION, ARCH, ROAD‑MAP, PRACTICES)** so newcomers see the lineage from high‑level plan to file‑level reality.
* The file complements—not replaces—`agents.md`, keeping a clean separation of *micro‑level* (Cog‑Pak) and *macro‑level* (Flow).
