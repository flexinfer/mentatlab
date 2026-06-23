#!/usr/bin/env python3
from __future__ import annotations

import json
import os
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


AGENT_MODEL = "echo/0.1.0"


def main() -> int:
    start = time.time()
    incoming = read_input_contract()
    spec = incoming.get("spec", {})
    context = incoming.get("context", {})

    result: Dict[str, Any] = {"spec": spec}
    if context:
        result["context"] = context
    if len(sys.argv) > 1:
        result["args"] = sys.argv[1:]

    out = {
        "result": result,
        "mentat_meta": {
            "tokens_input": 0,
            "tokens_output": 0,
            "seconds": round(time.time() - start, 4),
            "model": AGENT_MODEL,
        },
    }
    sys.stdout.write(json.dumps(out, separators=(",", ":"), ensure_ascii=False) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
