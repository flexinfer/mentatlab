# mentatlab

MentatLab is mission control for composable AI—design, launch and monitor intelligent agents with the discipline of a scientist and the intuition of a Mentat.

The documents below spell out the composable‑frontend contract: how multiple agents, chat panels and runtime tasks are wired together on the canvas, stored in Git, and executed by the backend.  It is tightly cross‑referenced to the Product Vision, Architecture and Road‑map sections you provided, so contributors can see exactly where the “glue” lives.

    •	docs/agents.md → how to create a single Lego brick (a Cog‑Pak).
    •	docs/flows.md (below) → how to snap many bricks together into a live, observable workspace.

## Mission Control UI

After starting the frontend dev server, the default route loads the new Mission Control UI shell.

- Default: [services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx)
- Routes:
  - Mission Control (default): [/](services/frontend/src/App.tsx:120)
  - Streaming View: [/streaming](services/frontend/src/App.tsx:121)
  - Legacy Builder: removed as of Oct 28, 2025

Quick start:

- Start frontend: `npm run dev` in [services/frontend](services/frontend/README.md:1)
- Open the app at the dev URL (Vite default: http://localhost:5173/)
- The canvas-first Mission Control layout loads with:
  - Canvas center (StreamingCanvas)
  - RightDock (Inspector, Media Preview)
  - BottomDock (Console, Run Queue, Timeline, Issues)
  - StatusBar (flags and connection state)

Feature flags (Vite):

- Declared in [services/frontend/src/config/features.ts](services/frontend/src/config/features.ts:1)
- MULTIMODAL_UPLOAD toggles pin-level upload affordances
- NEW_STREAMING enables streaming overlays and timeline tab
- S3_STORAGE enables reference-based media handling

## Local Development Setup

To set up the MentatLab project locally, follow these steps:

### Prerequisites

- Docker and Docker Compose
- Node.js (v18 or higher)
- Python (v3.9 or higher)
- npm (Node Package Manager)
- pip (Python Package Installer)

### 1. Clone the Repository

```bash
git clone https://github.com/your-repo/mentatlab.git
cd mentatlab
```

### 2. Build and Push Docker Images

Use the `build-and-push.sh` script to build Docker images for all services and push them to a container registry. You can specify the registry target using the `--registry` flag.

```bash
# Example: Build and push to a local registry or Docker Hub
./build-and-push.sh --registry your-docker-registry.example.com
```

Replace `your-docker-registry.example.com` with your desired container registry. If you are using Docker Hub, it would typically be your Docker Hub username (e.g., `your-username`).

### 3. Run Services Locally (using Docker Compose - assuming a docker-compose.yml exists)

If you have a `docker-compose.yml` file, you can bring up all services using:

```bash
docker-compose up --build
```

### 4. Individual Service Setup (if not using Docker Compose)

#### Frontend (UI)

```bash
cd services/frontend
npm install
npm run dev
```

#### Orchestrator

Option A — Recommended (Docker Compose)

```bash
# from repository root
docker-compose up --build orchestrator redis
```

Option B — Local Python (dev)

```bash
cd services/orchestrator
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Notes:

- For local browser-based SSE testing use the Vite frontend dev server (http://localhost:5173) and ensure CORS allows that origin or run without ORCHESTRATOR_API_KEY in dev.

Run stack:

```bash
# from repository root
docker compose up --build
```

Open the app:

- Frontend: http://localhost:5173

Service healthchecks:

- Gateway: http://localhost:8080/healthz
- Orchestrator: http://localhost:7070/healthz

Frontend configuration for CogPaks (agents) list:

- The UI calls the orchestrator at `/api/v1/agents`.
- In dev (`vite dev`), `/api` is proxied to the orchestrator; set `VITE_PROXY_TARGET` if needed.
- In preview/production (`vite build` + `vite preview`), there is no proxy. Make sure the build embeds an orchestrator base URL via `VITE_ORCHESTRATOR_URL` (Docker Compose passes this as a build arg by default).

Create a run (via Gateway → Orchestrator):

```bash
curl -X POST http://localhost:8080/api/v1/runs \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "demo",
    "plan": {
      "nodes": [
        {"id":"n1","agent":"echo","params":{"args":["Hello"]}}
      ],
      "edges":[]
    }
  }'
```

Stream events (supports Last-Event-ID resume):

```bash
# replace <runId> with the returned id from create run
curl -N http://localhost:8080/api/v1/runs/<runId>/events
# to resume from event id 0 (example)
curl -N -H 'Last-Event-ID: 0' http://localhost:8080/api/v1/runs/<runId>/events
```

Notes:

- Redis is optional for the Orchestrator. Default runstore is in‑memory. To enable Redis persistence set:
  - `ORCH_RUNSTORE=redis`
  - `REDIS_URL=redis://redis:6379/0`
- Images are production‑like (no dev hot reload). Compose healthchecks ensure service readiness before dependents start.
