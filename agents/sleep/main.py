#!/usr/bin/env python3
"""Long-running test agent for the robustness fault-injection harness.

Self-contained (no agents.common imports) so it runs from any working
directory. Emits one NDJSON progress event per second for SLEEP_SECONDS,
then a final result line. Used to hold a run in the `running` state long
enough to inject a fault (orchestrator restart) mid-run.

Config via env:
  SLEEP_SECONDS  total runtime in seconds (default 60)
  EMIT_INTERVAL  seconds between progress events (default 1.0)
"""
from __future__ import annotations

import json
import os
import sys
import time


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    duration = float(os.environ.get("SLEEP_SECONDS", "60"))
    interval = float(os.environ.get("EMIT_INTERVAL", "1.0"))
    run_id = os.environ.get("RUN_ID", "")
    node_id = os.environ.get("NODE_ID", "")

    start = time.time()
    elapsed = 0.0
    tick = 0
    _emit(
        {
            "type": "log",
            "level": "info",
            "message": f"sleep agent starting: {duration}s",
            "data": {"run_id": run_id, "node_id": node_id, "duration": duration},
        }
    )
    while elapsed < duration:
        time.sleep(min(interval, max(0.0, duration - elapsed)))
        tick += 1
        elapsed = time.time() - start
        # Emit both a heartbeat and a progress checkpoint so the run looks
        # genuinely alive and produces a steady event stream for SSE checks.
        _emit(
            {"type": "heartbeat", "data": {"tick": tick, "elapsed": round(elapsed, 2)}}
        )
        _emit(
            {
                "type": "checkpoint",
                "data": {
                    "tick": tick,
                    "elapsed": round(elapsed, 2),
                    "progress": round(min(1.0, elapsed / duration), 4),
                },
            }
        )

    _emit(
        {
            "result": {"ticks": tick, "elapsed": round(time.time() - start, 2)},
            "mentat_meta": {
                "seconds": round(time.time() - start, 4),
                "model": "sleep/0.1.0",
            },
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
