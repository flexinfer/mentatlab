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
    Emit a structured simulation of a small network of subconscious subcomponents.
    - Subcomponents produce short comments about the prompt.
    - The 'ego' agent integrates their outputs incrementally and evolves an integration score.
    - Messages are emitted as streaming NDJSON (text:stream, progress, stream:status, stream_end).
    """
    base = {
        "agent_id": agent_id,
        "stream_id": stream_id,
        "timestamp": _now_iso(),
    }

    # Define subcomponents and deterministic behaviour
    subcomponents = [
        {"id": "id_core", "role": "core", "voice": "matter-of-fact"},
        {"id": "superego", "role": "moral", "voice": "concerned"},
        {"id": "shadow", "role": "repressed", "voice": "dark"},
        {"id": "memory", "role": "recall", "voice": "remembering"},
        {"id": "intuition", "role": "intuition", "voice": "whisper"},
    ]

    # stream_start
    start_msg = {
        **base,
        "id": str(uuid.uuid4()),
        "type": "stream_start",
        "data": {"message": "psyche stream initiated", "agent": agent_id},
        "sequence": 0,
    }
    _emit_stream_message(start_msg)

    # Ego internal state (evolves)
    ego_state = {"integration_score": 0.0, "history": []}

    total_rounds = max(1, len(text_chunks))
    sequence = 1

    # For each round (derived from chunks) run each subcomponent and have ego integrate
    for round_idx in range(total_rounds):
        prompt_fragment = text_chunks[round_idx] if round_idx < len(text_chunks) else text_chunks[-1]

        # Each subcomponent produces a short reaction
        sub_outputs = []
        for comp in subcomponents:
            # Deterministic pseudo-response
            resp = f"{comp['id']} ({comp['role']}): reacts to '{prompt_fragment[:40]}'"
            sub_outputs.append({"component": comp["id"], "text": resp})

            # Emit the subcomponent chunk as text:stream
            msg = {
                **base,
                "id": str(uuid.uuid4()),
                "type": "text:stream",
                "content": resp,
                "isComplete": False,
                "sequence": sequence,
                "model": {"name": AGENT_MODEL, "provider": "psyche-sim", "component": comp["id"]},
            }
            _emit_stream_message(msg)
            sequence += 1

            # Small progress per component
            progress = {
                **base,
                "id": str(uuid.uuid4()),
                "type": "progress",
                "operation": f"{comp['id']}.process",
                "progress": int((sequence % 100)),
                "message": f"{comp['id']} processed fragment {round_idx+1}",
                "details": {"round": round_idx + 1, "component": comp["id"]},
                "sequence": sequence,
            }
            _emit_stream_message(progress)
            sequence += 1

            time.sleep(chunk_delay * 0.6)

        # Ego integrates subcomponent outputs
        integration_text = " | ".join([o["text"] for o in sub_outputs])
        # Simple integration rule: integration_score increases with length of integration_text
        added = min(1.0, len(integration_text) / 200.0)
        ego_state["integration_score"] = round(ego_state["integration_score"] + added, 3)
        ego_state["history"].append({"round": round_idx + 1, "integration": integration_text})

        ego_msg_text = f"ego: integrated round {round_idx+1}; score={ego_state['integration_score']}"
        ego_msg = {
            **base,
            "id": str(uuid.uuid4()),
            "type": "text:stream",
            "content": ego_msg_text,
            "isComplete": False,
            "sequence": sequence,
            "model": {"name": AGENT_MODEL, "provider": "psyche-sim", "component": "ego"},
        }
        _emit_stream_message(ego_msg)
        sequence += 1

        # Emit a stream status update for this round
        status_msg = {
            **base,
            "id": str(uuid.uuid4()),
            "type": "stream:status",
            "status": "active",
            "progress": {"current": round_idx + 1, "total": total_rounds, "percentage": int(((round_idx + 1) / total_rounds) * 100)},
            "sequence": sequence,
        }
        _emit_stream_message(status_msg)
        sequence += 1

        time.sleep(chunk_delay)

    # Finalize: ego produces the final integrated response
    final_response = f"Ego final synthesis (score={ego_state['integration_score']}): " \
                     f"{' // '.join([h['integration'][:60] for h in ego_state['history']])}"

    final_msg = {
        **base,
        "id": str(uuid.uuid4()),
        "type": "text:stream",
        "content": final_response,
        "isComplete": True,
        "sequence": sequence,
        "model": {"name": AGENT_MODEL, "provider": "psyche-sim", "component": "ego"},
    }
    _emit_stream_message(final_msg)
    sequence += 1

    # stream status -> completed
    status_msg = {
        **base,
        "id": str(uuid.uuid4()),
        "type": "stream:status",
        "status": "completed",
        "progress": {"current": total_rounds, "total": total_rounds, "percentage": 100},
        "sequence": sequence,
    }
    _emit_stream_message(status_msg)
    sequence += 1

    # legacy stream_end event
    end_msg = {
        **base,
        "id": str(uuid.uuid4()),
        "type": "stream_end",
        "data": {"message": "psyche stream ended", "final_score": ego_state["integration_score"]},
        "sequence": sequence,
    }
    _emit_stream_message(end_msg)
    # small pause
    time.sleep(0.02)


def process(spec: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Implement a simple Psyche simulation flow based on the examples/psyche-simulation.
    - Creates per-subcomponent outputs
    - Produces an 'ego' integrated final text and graph summary that mirrors the UI's Flow schema.
    """
    # Base result structure
    result: Dict[str, Any] = {"components": {}, "ego": {}}

    prompt = ""
    if isinstance(spec, dict) and isinstance(spec.get("prompt"), str):
        prompt = spec["prompt"].strip()
    else:
        prompt = str(spec) if spec is not None else " "

    # Subcomponents (same roles as in streaming)
    subcomponents = [
        {"id": "id_core", "role": "core"},
        {"id": "superego", "role": "moral"},
        {"id": "shadow", "role": "repressed"},
        {"id": "memory", "role": "recall"},
        {"id": "intuition", "role": "intuition"},
    ]

    # Each subcomponent produces a deterministic "thought"
    for comp in subcomponents:
        comp_text = f"{comp['id']} ({comp['role']}): reflection on '{prompt[:60]}'"
        result["components"][comp["id"]] = {
            "role": comp["role"],
            "text": comp_text,
            "confidence": round(0.5 + (len(comp_text) % 10) / 20.0, 3)
        }

    # Ego integrates: simple concatenation and a computed score
    integration_pieces = [v["text"] for v in result["components"].values()]
    ego_text = " || ".join(integration_pieces)
    integration_score = round(min(10.0, max(0.0, len(ego_text) / 80.0)), 3)

    result["ego"] = {
        "integrated_text": ego_text,
        "integration_score": integration_score,
        "analysis": f"Ego produced integration with score {integration_score}"
    }

    # Graph summary for UI consumption
    graph_payload = {
        "flow": {
            "apiVersion": "v1",
            "kind": "Flow",
            "meta": {
                "id": str(uuid.uuid4()),
                "name": "psyche-sim-network",
                "version": "0.2.0",
                "createdAt": _now_iso(),
            },
            "graph": {
                "nodes": [
                    {"id": comp["id"], "type": "psyche.subcomponent", "position": {"x": 100 + idx * 120, "y": 100}, "isMediaNode": False}
                    for idx, comp in enumerate(subcomponents)
                ] + [
                    {"id": "ego", "type": "psyche.ego", "position": {"x": 100 + len(subcomponents) * 120, "y": 250}, "isMediaNode": False}
                ],
                "edges": [
                    {"from": comp["id"], "to": "ego"} for comp in subcomponents
                ],
            },
            "runConfig": {
                "streamingConfig": {"enableRealtime": True, "defaultChunkSize": 1024}
            },
        }
    }

    result["graph_summary"] = graph_payload
    if context is not None:
        result["context_received"] = context

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