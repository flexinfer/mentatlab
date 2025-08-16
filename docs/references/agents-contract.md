# Agent Event Contract (NDJSON)

This document defines a minimal, consistent event contract that agents should emit to stdout as NDJSON (one JSON object per line). The orchestrator's LocalSubprocessDriver consumes these lines directly.

## Transport

- NDJSON: One compact JSON object per line on stdout
- Each line is flushed immediately

## Event Shape

Each NDJSON line MUST be a single JSON object with the following structure:

```json
{
  "type": "log" | "checkpoint" | "metric" | "node_status" | "custom_type",
  "level": "debug" | "info" | "warn" | "error",   // optional; for log events
  "message": "Human readable message",            // optional; for log events
  "data": { "any": "arbitrary JSON payload" },    // optional but recommended
  "correlation_id": "optional-id",                // optional; per-call or process-level
  "ts": "2025-08-16T03:21:00Z"                    // optional; ISO-8601; agent may set (driver also sets)
}
```

Notes:
- LocalSubprocessDriver already adds `node_id` via its context; agents do NOT need to include `node_id`.
- Keep events one per line and compact. Avoid multi-line payloads.

## Minimum Viable Events

- Log:
  ```json
  {"type":"log","level":"info","message":"echo: start","data":{"args_count":2}}
  ```
- Checkpoint:
  ```json
  {"type":"checkpoint","data":{"stage":"start","progress":0.0}}
  ```

## Python Helper

A dependency-free helper is provided to standardize emission. Use:

- `emit_event(type=..., data=..., level=..., message=..., correlation_id=..., ts=...)`
- `log_info(message, data)`
- `log_error(message, data)`
- `checkpoint(stage, progress, extra)`

Example usage:
```python
from agents.common.emit import log_info, log_error, checkpoint, emit_event, set_correlation_id

set_correlation_id("run-1234")
checkpoint("start", 0.0, {"foo": "bar"})
log_info("agent: working", {"step": 1})
emit_event(type="metric", data={"tokens": {"in": 10, "out": 20}})
checkpoint("end", 1.0)
```

## Echo Agent (Python) Example

The repo includes a simple Python echo agent that uses the helper and emits demonstration stderr:

Run locally from repo root:
```bash
python -m agents.echo.main hello world
```

Expected stdout (NDJSON lines):
```json
{"type":"checkpoint","data":{"stage":"start","progress":0.0,"args_count":2},"ts":"..."}
{"type":"log","level":"info","message":"echo: start","data":{"args_count":2},"ts":"..."}
{"type":"log","level":"info","message":"echo: arg","data":{"index":0,"value":"hello"},"ts":"..."}
{"type":"log","level":"info","message":"echo: arg","data":{"index":1,"value":"world"},"ts":"..."}
{"type":"checkpoint","data":{"stage":"end","progress":1.0,"args_count":2},"ts":"..."}
{"type":"log","level":"info","message":"echo: done","data":{"args_count":2},"ts":"..."}
```

Expected stderr (demonstration):
```
[echo] demonstration stderr line
```

## Psyche-Sim Agent

The psyche-sim runner has been updated to emit contract-compliant log and checkpoint events during key phases (start, round progress, streaming init/complete, end). Its streaming messages remain unchanged for UI compatibility, but additional contract logs/checkpoints are emitted to stdout between these messages.

Run locally (stdin-driven):
```bash
echo '{"spec": {"mode": "stream", "prompt": "hello psyche-sim"}, "context": {"execution_id": "run-42"}}' | python -m agents.psyche-sim.src.main
```

Expected stdout contains:
- Existing streaming events (e.g., `text:stream`, `stream:status`)
- Contract logs/checkpoints:
  ```json
  {"type":"log","level":"info","message":"psyche-sim: start","ts":"..."}
  {"type":"checkpoint","data":{"stage":"start","progress":0.0},"ts":"..."}
  {"type":"log","level":"info","message":"psyche-sim: initializing stream","data":{"agent_id":"...","stream_id":"..."},"ts":"..."}
  {"type":"checkpoint","data":{"stage":"initializing","progress":0.05,"agent_id":"...","stream_id":"..."},"ts":"..."}
  {"type":"log","level":"info","message":"psyche-sim: streaming simulation start","data":{"agent_id":"...","stream_id":"..."},"ts":"..."}
  {"type":"checkpoint","data":{"stage":"streaming_start","progress":0.0,"agent_id":"...","stream_id":"..."},"ts":"..."}
  {"type":"checkpoint","data":{"stage":"round","progress":0.33,"round":1,"total_rounds":3},"ts":"..."}
  ...
  {"type":"checkpoint","data":{"stage":"streaming_complete","progress":1.0,"agent_id":"...","stream_id":"..."},"ts":"..."}
  {"type":"log","level":"info","message":"psyche-sim: streaming simulation complete","data":{"agent_id":"...","stream_id":"..."},"ts":"..."}
  {"type":"checkpoint","data":{"stage":"end","progress":1.0},"ts":"..."}
  {"type":"log","level":"info","message":"psyche-sim: completed","data":{"seconds":0.42},"ts":"..."}
  ```

## Orchestrator Integration

No changes to orchestrator/gateway/frontend are required. The LocalSubprocessDriver reads NDJSON stdout and will add its own metadata (e.g., `node_id`). Ensure your agent prints only valid NDJSON lines to stdout and flushes after each line.

## Author Guidance

- Emit at least:
  - One `checkpoint` at start (`progress: 0.0`)
  - Per-key-phase checkpoints (e.g., per round or significant step)
  - One `checkpoint` at end (`progress: 1.0`)
  - Informational `log` lines that help operators trace execution
- Keep payloads small and structured; prefer `data` for details instead of stuffing strings in `message`.
- Always flush after writing to stdout; the helper does this automatically.
- Avoid printing non-JSON to stdout. Use stderr for free-form debug, if needed.

## Minimal Validation

- Echo (standalone):
  ```bash
  python -m agents.echo.main hello world
  ```
- Psyche-Sim (standalone stream demo):
  ```bash
  echo '{"spec": {"mode": "stream", "prompt": "hello psyche-sim"}, "context": {"execution_id": "run-42"}}' | python -m agents.psyche-sim.src.main
  ```

These produce immediate NDJSON lines verifying the contract.