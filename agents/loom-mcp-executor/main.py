#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from typing import Any, Dict
try:
    from agents.common.input_contract import read_input_contract
except Exception:
    sys.path.append(
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    )
    from agents.common.input_contract import read_input_contract

AGENT_MODEL = "loom-mcp-executor/0.1.0"


def emit_event(event: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(event, separators=(",", ":"), ensure_ascii=False) + "\n")
    sys.stdout.flush()


def resolve_loom_bin() -> str:
    explicit = os.environ.get("LOOM_BIN", "").strip()
    if explicit:
        return explicit
    found = shutil.which("loom")
    if found:
        return found
    return "loom"


def build_payload(spec: Dict[str, Any], result: Any, seconds: float) -> Dict[str, Any]:
    payload = {
        "tool_name": spec.get("tool_name"),
        "mcp_server": spec.get("mcp_server"),
        "tool_args": spec.get("tool_args", {}),
        "result": result,
        "mentat_meta": {
            "tokens_input": 0,
            "tokens_output": 0,
            "seconds": round(seconds, 4),
            "model": AGENT_MODEL,
        },
    }
    return payload


def main() -> int:
    started = time.time()
    incoming = read_input_contract()
    spec = incoming.get("spec", {})

    tool_name = str(spec.get("tool_name", "")).strip()
    if not tool_name:
        emit_event(
            {
                "type": "output",
                "key": "error",
                "value": {
                    "error": "missing tool_name in INPUT_SPEC or stdin payload",
                    "received_keys": sorted(list(spec.keys())),
                },
                "level": "error",
            }
        )
        return 2

    tool_args = spec.get("tool_args", {})
    loom_bin = resolve_loom_bin()
    cmd = [loom_bin, "tools", "call", tool_name, "--json"]
    if "tool_args" in spec:
        cmd.extend(["--args", json.dumps(tool_args, separators=(",", ":"), ensure_ascii=False)])

    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()

    parsed_result: Any = None
    if stdout:
        try:
            parsed_result = json.loads(stdout)
        except Exception:
            parsed_result = {"raw": stdout}

    if proc.returncode != 0:
        emit_event(
            {
                "type": "output",
                "key": "error",
                "value": {
                    "error": "loom tools call failed",
                    "exit_code": proc.returncode,
                    "command": cmd,
                    "stdout": stdout,
                    "stderr": stderr,
                },
                "level": "error",
            }
        )
        return proc.returncode

    payload = build_payload(spec, parsed_result, time.time() - started)
    if stderr:
        payload["stderr"] = stderr

    emit_event({"type": "output", "key": "result", "value": payload})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
