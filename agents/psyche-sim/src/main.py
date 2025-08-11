#!/usr/bin/env python3
"""
Psyche‑Sim Cog‑Pak - headless stdin→stdout agent

Contract:
- Reads a single-line JSON object from stdin with fields:
  {
    "spec": { ... },
    "context": { ... }   # optional
  }

- Writes a single-line JSON object to stdout with fields:
  {
    "result": { ... },
    "mentat_meta": { "tokens_input": 0, "tokens_output": 0, "seconds": 0.0, "model": "psyche-sim/0.1.0" }
  }

Additionally, when spec.get("mode") == "stream", this agent will emit
streaming messages (one JSON object per line, flushed) that follow the
frontend streaming shape (see services/frontend/src/types/streaming.ts).

This file replaces the original scaffold to provide a simple deterministic
streaming simulation useful for MissionControl graph UI testing.
"""
from __future__ import annotations

import json
import sys
import time
import traceback
import uuid
from typing import Any, Dict, Optional

AGENT_MODEL = "psyche-sim/0.1.0"


def read_input() -> Optional[Dict[str, Any]]:
    """Read a single JSON object from stdin (single-line preferred)."""
    try:
        raw = sys.stdin.read()
        if not raw:
            return None
        raw = raw.strip()
        if not raw:
            return None
        return json.loads(raw)
    except Exception:
        return None


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())


def _emit_stream_message(msg: Dict[str, Any]) -> None:
    """
    Emit a single JSON streaming message to stdout (NDJSON), flush immediately.
    This function is used for streaming messages that the UI/gateway expects.
    """
    try:
        sys.stdout.write(json.dumps(msg, separators=(",", ":"), ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception:
        # If streaming fails, continue — final result will still be printed.
        pass


def _simulate_streaming(agent_id: str, stream_id: str, text_chunks: list, chunk_delay: float = 0.25):
    """
    Emit a small sequence of streaming messages:
      - stream_start (legacy)
      - multiple text:stream messages (isComplete false until last)
      - progress updates
      - stream:status completed
      - media: none here but could be added
    """
    base = {
        "agent_id": agent_id,
        "stream_id": stream_id,
        "timestamp": _now_iso(),
    }

    # stream_start (legacy)
    start_msg = {
        **base,
        "id": str(uuid.uuid4()),
        "type": "stream_start",
        "data": {"message": "stream started", "agent": agent_id},
        "sequence": 0,
    }
    _emit_stream_message(start_msg)

    total = len(text_chunks)
    for i, chunk in enumerate(text_chunks, start=1):
        msg = {
            **base,
            "id": str(uuid.uuid4()),
            "type": "text:stream",
            "content": chunk,
            "isComplete": False if i < total else True,
            "sequence": i,
            "model": {"name": AGENT_MODEL, "provider": "psyche-sim"},
        }
        _emit_stream_message(msg)

        # progress message
        progress = {
            **base,
            "id": str(uuid.uuid4()),
            "type": "progress",
            "operation": "thinking",
            "progress": int((i / total) * 100),
            "message": f"Chunk {i}/{total}",
            "details": {"current": i, "total": total},
            "sequence": i,
        }
        _emit_stream_message(progress)

        time.sleep(chunk_delay)

    # stream status -> completed
    status_msg = {
        **base,
        "id": str(uuid.uuid4()),
        "type": "stream:status",
        "status": "completed",
        "progress": {"current": total, "total": total, "percentage": 100},
        "sequence": total + 1,
    }
    _emit_stream_message(status_msg)

    # legacy stream_end event
    end_msg = {
        **base,
        "id": str(uuid.uuid4()),
        "type": "stream_end",
        "data": {"message": "stream ended"},
        "sequence": total + 2,
    }
    _emit_stream_message(end_msg)


def process(spec: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Minimal processing: if 'prompt' present return an echo; if mode=stream,
    the caller will perform streaming emission and then the final payload is returned.
    """
    result: Dict[str, Any] = {}
    if isinstance(spec, dict):
        if "prompt" in spec and isinstance(spec["prompt"], str):
            prompt = spec["prompt"].strip()
            # Simple deterministic reply for now
            reply = f"Echo: {prompt}"
            result["text"] = reply
            result["source"] = "psyche-sim-echo"
        else:
            result["echo"] = spec
    else:
        result["echo"] = spec

    if context is not None:
        result["context_received"] = context

    # augment with a small graph-like payload to help MissionControl graph UI render nodes/edges
    # This is intentionally lightweight. The frontend expects Flow / Node / Edge shapes.
    graph_payload = {
        "flow": {
            "apiVersion": "v1",
            "kind": "Flow",
            "meta": {
                "id": str(uuid.uuid4()),
                "name": "psyche-sim-demo",
                "version": "0.1.0",
                "createdAt": _now_iso(),
            },
            "graph": {
                "nodes": [
                    {
                        "id": "agent.self",
                        "type": "psyche-agent",
                        "position": {"x": 100, "y": 100},
                        "isMediaNode": False,
                        "inputs": {},
                        "outputs": {},
                    },
                    {
                        "id": "output.text",
                        "type": "media:display",
                        "position": {"x": 400, "y": 100},
                        "isMediaNode": False,
                        "inputs": {},
                        "outputs": {},
                    },
                ],
                "edges": [
                    {"from": "agent.self", "to": "output.text"},
                ],
            },
            "runConfig": {
                "streamingConfig": {"enableRealtime": True, "defaultChunkSize": 1024}
            },
        }
    }

    result["graph_summary"] = graph_payload
    return result


def make_output(result_payload: Dict[str, Any], start_time: float, end_time: float) -> Dict[str, Any]:
    """Wrap result with mentat_meta observability block."""
    seconds = round(end_time - start_time, 4)
    mentat_meta = {
        "tokens_input": 0,
        "tokens_output": 0,
        "seconds": seconds,
        "model": AGENT_MODEL,
    }
    return {"result": result_payload, "mentat_meta": mentat_meta}


def main() -> int:
    start_time = time.time()
    try:
        incoming = read_input()
        if incoming is None:
            # No stdin provided — write helpful JSON and exit non-zero
            err = {
                "error": "No input received on stdin. Please provide a single-line JSON object with keys 'spec' and optional 'context'."
            }
            end_time = time.time()
            out = make_output(err, start_time, end_time)
            print(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
            return 1

        spec = incoming.get("spec") if isinstance(incoming, dict) else incoming
        context = incoming.get("context") if isinstance(incoming, dict) else None

        # If streaming mode requested, simulate an NDJSON stream before final output
        mode = None
        if isinstance(spec, dict):
            mode = spec.get("mode")
        if mode == "stream":
            # Build simple chunks from prompt (or default message)
            if isinstance(spec, dict) and isinstance(spec.get("prompt"), str):
                prompt = spec["prompt"]
                # naive chunking: split on spaces into 6 roughly-equal chunks
                words = prompt.split()
                if not words:
                    text_chunks = ["(no content)"]
                else:
                    n = max(1, min(6, len(words)))
                    size = max(1, len(words) // n)
                    text_chunks = []
                    for i in range(0, len(words), size):
                        text_chunks.append(" ".join(words[i : i + size]))
            else:
                text_chunks = ["Psyche Simulation streaming message 1.", "...message 2...", "Final chunk."]

            # Allow override of chunk_delay
            chunk_delay = 0.25
            if isinstance(spec, dict) and "chunk_delay" in spec:
                try:
                    cd = float(spec.get("chunk_delay") or 0.25)
                    chunk_delay = max(0.0, min(2.0, cd))
                except Exception:
                    chunk_delay = 0.25

            agent_id = spec.get("agent_id", "mentatlab.psyche-sim")
            stream_id = spec.get("stream_id", str(uuid.uuid4()))

            # Emit a small header status as NDJSON (use streaming schema)
            header = {
                "id": str(uuid.uuid4()),
                "type": "stream:status",
                "timestamp": _now_iso(),
                "agent_id": agent_id,
                "stream_id": stream_id,
                "status": "initializing",
                "sequence": 0,
            }
            _emit_stream_message(header)

            # Simulate streaming chunks
            _simulate_streaming(agent_id=agent_id, stream_id=stream_id, text_chunks=text_chunks, chunk_delay=chunk_delay)

            # Small pause to ensure consumer can process
            time.sleep(0.05)

        # Always compute the final result payload (graph + text)
        result_payload = process(spec or {}, context)
        end_time = time.time()
        output = make_output(result_payload, start_time, end_time)

        # Emit the final single-line JSON result (orchestrator contract)
        print(json.dumps(output, separators=(",", ":"), ensure_ascii=False))
        sys.stdout.flush()
        return 0

    except Exception as exc:
        end_time = time.time()
        tb = traceback.format_exc()
        error_payload = {
            "error": "Internal agent error",
            "exception": str(exc),
            "traceback": tb
        }
        out = make_output(error_payload, start_time, end_time)
        print(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
        sys.stdout.flush()
        return 2


if __name__ == "__main__":
    raise SystemExit(main())