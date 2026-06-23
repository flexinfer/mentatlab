#!/usr/bin/env python3
"""FlexInfer Adapter Agent.

Wraps FlexInfer MCP tools with model lifecycle awareness:
- Checks model readiness before inference
- Activates serverless models when needed
- Distinguishes transient (Loading/Pending) from permanent (Failed) errors
- Exit codes: 0=success, 1=permanent failure, 3=retryable (transient)
"""

import json
import os
import shutil
import subprocess
import sys
import time
from typing import Any

# ─── Constants ────────────────────────────────────────────────────────────

VERSION = "0.1.0"
AGENT_ID = "mentatlab.flexinfer-adapter"

# Exit codes understood by the orchestrator scheduler
EXIT_SUCCESS = 0
EXIT_PERMANENT = 1
EXIT_RETRYABLE = 3

# Model phases that are transient (agent should exit 3 so scheduler retries)
TRANSIENT_PHASES = {"Loading", "Pending", "Downloading"}
READY_PHASES = {"Ready", "Running"}
FAILED_PHASES = {"Failed", "Error", "CrashLoopBackOff"}

# Maximum time to poll for model readiness after activation
ACTIVATION_TIMEOUT_SEC = int(os.environ.get("FLEXINFER_ACTIVATION_TIMEOUT", "120"))
POLL_INTERVAL_SEC = int(os.environ.get("FLEXINFER_POLL_INTERVAL", "5"))

# ─── Tool Dispatch ────────────────────────────────────────────────────────

# Maps action names to FlexInfer MCP tool names
ACTION_TOOL_MAP = {
    "inference": "flexinfer_proxy_models",
    "list": "flexinfer_list_models",
    "get": "flexinfer_get_model",
    "activate": "flexinfer_activate_model",
    "scale": "flexinfer_scale_model",
    "gpu_status": "flexinfer_gpu_status",
}


# ─── Helpers ──────────────────────────────────────────────────────────────


def find_loom_bin() -> str:
    """Resolve the loom binary path."""
    explicit = os.environ.get("LOOM_BIN")
    if explicit and os.path.isfile(explicit):
        return explicit
    found = shutil.which("loom")
    if found:
        return found
    return "loom"


def call_tool(
    loom_bin: str, tool_name: str, args: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Call an MCP tool via `loom tools call` and return parsed result."""
    cmd = [loom_bin, "tools", "call", tool_name]
    if args:
        cmd.extend(["--args", json.dumps(args, separators=(",", ":"))])

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=300,
    )

    if result.returncode != 0:
        raise ToolCallError(
            f"loom tools call {tool_name} failed (exit {result.returncode})",
            exit_code=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )

    # Parse NDJSON — take last non-empty line as the result
    lines = [ln.strip() for ln in result.stdout.strip().splitlines() if ln.strip()]
    if not lines:
        raise ToolCallError(
            f"No output from {tool_name}", stdout=result.stdout, stderr=result.stderr
        )

    return json.loads(lines[-1])


class ToolCallError(Exception):
    """Error from a loom tool call."""

    def __init__(
        self, message: str, exit_code: int = 1, stdout: str = "", stderr: str = ""
    ):
        super().__init__(message)
        self.exit_code = exit_code
        self.stdout = stdout
        self.stderr = stderr


# ─── Event Emitters ───────────────────────────────────────────────────────


def emit_event(event: dict[str, Any]) -> None:
    """Write a single NDJSON event to stdout."""
    try:
        sys.stdout.write(
            json.dumps(event, separators=(",", ":"), ensure_ascii=False) + "\n"
        )
        sys.stdout.flush()
    except Exception:
        pass


def emit_output(key: str, value: Any, **extra: Any) -> None:
    """Emit a typed output event."""
    event: dict[str, Any] = {"type": "output", "key": key, "value": value}
    event.update(extra)
    emit_event(event)


def emit_error(code: str, message: str, retryable: bool = False) -> None:
    """Emit a structured error event."""
    emit_event(
        {
            "type": "error",
            "code": code,
            "message": message,
            "retryable": retryable,
        }
    )


def emit_log(level: str, message: str, data: dict[str, Any] | None = None) -> None:
    """Emit a log event."""
    event: dict[str, Any] = {"type": "log", "level": level, "message": message}
    if data:
        event["data"] = data
    emit_event(event)


# ─── Core Actions ─────────────────────────────────────────────────────────


def check_model_readiness(loom_bin: str, model_name: str) -> tuple[str, dict[str, Any]]:
    """Check if a model is ready. Returns (phase, model_info)."""
    result = call_tool(loom_bin, "flexinfer_get_model", {"name": model_name})
    # The result structure varies; look for phase/status in common locations
    phase = (
        result.get("phase")
        or result.get("status")
        or result.get("model", {}).get("phase")
        or "Unknown"
    )
    return phase, result


def activate_and_wait(loom_bin: str, model_name: str) -> dict[str, Any]:
    """Activate a model and poll until ready or timeout."""
    emit_log("info", f"Activating model {model_name}")
    call_tool(loom_bin, "flexinfer_activate_model", {"name": model_name})

    deadline = time.time() + ACTIVATION_TIMEOUT_SEC
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL_SEC)
        phase, info = check_model_readiness(loom_bin, model_name)
        emit_log("info", f"Model {model_name} phase: {phase}")

        if phase in READY_PHASES:
            return info
        if phase in FAILED_PHASES:
            raise ToolCallError(f"Model {model_name} entered failed phase: {phase}")

    raise ToolCallError(
        f"Model {model_name} did not become ready within {ACTIVATION_TIMEOUT_SEC}s"
    )


def run_inference(
    loom_bin: str, model_name: str, params: dict[str, Any]
) -> dict[str, Any]:
    """Run inference, checking readiness first."""
    phase, _ = check_model_readiness(loom_bin, model_name)

    if phase in FAILED_PHASES:
        emit_error(
            "MODEL_FAILED",
            f"Model {model_name} is in failed state: {phase}",
            retryable=False,
        )
        sys.exit(EXIT_PERMANENT)

    if phase in TRANSIENT_PHASES:
        emit_error("MODEL_NOT_READY", f"Model {model_name} is {phase}", retryable=True)
        sys.exit(EXIT_RETRYABLE)

    if phase not in READY_PHASES:
        # Try to activate
        emit_log("info", f"Model {model_name} is {phase}, attempting activation")
        activate_and_wait(loom_bin, model_name)

    # Model is ready — run inference
    tool_args: dict[str, Any] = {"model": model_name}
    tool_args.update(params)
    return call_tool(loom_bin, "flexinfer_proxy_models", tool_args)


# ─── Main ─────────────────────────────────────────────────────────────────


def read_input() -> dict[str, Any] | None:
    """Read input from env vars (INPUT_SPEC, INPUT_CONTEXT) or stdin."""
    spec_s = os.environ.get("INPUT_SPEC", "")
    ctx_s = os.environ.get("INPUT_CONTEXT", "")

    if spec_s:
        try:
            spec = json.loads(spec_s)
            ctx = json.loads(ctx_s) if ctx_s else {}
            return {"spec": spec, "context": ctx}
        except json.JSONDecodeError:
            pass

    # Try stdin
    if not sys.stdin.isatty():
        try:
            raw = sys.stdin.read().strip()
            if raw:
                data = json.loads(raw)
                if isinstance(data, dict):
                    if "spec" not in data:
                        return {"spec": data, "context": {}}
                    return data
        except (json.JSONDecodeError, Exception):
            pass

    return None


def main() -> int:
    start = time.time()
    loom_bin = find_loom_bin()

    incoming = read_input()
    if incoming is None:
        emit_error("NO_INPUT", "No input received", retryable=False)
        return EXIT_PERMANENT

    spec = incoming.get("spec", {})
    action = spec.get("action", "inference")
    model = spec.get("model", "")
    params = spec.get("params", {})

    if action not in ACTION_TOOL_MAP:
        emit_error("INVALID_ACTION", f"Unknown action: {action}", retryable=False)
        return EXIT_PERMANENT

    try:
        if action == "inference":
            if not model:
                emit_error(
                    "MISSING_MODEL", "model is required for inference", retryable=False
                )
                return EXIT_PERMANENT
            result = run_inference(loom_bin, model, params)

        elif action in ("list", "gpu_status"):
            tool_name = ACTION_TOOL_MAP[action]
            result = call_tool(loom_bin, tool_name, params if params else None)

        elif action in ("get", "activate", "scale"):
            if not model:
                emit_error(
                    "MISSING_MODEL", f"model is required for {action}", retryable=False
                )
                return EXIT_PERMANENT
            tool_name = ACTION_TOOL_MAP[action]
            tool_args: dict[str, Any] = {"name": model}
            tool_args.update(params)
            result = call_tool(loom_bin, tool_name, tool_args)

        else:
            emit_error("INVALID_ACTION", f"Unhandled action: {action}", retryable=False)
            return EXIT_PERMANENT

        elapsed = time.time() - start
        emit_output(
            "result",
            {
                "model": model,
                "action": action,
                "result": result,
                "mentat_meta": {
                    "tokens_input": 0,
                    "tokens_output": 0,
                    "seconds": round(elapsed, 4),
                    "model": f"{AGENT_ID}/{VERSION}",
                },
            },
        )
        return EXIT_SUCCESS

    except ToolCallError as e:
        elapsed = time.time() - start
        emit_error("TOOL_CALL_FAILED", str(e), retryable=False)
        emit_output(
            "error",
            {
                "error": str(e),
                "exit_code": e.exit_code,
                "stdout": e.stdout[:2000],
                "stderr": e.stderr[:2000],
            },
            level="error",
        )
        return EXIT_PERMANENT

    except Exception as e:
        elapsed = time.time() - start
        emit_error("INTERNAL_ERROR", str(e), retryable=False)
        return EXIT_PERMANENT


if __name__ == "__main__":
    sys.exit(main())
