# Demo Script — Orchestrator + Mission Control Runs Panel

Purpose
- Provide a 5–10 minute guided demo to validate the orchestrator REST/SSE integration via the Mission Control UI Runs panel.
- Covers: create run, connect SSE with replay, post checkpoint, cancel run, and plan-mode JSON viewer.
- Produces screenshots/GIFs for documentation.

Prerequisites
- Docker & Docker Compose installed
- Node.js (v18+) and npm (for running the frontend)
- Optional: Redis is included in compose for the orchestrator persistence

Environment setup
- Frontend reads the orchestrator URL from Vite env. Create a .env.local in the frontend folder:

```ini
# services/frontend/.env.local
VITE_ORCHESTRATOR_URL=http://localhost:7070
VITE_FF_ORCHESTRATOR_PANEL=true
# Optional (if EnhancedStream/WS features are present elsewhere)
# VITE_CONNECT_WS=false
```

- Ensure CORS allows the Vite origin (http://localhost:5173) on the orchestrator or use permissive defaults for local dev.

Start services

Option A — Docker Compose (recommended)
```bash
# from repository root
docker-compose up --build orchestrator redis
# orchestrator: http://localhost:7070
```

Option B — Local Node dev for orchestrator
```bash
cd services/orchestrator
npm install
npm run dev
# orchestrator: http://localhost:7070
```

Start frontend (Vite)
```bash
cd services/frontend
npm install
npm run dev
# frontend: http://localhost:5173
```

Quick readiness checks (orchestrator)
- Ready: http://localhost:7070/ready
- Health: http://localhost:7070/health
- Metrics: http://localhost:7070/metrics

Demo flow (UI) — Runs panel
- Where to click:
  1) Open the app at http://localhost:5173
  2) In Mission Control, bottom dock → select the “Runs” tab (enable ORCHESTRATOR_PANEL via [services/frontend/src/config/features.ts](services/frontend/src/config/features.ts:1) or .env.local)
  3) Use the dropdown to pick mode (redis or k8s)

Step 1 — Create a run
- Click “Create Run”
- Expected: runId appears in the input; “Run:” line shows “[id] — [mode] — pending”
- A toast may display “Run created”

Step 2 — Connect to SSE
- Click “Connect”
- Expected:
  - SSE badge turns green (connected)
  - Initial “hello” event toast logs the runId
  - No checkpoints yet unless something already emitted

Step 3 — Post a checkpoint
- Click “Post progress checkpoint”
- Expected:
  - Checkpoints list shows a new “progress” item with ts and id
  - List auto-scrolls to latest
  - “Export checkpoints (JSON)” becomes enabled

Step 4 — Cancel the run
- Click “Cancel run”
- Expected:
  - Run status changes to canceled (and a toast confirms)
  - A “status” SSE event is received and reflected in the UI

Step 5 — Replay verification
- Refresh the page (Cmd/Ctrl+R)
- Enter same runId (if not already populated) and click “Connect”
- Expected:
  - With replay=10 default, recent checkpoints re-emit on connect and appear in list
  - Hello/status events display as appropriate

Plan mode (optional)
- In mode dropdown select “plan”, then “Create Run”
- Expected:
  - Plan JSON renders inline (collapsible block)
  - “Copy plan” and “Dismiss” actions work
- Note: In plan mode, some servers may still return runId; the UI tolerates both but focuses on plan display.

CLI verification (optional)

Set the runId produced by the UI:
```bash
RUN_ID="<your-run-id>"
```

- Get a run:
```bash
curl "http://localhost:7070/runs/${RUN_ID}"
```

- Post a checkpoint:
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"type":"progress","data":{"percent":33}}' \
  "http://localhost:7070/runs/${RUN_ID}/checkpoints"
```

- Stream SSE (replay last 10):
```bash
curl --no-buffer "http://localhost:7070/runs/${RUN_ID}/events?replay=10"
```

- Cancel a run:
```bash
curl -X DELETE "http://localhost:7070/runs/${RUN_ID}"
```

- Resume with Last-Event-ID:
```bash
LAST_TS="2025-01-01T12:34:56.789Z"   # some checkpoint ts you saw earlier
curl --no-buffer -H "Last-Event-ID: ${LAST_TS}" "http://localhost:7070/runs/${RUN_ID}/events"
```

Artifacts to capture (screenshots/GIFs)
- Place files under docs/assets/ui/:
  - orchestrator-runs-tab.png — Runs tab visible in the bottom dock
  - orchestrator-sse-connected.png — SSE badge green and connected
  - orchestrator-checkpoint-list.png — Checkpoints list with at least one progress item
  - orchestrator-cancel-transition.png — Run showing canceled status
  - orchestrator-sse-replay.gif — Short GIF demonstrating refresh + replay
- The docs reference section will embed these if present. See [docs/references/frontend-orchestrator.md](docs/references/frontend-orchestrator.md:1)

Troubleshooting
- CORS:
  - Ensure orchestrator CORS allows http://localhost:5173 (Vite) or keep permissive defaults for local
- Auth:
  - EventSource cannot add custom headers; disable ORCHESTRATOR_API_KEY in local dev or use cookie-based auth
- No SSE events:
  - Check orchestrator logs and /ready endpoint, confirm docker-compose health checks are green
  - Verify the runId used matches the run you created

Definition of Done (acceptance criteria)
- UI
  - Create run updates the Run section with id/mode/status
  - Connect shows SSE connected; hello/status/checkpoint events appear in real time
  - Cancel transitions to canceled and emits a status event reflected in the UI
  - Replay: after refresh, connecting with same runId shows recent checkpoints (replay)
  - Plan mode: plan JSON renders with copy/dismiss actions
- Docs
  - This walkthrough can be completed end-to-end in <10 minutes on a clean machine
  - Screenshots/GIFs captured and saved under docs/assets/ui/ (file names listed above)
- Optional (CLI parity)
  - All curl commands succeed against local orchestrator