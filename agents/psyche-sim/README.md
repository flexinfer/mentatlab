Psyche‑Sim Cog‑Pak (scaffold)
=============================

Overview
--------
This directory contains a minimal Cog‑Pak scaffold inspired by the Psyche Simulation. It's intended as a starter agent that follows MentatLab conventions:

- Manifest: manifest.yaml
- Source: src/main.py (stdin→stdout contract)
- Dockerfile: builds a minimal runtime image
- Lifecycle hooks: prestart.sh and health.sh (stubs)

Development
-----------
Run locally (manual test):

echo '{"spec":{"prompt":"Hello from MentatLab"},"context":{}}' | python src/main.py

This should emit a single-line JSON object with "result" and "mentat_meta".

Packaging & Publishing
---------------------
- Build the image: docker build -t your-registry/mentatlab/psyche-sim:0.1.0 .
- Push: docker push your-registry/mentatlab/psyche-sim:0.1.0
- Update manifest.yaml image field before publishing.

MentatLab integration
---------------------
- The agent manifest is intended for use with MentatLab's orchestrator.
- Validate the manifest using the orchestrator's /agents/validate endpoint or via local CI (lint‑agents).
- Run locally via mentatctl dev run (future; implement mentatctl support if needed).

Frontend integration
--------------------

This Cog‑Pak includes a minimal frontend entry to let the MentatLab web UI list and run the agent.

- Manifest: `manifest.yaml` contains a `ui` block with `remoteEntry: "agents/psyche-sim/ui/remoteEntry.js"`, `title`, `description` and `catalog` metadata.
- Remote entry: `agents/psyche-sim/ui/remoteEntry.js` is a tiny standalone script that exposes a `mount(container, runHandler)` function. The frontend can load this remote entry and mount the agent UI into the catalog. When mounted the UI shows a Run button which will:
  - call a frontend-provided `runHandler(spec)` if present (recommended), or
  - fall back to POSTing a schedule request to `/agents/schedule` (less ideal; requires the manifest to be provided to the orchestrator).

How to make the agent appear in the frontend catalog (developer workflow)
1. Ensure the frontend reads agent manifests at startup or when the catalog refreshes. The frontend should read `manifest.yaml` and register any agents where `ui.catalog.visible: true`.
2. The frontend should use the `ui.remoteEntry` URL from the manifest to load the remoteEntry module and call `mount()` to render the agent UI.
3. Provide a `runHandler(spec)` implementation in the frontend that:
   - POSTs the agent manifest and inputs to `/agents/schedule`, or
   - uses the frontend's API to schedule runs (so the remoteEntry's fallback isn't required).

Run the agent locally (dev)
- Quick streaming test (headless, no orchestrator):
  echo '{"spec":{"prompt":"System status check","mode":"stream","chunk_delay":0.04,"agent_id":"mentatlab.psyche-sim"},"context":{}}' | python3 agents/psyche-sim/src/main.py
  This emits NDJSON streaming messages to stdout (text:stream, progress, stream:status, stream_end), followed by the final single-line JSON result. Use this for quick UI integration tests: have your frontend run the process locally and stream stdout into the UI.

Build and run via Orchestrator (dev)
1. Build the local image (already performed during this task):
   docker build -t mentatlab/psyche-sim:local-dev agents/psyche-sim
2. Start the Orchestrator locally (if not running):
   pdm run uvicorn services.orchestrator.app.main:app --reload
3. In the frontend (or via curl), schedule the agent:
   POST /agents/schedule with a JSON body containing:
   {
     "agent_manifest": <contents of agents/psyche-sim/manifest.yaml>,
     "inputs": {
       "spec": { "prompt": "...", "mode":"stream", "chunk_delay": 0.06, "agent_id": "mentatlab.psyche-sim" },
       "context": {}
     },
     "execution_id": "your-execution-id",
     "skip_validation": false
   }
   The orchestrator should return {"resource_id":"...","status":"scheduled"} and the agent's streaming output will be visible in orchestrator logs or forwarded through the gateway/streaming pipeline if configured.

Notes and next steps
- Frontend integration is the most robust path: implement a frontend runHandler which:
  1. POSTs the agent manifest + inputs to /agents/schedule
  2. Subscribes to the streaming gateway / WebSocket using the returned stream id
  3. Forwards incoming streaming messages into the mounted remoteEntry via `appendLine()` or a more structured renderer
- For production, add CORS, auth, and proper static hosting of `remoteEntry.js` via the frontend asset pipeline or a CDN.
- I added the Dockerfile change so the image contains the `ui/remoteEntry.js` (useful when distributing the image as a package).

Notes
-----
This scaffold is intentionally minimal. Extend `src/main.py` to implement the actual Psyche logic (LLM calls, Redis caching, etc.) and add required dependencies to a `requirements.txt` as needed.