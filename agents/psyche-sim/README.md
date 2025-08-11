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

Notes
-----
This scaffold is intentionally minimal. Extend `src/main.py` to implement the actual Psyche logic (LLM calls, Redis caching, etc.) and add required dependencies to a `requirements.txt` as needed.