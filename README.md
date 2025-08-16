# mentatlab
MentatLab is mission control for composable AI—design, launch and monitor intelligent agents with the discipline of a scientist and the intuition of a Mentat.

The documents below spell out the composable‑frontend contract: how multiple agents, chat panels and runtime tasks are wired together on the canvas, stored in Git, and executed by the backend.  It is tightly cross‑referenced to the Product Vision, Architecture and Road‑map sections you provided, so contributors can see exactly where the “glue” lives.

	•	docs/agents.md → how to create a single Lego brick (a Cog‑Pak).
	•	docs/flows.md (below) → how to snap many bricks together into a live, observable workspace.

## Mission Control UI

After starting the frontend dev server, the default route loads the new Mission Control UI shell.

- Default: [services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx](services/frontend/src/components/mission-control/layout/MissionControlLayout.tsx)
- Routes:
  - Mission Control (default): [/](services/frontend/src/App.tsx:157)
  - Streaming View: [/streaming](services/frontend/src/App.tsx:160)
  - Legacy Builder (deprecated): [/legacy](services/frontend/src/App.tsx:161)

Quick start:
- Start frontend: `npm run dev` in [services/frontend](services/frontend/README.md:1)
- Open the app at the dev URL (Vite default: http://localhost:5173/)
- The canvas-first Mission Control layout loads with:
  - Canvas center (FlowCanvas)
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

*   Docker and Docker Compose
*   Node.js (v18 or higher)
*   Python (v3.9 or higher)
*   npm (Node Package Manager)
*   pip (Python Package Installer)

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

Option B — Local Node.js (dev)
```bash
cd services/orchestrator
npm install
npm run dev   # starts the orchestrator on http://localhost:7070 by default
```

Notes:
- For local browser-based SSE testing use the Vite frontend dev server (http://localhost:5173) and ensure CORS allows that origin or run without ORCHESTRATOR_API_KEY in dev.
- Docker Compose is the easiest way to get Redis + Orchestrator running together for end-to-end testing.

### Orchestrator
- Service README: [`services/orchestrator/README.md`](services/orchestrator/README.md:1)
- API reference: [`docs/references/orchestrator-api.md`](docs/references/orchestrator-api.md:1)
- Frontend integration reference: [`docs/references/frontend-orchestrator.md`](docs/references/frontend-orchestrator.md:1)
- Local development guide: [`docs/guides/orchestrator-local-dev.md`](docs/guides/orchestrator-local-dev.md:1)

#### Gateway

```bash
cd services/gateway
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

*(Optional)* **Echo Agent** (Redis-based task runner)

```bash
cd services/agents/echo
pip install -r requirements.txt
python -m services.agents.echo.app.main  # run the EchoAgent listener
```

### 5. Running Tests

To run tests for all services, you can use the CI workflow as a reference or execute tests individually:

*   **Python Services:**
    ```bash
    cd services/orchestrator # or gateway, or agents/echo
    pytest
    ```
*   **Frontend:**
    ```bash
    cd services/frontend
    npm test
    ```

### 6. Linting

To lint the code for all services:

*   **Python Services:**
    ```bash
    cd services/orchestrator # or gateway, or agents/echo
    flake8 .
    ```
*   **Frontend:**
    ```bash
    cd services/frontend
    npm run lint

## Full‑stack via Docker Compose

Bring up Redis, Orchestrator (FastAPI), Gateway (FastAPI), and Frontend (Vite preview) locally.

- Compose file: [`docker-compose.yml`](docker-compose.yml:1)
- Service apps:
  - Orchestrator (Python FastAPI): [`services/orchestrator/app/main.py`](services/orchestrator/app/main.py:1)
  - Gateway (Python FastAPI): [`services/gateway/app/main.py`](services/gateway/app/main.py:1)
  - Frontend (Vite): [`services/frontend/vite.config.js`](services/frontend/vite.config.js:1)

Environment defaults (copy to .env if needed):
- [`.env.example`](.env.example:1)

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
