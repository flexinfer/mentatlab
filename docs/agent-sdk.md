# MentatLab Agent SDK

This guide covers everything you need to build agents for the MentatLab orchestration platform.

## Overview

Agents are containerized units of work that:
- Execute tasks within a DAG (directed acyclic graph) workflow
- Communicate via NDJSON events over stdout
- Run in Kubernetes Jobs or subprocess mode
- Can be registered and discovered via the Agent Registry API

## Agent Manifest Schema

Every agent must be registered with a manifest. Here's the complete schema:

```json
{
  "id": "myorg.my-agent",
  "name": "My Agent",
  "version": "1.0.0",
  "image": "registry.example.com/my-agent:v1.0.0",
  "command": ["python", "-m", "my_agent"],
  "capabilities": ["text-processing", "summarization"],
  "description": "Processes text and generates summaries",
  "author": "Your Name <you@example.com>",
  "schema": {
    "input": {
      "type": "object",
      "properties": {
        "text": { "type": "string" },
        "max_length": { "type": "integer", "default": 500 }
      },
      "required": ["text"]
    },
    "output": {
      "type": "object",
      "properties": {
        "summary": { "type": "string" },
        "word_count": { "type": "integer" }
      }
    }
  },
  "metadata": {
    "category": "nlp",
    "cost_per_run": "0.001"
  }
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., `myorg.agent-name`) |
| `name` | string | Human-readable display name |
| `version` | string | Semantic version (e.g., `1.0.0`) |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `image` | string | Container image URL for K8s execution |
| `command` | string[] | Entrypoint command override |
| `capabilities` | string[] | Tags for filtering/discovery |
| `schema` | object | JSON Schema for input/output validation |
| `description` | string | Agent description |
| `author` | string | Author name/email |
| `metadata` | object | Custom key-value pairs |

---

## Event Protocol (NDJSON)

Agents communicate with the orchestrator via **newline-delimited JSON (NDJSON)** on stdout. Each line is a complete JSON object.

### Event Structure

```json
{
  "type": "log|checkpoint|metric|node_status|result",
  "level": "debug|info|warn|error",
  "message": "Human-readable message",
  "data": { "key": "value" },
  "correlation_id": "run-123-node-abc",
  "ts": "2024-01-15T10:30:00.000Z"
}
```

### Event Types

#### 1. Log Events
Used for general logging and debugging.

```json
{"type":"log","level":"info","message":"Processing started","data":{"input_size":1024},"ts":"2024-01-15T10:30:00Z"}
{"type":"log","level":"error","message":"Failed to parse input","data":{"error":"invalid JSON"},"ts":"2024-01-15T10:30:01Z"}
```

#### 2. Checkpoint Events
Report progress through execution stages.

```json
{"type":"checkpoint","data":{"stage":"start","progress":0.0},"ts":"2024-01-15T10:30:00Z"}
{"type":"checkpoint","data":{"stage":"processing","progress":0.5,"items_processed":50},"ts":"2024-01-15T10:30:05Z"}
{"type":"checkpoint","data":{"stage":"end","progress":1.0},"ts":"2024-01-15T10:30:10Z"}
```

#### 3. Metric Events
Emit metrics for monitoring and cost tracking.

```json
{"type":"metric","data":{"name":"tokens_used","value":1500,"unit":"tokens"},"ts":"2024-01-15T10:30:10Z"}
{"type":"metric","data":{"name":"api_latency_ms","value":250},"ts":"2024-01-15T10:30:10Z"}
```

#### 4. Result Events
Final output of the agent (optional, can also use exit code + stdout).

```json
{"type":"result","data":{"summary":"The quick brown fox...","word_count":150},"ts":"2024-01-15T10:30:10Z"}
```

---

## Python SDK

### Installation

```bash
# The common module is included in the MentatLab repository
# For standalone agents, copy agents/common/emit.py
```

### Basic Usage

```python
#!/usr/bin/env python3
from agents.common.emit import (
    log_info,
    log_error,
    checkpoint,
    emit_event,
    set_correlation_id,
)

def main():
    # Set correlation ID for all events (optional, passed via --cid=...)
    set_correlation_id("run-123")

    # Report start
    checkpoint("start", 0.0, {"args": sys.argv[1:]})
    log_info("Agent starting", {"version": "1.0.0"})

    try:
        # Do work...
        result = process_input()

        # Report progress
        checkpoint("processing", 0.5, {"items": 50})

        # Emit final result
        emit_event(type="result", data={"output": result})
        checkpoint("end", 1.0)

    except Exception as e:
        log_error(f"Agent failed: {e}", {"traceback": traceback.format_exc()})
        checkpoint("error", 0.0, {"error": str(e)})
        return 1

    return 0

if __name__ == "__main__":
    sys.exit(main())
```

### API Reference

```python
# Set default correlation ID for all subsequent events
set_correlation_id(correlation_id: Optional[str]) -> None

# Emit a raw event
emit_event(
    type: str,                          # Required: event type
    data: Optional[Dict[str, Any]],     # Payload data
    level: Optional[str],               # Log level (for type="log")
    message: Optional[str],             # Human-readable message
    correlation_id: Optional[str],      # Override default correlation ID
    ts: Optional[str],                  # ISO8601 timestamp (auto-generated)
) -> None

# Convenience functions
log_info(message: str, data: Optional[Dict] = None) -> None
log_error(message: str, data: Optional[Dict] = None) -> None
checkpoint(stage: str, progress: float, extra: Optional[Dict] = None) -> None
```

---

## Go SDK

```go
package main

import (
    "encoding/json"
    "fmt"
    "os"
    "time"
)

type Event struct {
    Type          string                 `json:"type"`
    Level         string                 `json:"level,omitempty"`
    Message       string                 `json:"message,omitempty"`
    Data          map[string]interface{} `json:"data,omitempty"`
    CorrelationID string                 `json:"correlation_id,omitempty"`
    Timestamp     string                 `json:"ts"`
}

func emit(e Event) {
    if e.Timestamp == "" {
        e.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
    }
    data, _ := json.Marshal(e)
    fmt.Println(string(data))
}

func logInfo(message string, data map[string]interface{}) {
    emit(Event{Type: "log", Level: "info", Message: message, Data: data})
}

func checkpoint(stage string, progress float64, extra map[string]interface{}) {
    data := map[string]interface{}{
        "stage":    stage,
        "progress": progress,
    }
    for k, v := range extra {
        data[k] = v
    }
    emit(Event{Type: "checkpoint", Data: data})
}

func main() {
    checkpoint("start", 0.0, nil)
    logInfo("Processing started", map[string]interface{}{"args": os.Args[1:]})

    // Do work...

    checkpoint("end", 1.0, nil)
}
```

---

## JavaScript/Node.js SDK

```javascript
#!/usr/bin/env node

function emit(event) {
  const fullEvent = {
    ...event,
    ts: event.ts || new Date().toISOString(),
  };
  console.log(JSON.stringify(fullEvent));
}

function logInfo(message, data = {}) {
  emit({ type: 'log', level: 'info', message, data });
}

function logError(message, data = {}) {
  emit({ type: 'log', level: 'error', message, data });
}

function checkpoint(stage, progress, extra = {}) {
  emit({ type: 'checkpoint', data: { stage, progress, ...extra } });
}

// Main
checkpoint('start', 0.0, { args: process.argv.slice(2) });
logInfo('Agent starting');

try {
  // Do work...
  const result = processInput();

  emit({ type: 'result', data: { output: result } });
  checkpoint('end', 1.0);

} catch (error) {
  logError('Agent failed', { error: error.message });
  checkpoint('error', 0.0, { error: error.message });
  process.exit(1);
}
```

---

## Dockerfile Template

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Copy agent code
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as non-root user
RUN useradd -m agent
USER agent

# Default entrypoint
ENTRYPOINT ["python", "-m", "my_agent"]
```

### Best Practices

1. **Use slim base images** - Reduces image size and attack surface
2. **Run as non-root** - Required for security in K8s
3. **No interactive input** - Agents must run non-interactively
4. **Flush stdout** - Always flush after emitting events
5. **Handle signals** - Gracefully handle SIGTERM for cancellation

---

## Agent Registration API

### Register an Agent

```bash
curl -X POST http://orchestrator:7070/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{
    "id": "myorg.summarizer",
    "name": "Text Summarizer",
    "version": "1.0.0",
    "image": "registry.example.com/summarizer:v1.0.0",
    "capabilities": ["text-processing", "summarization"]
  }'
```

### List Agents

```bash
# List all agents
curl http://orchestrator:7070/api/v1/agents

# Filter by capability
curl "http://orchestrator:7070/api/v1/agents?capabilities=summarization"
```

### Get Agent by ID

```bash
curl http://orchestrator:7070/api/v1/agents/myorg.summarizer
```

### Schedule Agent Execution

```bash
curl -X POST http://orchestrator:7070/api/v1/agents/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "agent_manifest": {
      "id": "myorg.summarizer",
      "version": "1.0.0",
      "image": "registry.example.com/summarizer:v1.0.0"
    },
    "inputs": {
      "text": "Long text to summarize...",
      "max_length": 200
    },
    "execution_id": "run-12345"
  }'
```

---

## Debugging Agents

### Local Testing

```bash
# Run agent locally with test input
echo '{"text": "Hello world"}' | python -m my_agent

# With correlation ID
python -m my_agent --cid=test-run-001

# View NDJSON output
python -m my_agent 2>&1 | jq -c '.'
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Events not appearing | stdout not flushed | Call `sys.stdout.flush()` after each emit |
| Invalid JSON errors | Non-JSON in stdout | Ensure only NDJSON on stdout, use stderr for debug |
| Agent timeout | Long-running without checkpoints | Emit checkpoints regularly |
| K8s OOMKilled | Memory limit exceeded | Set appropriate resource limits |

### Viewing Logs in K8s

```bash
# View agent job logs
kubectl logs job/agent-run-12345 -n mentatlab

# Follow logs
kubectl logs -f job/agent-run-12345 -n mentatlab
```

---

## Example Agents

### Echo Agent (Python)

The simplest possible agent - echoes input arguments:

```python
#!/usr/bin/env python3
from agents.common.emit import log_info, checkpoint

def main():
    import sys
    args = sys.argv[1:]

    checkpoint("start", 0.0, {"args_count": len(args)})

    for i, arg in enumerate(args):
        log_info("echo", {"index": i, "value": arg})

    checkpoint("end", 1.0)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

### LLM Agent (Python with OpenAI)

```python
#!/usr/bin/env python3
import os
import sys
from openai import OpenAI
from agents.common.emit import log_info, log_error, checkpoint, emit_event

def main():
    checkpoint("start", 0.0)

    prompt = sys.stdin.read() if not sys.stdin.isatty() else " ".join(sys.argv[1:])
    if not prompt:
        log_error("No input provided")
        return 1

    log_info("Processing prompt", {"length": len(prompt)})
    checkpoint("processing", 0.3)

    try:
        client = OpenAI()
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
        )

        result = response.choices[0].message.content
        tokens_used = response.usage.total_tokens

        emit_event(type="metric", data={"name": "tokens_used", "value": tokens_used})
        emit_event(type="result", data={"response": result})

        checkpoint("end", 1.0, {"tokens": tokens_used})

    except Exception as e:
        log_error(f"API call failed: {e}")
        checkpoint("error", 0.0, {"error": str(e)})
        return 1

    return 0

if __name__ == "__main__":
    sys.exit(main())
```

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│    Gateway      │────▶│  Orchestrator   │
│   (React)       │     │    (Go)         │     │    (Go)         │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │   Kubernetes    │
                                               │   Job Scheduler │
                                               └─────────────────┘
                                                        │
                        ┌───────────────────────────────┼───────────────────────────────┐
                        ▼                               ▼                               ▼
               ┌─────────────────┐             ┌─────────────────┐             ┌─────────────────┐
               │  Agent Pod 1    │             │  Agent Pod 2    │             │  Agent Pod N    │
               │  (container)    │             │  (container)    │             │  (container)    │
               └─────────────────┘             └─────────────────┘             └─────────────────┘
                        │                               │                               │
                        └───────────────────────────────┼───────────────────────────────┘
                                                        │
                                                        ▼ NDJSON events
                                               ┌─────────────────┐
                                               │     Redis       │
                                               │   (Pub/Sub)     │
                                               └─────────────────┘
                                                        │
                                                        ▼
                                               ┌─────────────────┐
                                               │   WebSocket     │
                                               │   Clients       │
                                               └─────────────────┘
```

---

## See Also

- [Orchestrator API Reference](./orchestrator-api.md)
- [Flow Schema](./flow-schema.md)
- [Kubernetes Deployment](./deployment.md)
