# Local Development Guide

This guide provides multiple ways to run Mentat Lab services locally for development and testing.

## Prerequisites

- Python 3.11+
- PDM (Python Dependency Manager)
- Node.js 18+ and npm
- Docker and Docker Compose (optional)

## Quick Start Options

### Option 1: Full Local Development Script

The most comprehensive option that handles everything:

```bash
./run-local-dev.sh
```

This script:
- Checks port availability
- Installs all dependencies
- Starts all services with hot-reload
- Provides health checks
- Creates log files in `logs/` directory
- Gracefully shuts down on Ctrl+C

### Option 2: Quick Start Script

For when dependencies are already installed:

```bash
./quick-start.sh
```

This lightweight script:
- Starts core services only
- No dependency installation
- Minimal output
- Quick startup

### Option 3: Docker Compose

For containerized development:

```bash
docker-compose -f docker-compose.dev.yml up
```

Benefits:
- Isolated environments
- No local dependency installation needed
- Consistent across all platforms
- Easy cleanup

### Option 4: Manual Service Start

Start each service individually:

```bash
# Terminal 1: Orchestrator
cd services/orchestrator
pdm run uvicorn app.main:app --port 8081 --reload

# Terminal 2: Gateway
cd services/gateway
pdm run uvicorn app.main:app --port 8080 --reload

# Terminal 3: Frontend
cd services/frontend
npm run dev

# Terminal 4: Echo Agent (optional)
cd services/agents/echo
python app/main.py
```

## Service URLs

Once running, services are available at:

| Service | URL | API Docs |
|---------|-----|----------|
| Gateway | http://localhost:8080 | http://localhost:8080/docs |
| Orchestrator | http://localhost:8081 | http://localhost:8081/docs |
| Frontend | http://localhost:3000 | - |
| Echo Agent | http://localhost:8082 | http://localhost:8082/docs |

## Testing Your Setup

### 1. Health Checks

```bash
# Gateway health
curl http://localhost:8080/healthz

# Orchestrator health
curl http://localhost:8081/health

# Echo Agent health
curl http://localhost:8082/health
```

### 2. Run Tests

```bash
# Run all tests
./run-tests-local.sh

# Run specific service tests
cd services/gateway && pdm run pytest
cd services/orchestrator && pdm run pytest
```

### 3. Test API Endpoints

Create a test flow:

```bash
curl -X POST http://localhost:8080/flows \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Flow",
    "description": "Testing local setup",
    "agents": [
      {
        "id": "echo-1",
        "type": "echo",
        "config": {
          "message": "Hello from local dev!"
        }
      }
    ]
  }'
```

## Troubleshooting

### Port Already in Use

If you see "Port X is already in use":

```bash
# Find process using port (example for 8080)
lsof -i :8080

# Kill process
kill -9 <PID>
```

### Dependencies Not Found

If services fail to start due to missing dependencies:

```bash
# Gateway
cd services/gateway && pdm install

# Orchestrator
cd services/orchestrator && pdm install

# Frontend
cd services/frontend && npm install
```

### Service Communication Issues

Ensure services can communicate:
- Gateway needs to reach Orchestrator at `http://localhost:8081`
- Frontend needs to reach Gateway at `http://localhost:8080`
- Check CORS settings if browser requests fail

### Logs

When using `run-local-dev.sh`, check logs in:
- `logs/gateway.log`
- `logs/orchestrator.log`
- `logs/frontend.log`
- `logs/echo-agent.log`

## Development Workflow

1. **Make Code Changes**: Edit files in your IDE
2. **Hot Reload**: Services automatically reload (except Echo Agent)
3. **Test Changes**: Use curl, Postman, or the Frontend UI
4. **Run Tests**: Execute `pdm run pytest` in service directory
5. **Check Logs**: Monitor service logs for errors

## VS Code Integration

For the best development experience in VS Code:

1. Install Python extension
2. Select PDM interpreter for each service:
   - Open Command Palette (Cmd+Shift+P)
   - Select "Python: Select Interpreter"
   - Choose `.venv/bin/python` in the service directory

3. Configure debugging (example for Gateway):

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Gateway",
      "type": "python",
      "request": "launch",
      "module": "uvicorn",
      "args": ["app.main:app", "--port", "8080", "--reload"],
      "cwd": "${workspaceFolder}/services/gateway",
      "env": {
        "PYTHONPATH": "${workspaceFolder}/services/gateway"
      }
    }
  ]
}
```

## Tips

- Use `run-local-dev.sh` for full setup with logging
- Use `quick-start.sh` for rapid iteration
- Use Docker Compose for clean, isolated environments
- Keep terminals open to see real-time logs
- Install VS Code extensions: Python, Prettier, ESLint
- Use API documentation at `/docs` endpoints for testing

## Next Steps

- Explore API documentation at service `/docs` endpoints
- Create custom agents following the Echo Agent pattern
- Build flows using the Frontend UI
- Add integration tests for multi-service workflows