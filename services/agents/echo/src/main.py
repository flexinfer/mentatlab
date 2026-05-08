#!/usr/bin/env python3
"""Container-packaged echo agent compatible with subprocess and K8s execution."""

from __future__ import annotations

import ast
import json
import os
import sys
import time
from typing import Any, Dict, Optional


AGENT_MODEL = "echo-agent"


def _parse_object(raw: str) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, str) or not raw.strip():
        return None

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    try:
        parsed = ast.literal_eval(raw)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    return None


def read_input_contract() -> Dict[str, Any]:
    stdin_payload = _parse_object(sys.stdin.read().strip())
    if stdin_payload is not None:
        if "spec" in stdin_payload or "context" in stdin_payload:
            return {
                "spec": stdin_payload.get("spec") if isinstance(stdin_payload.get("spec"), dict) else {},
                "context": stdin_payload.get("context") if isinstance(stdin_payload.get("context"), dict) else {},
            }
        return {"spec": stdin_payload, "context": {}}

    spec = _parse_object(os.environ.get("INPUT_SPEC", "") or "")
    context = _parse_object(os.environ.get("INPUT_CONTEXT", "") or "")
    legacy = _parse_object(os.environ.get("AGENT_INPUT", "") or "")

    if spec is not None or context is not None:
        return {"spec": spec or {}, "context": context or {}}
    if legacy is not None:
        return {"spec": legacy, "context": {}}
    raise ValueError("No input received on stdin or environment variables")


def build_result(spec: Dict[str, Any], context: Dict[str, Any], started_at: float) -> Dict[str, Any]:
    result: Dict[str, Any] = {"spec": spec}
    if context:
        result["context"] = context

    return {
        "result": result,
        "mentat_meta": {
            "tokens_input": 0,
            "tokens_output": 0,
            "seconds": round(time.time() - started_at, 4),
            "model": AGENT_MODEL,
        },
    }


def build_error(message: str) -> Dict[str, Any]:
    return {
        "error": message,
        "mentat_meta": {
            "tokens_input": None,
            "tokens_output": None,
            "seconds": None,
            "model": AGENT_MODEL,
        },
    }


def main() -> int:
    started_at = time.time()
    try:
        incoming = read_input_contract()
        output = build_result(incoming.get("spec", {}), incoming.get("context", {}), started_at)
        json.dump(output, sys.stdout, separators=(",", ":"), ensure_ascii=False)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 0
    except Exception as exc:
        json.dump(build_error(f"Processing error: {exc}"), sys.stdout, separators=(",", ":"), ensure_ascii=False)
        sys.stdout.write("\n")
        sys.stdout.flush()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
