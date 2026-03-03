from __future__ import annotations

import ast
import json
import os
import sys
from typing import Any, Dict, Mapping, Optional


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


def _normalize_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    if "spec" in payload or "context" in payload:
        spec_raw = payload.get("spec")
        context_raw = payload.get("context")
        spec = spec_raw if isinstance(spec_raw, dict) else {}
        context = context_raw if isinstance(context_raw, dict) else {}
        normalized: Dict[str, Any] = {"spec": spec, "context": context}
        for key, value in payload.items():
            if key in ("spec", "context"):
                continue
            normalized[key] = value
        return normalized

    # Direct-object payload is treated as spec for local/debug compatibility.
    return {"spec": payload, "context": {}}


def read_input_contract(
    stdin_text: Optional[str] = None,
    environ: Optional[Mapping[str, str]] = None,
) -> Dict[str, Any]:
    source_text = sys.stdin.read() if stdin_text is None else stdin_text
    if source_text and source_text.strip():
        stdin_payload = _parse_object(source_text.strip())
        if stdin_payload is not None:
            return _normalize_payload(stdin_payload)

    env = os.environ if environ is None else environ
    spec = _parse_object(env.get("INPUT_SPEC", "") or "")
    context = _parse_object(env.get("INPUT_CONTEXT", "") or "")

    return {
        "spec": spec or {},
        "context": context or {},
    }
