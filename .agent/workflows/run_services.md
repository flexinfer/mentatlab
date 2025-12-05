---
description: Run the MentatLab services locally
---

This workflow helps you run the MentatLab services (Orchestrator, Gateway, Frontend) locally.

1. Start the Orchestrator (Python)

   ```bash
   cd services/orchestrator
   pip install -r requirements.txt
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

2. Start the Gateway (Python)

   ```bash
   cd services/gateway
   pip install -r requirements.txt
   uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
   ```

3. Start the Frontend (Vite)

   ```bash
   cd services/frontend
   npm install
   npm run dev
   ```

4. (Optional) Run Redis
   If you want persistence, run Redis:
   ```bash
   docker run -p 6379:6379 redis
   ```
   And set `ORCH_RUNSTORE=redis` and `REDIS_URL=redis://localhost:6379/0` for the Orchestrator.
