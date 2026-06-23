#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Mapping
try:
    from agents.common.input_contract import read_input_contract
except Exception:
    sys.path.append(
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    )
    from agents.common.input_contract import read_input_contract

AGENT_MODEL = "loom-mcp-executor/0.2.0"
FLEXINFER_INFERENCE_TOOL = "flexinfer__inference_chat"
_ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(:-([^}]*))?\}")


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


def _resolve_env_template(value: str, env: Mapping[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        fallback = match.group(3) or ""
        resolved = env.get(key, "")
        if resolved != "":
            return resolved
        return fallback

    return _ENV_PATTERN.sub(replace, value)


def resolve_placeholders(value: Any, env: Mapping[str, str]) -> Any:
    if isinstance(value, str):
        return _resolve_env_template(value, env)
    if isinstance(value, list):
        return [resolve_placeholders(item, env) for item in value]
    if isinstance(value, dict):
        return {str(k): resolve_placeholders(v, env) for k, v in value.items()}
    return value


def validate_runtime_contract(spec: Dict[str, Any], env: Mapping[str, str]) -> str | None:
    contract = spec.get("runtime_contract")
    if not isinstance(contract, dict):
        return None

    required_env = contract.get("required_env")
    if not isinstance(required_env, list):
        return None

    missing: list[str] = []
    for raw_name in required_env:
        if not isinstance(raw_name, str):
            continue
        name = raw_name.strip()
        if not name:
            continue
        if env.get(name, "").strip() == "":
            missing.append(name)

    if missing:
        return "missing required runtime env vars: " + ", ".join(sorted(missing))
    return None


def call_flexinfer_inference(tool_args: Dict[str, Any]) -> Any:
    proxy_url = str(tool_args.get("proxy_url", "")).strip() or os.environ.get("FLEXINFER_PROXY_URL", "").strip()
    model = str(tool_args.get("model", "")).strip() or os.environ.get("FLEXINFER_MODEL", "").strip()

    if not proxy_url:
        raise ValueError("missing proxy_url (or FLEXINFER_PROXY_URL)")
    if not model:
        raise ValueError("missing model (or FLEXINFER_MODEL)")

    messages = tool_args.get("messages")
    if not isinstance(messages, list) or not messages:
        prompt = str(tool_args.get("prompt", "")).strip() or os.environ.get("FLEXINFER_PROMPT", "").strip()
        if not prompt:
            raise ValueError("missing prompt/messages (or FLEXINFER_PROMPT)")
        messages = [{"role": "user", "content": prompt}]

    body: Dict[str, Any] = {
        "model": model,
        "messages": messages,
    }

    if "temperature" in tool_args and tool_args["temperature"] not in (None, ""):
        try:
            body["temperature"] = float(tool_args["temperature"])
        except Exception:
            body["temperature"] = tool_args["temperature"]
    if "max_tokens" in tool_args and tool_args["max_tokens"] not in (None, ""):
        try:
            body["max_tokens"] = int(tool_args["max_tokens"])
        except Exception:
            body["max_tokens"] = tool_args["max_tokens"]

    timeout_seconds: float = 30.0
    if "timeout_seconds" in tool_args and tool_args["timeout_seconds"] not in (None, ""):
        try:
            timeout_seconds = float(tool_args["timeout_seconds"])
        except Exception:
            timeout_seconds = 30.0

    endpoint = proxy_url.rstrip("/") + "/v1/chat/completions"
    headers = {"Content-Type": "application/json"}
    api_key = str(tool_args.get("api_key", "")).strip() or os.environ.get("FLEXINFER_API_KEY", "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(
        endpoint,
        method="POST",
        headers=headers,
        data=json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
    )

    with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
        raw = resp.read().decode("utf-8")

    try:
        return json.loads(raw) if raw else {}
    except Exception:
        return {"raw": raw}


def call_loom_tool(loom_bin: str, tool_name: str, tool_args: Any, spec: Dict[str, Any]) -> tuple[Any, str]:
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
        raise RuntimeError(
            json.dumps(
                {
                    "error": "loom tools call failed",
                    "exit_code": proc.returncode,
                    "command": cmd,
                    "stdout": stdout,
                    "stderr": stderr,
                },
                separators=(",", ":"),
                ensure_ascii=False,
            )
        )

    return parsed_result, stderr


def main() -> int:
    started = time.time()
    incoming = read_input_contract()
    spec = incoming.get("spec", {})
    if not isinstance(spec, dict):
        spec = {}

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

    contract_error = validate_runtime_contract(spec, os.environ)
    if contract_error:
        emit_event(
            {
                "type": "output",
                "key": "error",
                "value": {
                    "error": contract_error,
                    "tool_name": tool_name,
                },
                "level": "error",
            }
        )
        return 2

    tool_args = resolve_placeholders(spec.get("tool_args", {}), os.environ)
    payload_spec = dict(spec)
    payload_spec["tool_args"] = tool_args

    if tool_name == FLEXINFER_INFERENCE_TOOL:
        try:
            if not isinstance(tool_args, dict):
                raise ValueError("tool_args must be an object for flexinfer inference")
            parsed_result = call_flexinfer_inference(tool_args)
        except (ValueError, urllib.error.URLError) as err:
            emit_event(
                {
                    "type": "output",
                    "key": "error",
                    "value": {
                        "error": "flexinfer inference call failed",
                        "tool_name": tool_name,
                        "tool_args": tool_args,
                        "details": str(err),
                    },
                    "level": "error",
                }
            )
            return 1

        payload = build_payload(payload_spec, parsed_result, time.time() - started)
        emit_event({"type": "output", "key": "result", "value": payload})
        return 0

    loom_bin = resolve_loom_bin()
    try:
        parsed_result, stderr = call_loom_tool(loom_bin, tool_name, tool_args, spec)
    except FileNotFoundError as err:
        emit_event(
            {
                "type": "output",
                "key": "error",
                "value": {
                    "error": "loom runtime unavailable",
                    "tool_name": tool_name,
                    "details": str(err),
                    "loom_bin": loom_bin,
                },
                "level": "error",
            }
        )
        return 127
    except OSError as err:
        emit_event(
            {
                "type": "output",
                "key": "error",
                "value": {
                    "error": "loom runtime unavailable",
                    "tool_name": tool_name,
                    "details": str(err),
                    "loom_bin": loom_bin,
                },
                "level": "error",
            }
        )
        return 127
    except RuntimeError as err:
        payload: Dict[str, Any]
        try:
            payload = json.loads(str(err))
        except Exception:
            payload = {
                "error": "loom tools call failed",
                "tool_name": tool_name,
                "details": str(err),
            }
        emit_event(
            {
                "type": "output",
                "key": "error",
                "value": payload,
                "level": "error",
            }
        )
        return int(payload.get("exit_code", 1))

    payload = build_payload(payload_spec, parsed_result, time.time() - started)
    if stderr:
        payload["stderr"] = stderr

    emit_event({"type": "output", "key": "result", "value": payload})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
