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

```bash
cd services/orchestrator
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

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
