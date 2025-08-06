# Local Testing Guide with PDM

This guide helps you run tests locally with the correct Python environments for each service.

## Quick Start

Run all tests across all services:
```bash
./run-tests-local.sh
```

## Understanding the Issue

When you see errors like `ModuleNotFoundError: No module named 'fastapi'`, it means you're running tests outside of the PDM virtual environment where dependencies are installed.

Each service in this project has its own:
- `pyproject.toml` file defining dependencies
- PDM virtual environment with those dependencies installed
- Test suite that requires those dependencies

## Running Tests for Individual Services

### Gateway Service
```bash
cd services/gateway
pdm install  # Install dependencies (only needed once)
pdm run pytest -v
```

### Orchestrator Service
```bash
cd services/orchestrator
pdm install  # Install dependencies (only needed once)
pdm run pytest -v
```

### Echo Agent Service
```bash
cd services/agents/echo
pdm install  # Install dependencies (only needed once)
pdm run pytest -v
```

## Configuring VSCode for PDM

To run tests directly from VSCode with the correct environment:

### Option 1: Configure Python Interpreter (Recommended)

1. Open a service directory in VSCode (e.g., `services/gateway`)
2. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Type "Python: Select Interpreter"
4. Choose the PDM virtual environment for that service:
   - Look for something like `./.venv/bin/python` or `~/.local/share/pdm/venvs/gateway-xxx/bin/python`
5. VSCode will now use this interpreter for running tests

### Option 2: Use PDM in Terminal

1. Open VSCode integrated terminal
2. Navigate to the service directory
3. Run tests with PDM: `pdm run pytest`

### Option 3: Configure VSCode Tasks

Create `.vscode/tasks.json`:
```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "Test Gateway",
            "type": "shell",
            "command": "cd services/gateway && pdm run pytest -v",
            "group": "test"
        },
        {
            "label": "Test Orchestrator",
            "type": "shell",
            "command": "cd services/orchestrator && pdm run pytest -v",
            "group": "test"
        },
        {
            "label": "Test All",
            "type": "shell",
            "command": "./run-tests-local.sh",
            "group": "test"
        }
    ]
}
```

Then run tasks with `Cmd+Shift+P` → "Tasks: Run Task"

## Troubleshooting

### PDM not found
If you get "pdm: command not found", install PDM:
```bash
pip install pdm
# or
brew install pdm  # on macOS
```

### Dependencies not installing
If `pdm install` fails:
1. Check Python version: `python --version` (should be 3.8+)
2. Clear PDM cache: `pdm cache clear`
3. Try again: `pdm install -v` (verbose mode)

### Tests still failing after dependencies installed
Make sure you're using `pdm run pytest`, not just `pytest`. The `pdm run` prefix ensures tests run in the correct virtual environment.

## VSCode Python Test Discovery

To fix test discovery in VSCode:

1. Open settings.json (`Cmd+,` → click "{}" icon)
2. Add for workspace settings:
```json
{
    "python.testing.pytestEnabled": true,
    "python.testing.unittestEnabled": false,
    "python.testing.pytestArgs": [
        "."
    ],
    "python.defaultInterpreterPath": "${workspaceFolder}/.venv/bin/python"
}
```

3. For multi-root workspaces, configure each service folder separately

## Running Specific Tests

Run a specific test file:
```bash
cd services/gateway
pdm run pytest tests/test_routes.py -v
```

Run a specific test function:
```bash
cd services/gateway
pdm run pytest tests/test_routes.py::test_healthz -v
```

Run with coverage:
```bash
cd services/gateway
pdm run pytest --cov=app tests/
```

## CI/CD Alignment

The local test setup mirrors the GitHub Actions workflow:
- Each service's tests run in isolation
- Dependencies are installed via PDM
- Tests use the same commands locally and in CI

This ensures that tests passing locally will also pass in GitHub Actions.