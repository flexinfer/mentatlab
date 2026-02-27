#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Ensure repo root is on sys.path when executed as a file path.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from agents.common.base import MentatAgent

DEFAULT_EXECUTOR_COMMAND = "loom mcp call"
DEFAULT_TIMEOUT_SECONDS = 30


def extract_tool_request(spec: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """Extract tool execution inputs from spec payload."""
    tool_name = spec.get("tool_name")
    tool_args = spec.get("tool_args", {})

    if not isinstance(tool_name, str) or not tool_name.strip():
        raise ValueError("spec.tool_name is required and must be a non-empty string")
    if tool_args is None:
        tool_args = {}
    if not isinstance(tool_args, dict):
        raise ValueError("spec.tool_args must be a JSON object")

    return tool_name.strip(), tool_args


def parse_executor_output(stdout: str) -> Any:
    """Parse executor output, preferring JSON from the last non-empty line."""
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    if not lines:
        return {}

    payload = lines[-1]
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return {"raw": payload}


def build_command(base_command: str, tool_name: str, tool_args: Dict[str, Any]) -> List[str]:
    cmd = shlex.split(base_command)
    if not cmd:
        raise ValueError("MCP_EXECUTOR_COMMAND is empty")

    cmd.extend([tool_name, json.dumps(tool_args, separators=(",", ":"), ensure_ascii=False)])
    return cmd


class LoomMCPExecutorAgent(MentatAgent):
    def __init__(self) -> None:
        super().__init__(agent_id="loom-mcp-executor", version="0.1.0")

    def process(self, spec: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        _ = context
        tool_name, tool_args = extract_tool_request(spec)

        base_command = os.environ.get("MCP_EXECUTOR_COMMAND", DEFAULT_EXECUTOR_COMMAND)
        timeout = int(os.environ.get("MCP_EXECUTOR_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))

        cmd = build_command(base_command, tool_name, tool_args)
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )

        if completed.returncode != 0:
            stderr = (completed.stderr or "").strip()
            raise RuntimeError(
                f"MCP tool execution failed for '{tool_name}' (exit {completed.returncode}): {stderr or 'no stderr'}"
            )

        tool_result = parse_executor_output(completed.stdout or "")
        return {
            "tool_name": tool_name,
            "tool_args": tool_args,
            "tool_result": tool_result,
        }


if __name__ == "__main__":
    agent = LoomMCPExecutorAgent()
    sys.exit(agent.run())
