DEPRECATION NOTICE: Node/TypeScript Orchestrator Removed

The legacy Node.js / TypeScript orchestrator implementation (previously located at services/orchestrator/src/) has been removed from this repository.

The authoritative orchestrator implementation is the Python FastAPI service at [`services/orchestrator/app/main.py`](services/orchestrator/app/main.py:1).

For local development:
- The FastAPI orchestrator runs on port 8081 by default when using [`run-local-dev.sh`](run-local-dev.sh:1).
- You can override the base URL with the ORCHESTRATOR_BASE_URL environment variable.

For docker-compose:
- The compose file exposes the orchestrator at port 7070; the gateway in compose uses ORCHESTRATOR_BASE_URL to reach it (see [`docker-compose.yml`](docker-compose.yml:1)).

If you maintained any local tooling that referenced the old TypeScript files under [`services/orchestrator/src/`](services/orchestrator/src/server.ts:1), update them to use the FastAPI service above.