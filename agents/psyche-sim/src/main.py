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
import os
import datetime
from typing import Any, Dict, Optional
import ast
import urllib.request
import urllib.error
import urllib.request
import urllib.error

# Add structured NDJSON emit helper imports
try:
    from agents.common.emit import (
        log_info,
        log_error,
        checkpoint,
        emit_event,
        set_correlation_id,
    )
except Exception:
    # Fallback if namespace package resolution differs in certain environments
    import sys as _sys, os as _os

    _sys.path.append(
        _os.path.abspath(_os.path.join(_os.path.dirname(__file__), "..", ".."))
    )
    from agents.common.emit import (
        log_info,
        log_error,
        checkpoint,
        emit_event,
        set_correlation_id,
    )

AGENT_MODEL = "psyche-sim/0.1.0"


def _parse_maybe_json_or_python_dict(s: str) -> Optional[Dict[str, Any]]:
    if not isinstance(s, str) or not s.strip():
        return None
    # Try JSON first
    try:
        v = json.loads(s)
        if isinstance(v, dict):
            return v
    except Exception:
        pass
    # Fallback: Python literal dict (single quotes) from str(value)
    try:
        v = ast.literal_eval(s)
        if isinstance(v, dict):
            return v
    except Exception:
        pass
    return None


def read_input() -> Optional[Dict[str, Any]]:
    """Read a single JSON object from stdin (single-line preferred),
    falling back to INPUT_SPEC/INPUT_CONTEXT env vars when stdin is empty.
    """
    # 1) stdin path
    try:
        raw = sys.stdin.read()
        if raw:
            raw = raw.strip()
            if raw:
                return json.loads(raw)
    except Exception:
        pass

    # 2) env fallback path (from orchestrator passing inputs as env vars)
    try:
        spec_s = os.environ.get("INPUT_SPEC", "")
        ctx_s = os.environ.get("INPUT_CONTEXT", "")
        spec = _parse_maybe_json_or_python_dict(spec_s) if spec_s else None
        ctx = _parse_maybe_json_or_python_dict(ctx_s) if ctx_s else None
        if spec or ctx:
            incoming: Dict[str, Any] = {}
            if spec:
                incoming["spec"] = spec
            if ctx:
                incoming["context"] = ctx
            return incoming
    except Exception:
        pass
    return None


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())


# CloudEvents helpers and config (opt-in via env)
_CE_CONFIG: Dict[str, Any] = {
    "enabled": False,
    "source": "/mentatlab/agent/psyche-sim",
    "specversion": "1.0",
    "execution_id": None,
    "checkpoint_interval": 0,
}


def _now_rfc3339() -> str:
    return (
        datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
    )


def _env_flag_true(val: Optional[str]) -> bool:
    if val is None:
        return False
    return val.strip().lower() in ("1", "true", "yes", "on")


def derive_type(payload: dict, default_type: str = "agent.data") -> str:
    # checks payload.get("type") or payload.get("event_type") safely.
    t = None
    if isinstance(payload, dict):
        t = payload.get("type") or payload.get("event_type")
    return t if isinstance(t, str) and t else default_type


def make_cloudevent(
    payload: dict,
    event_type: str,
    source: str,
    specversion: str,
    execution_id: Optional[str],
) -> dict:
    # returns envelope dict with uuid4 id and RFC3339 UTC time, and ce-execution_id when provided.
    evt = {
        "specversion": specversion,
        "id": str(uuid.uuid4()),
        "source": source,
        "type": event_type,
        "time": _now_rfc3339(),
        "datacontenttype": "application/json",
        "data": payload,
    }
    if execution_id:
        evt["ce-execution_id"] = execution_id
    return evt


def _emit_stream_message(msg: Dict[str, Any]) -> None:
    """
    Emit a single JSON streaming message to stdout (NDJSON), flush immediately.
    This function is used for streaming messages that the UI/gateway expects.
    """
    # Also surface an info log for debugging stream types
    try:
        # keep logs minimal to avoid excessive noise
        if isinstance(msg, dict) and "type" in msg:
            log_info(
                f"stream_event:{msg.get('type')}",
                data={"sequence": msg.get("sequence")},
            )
    except Exception:
        pass
    try:
        if _CE_CONFIG.get("enabled"):
            evt_type = derive_type(msg, "agent.data")
            wrapped = make_cloudevent(
                msg,
                evt_type,
                _CE_CONFIG.get("source", "/mentatlab/agent/psyche-sim"),
                _CE_CONFIG.get("specversion", "1.0"),
                _CE_CONFIG.get("execution_id"),
            )
            sys.stdout.write(
                json.dumps(wrapped, separators=(",", ":"), ensure_ascii=False) + "\n"
            )
        else:
            sys.stdout.write(
                json.dumps(msg, separators=(",", ":"), ensure_ascii=False) + "\n"
            )
        sys.stdout.flush()
    except Exception:
        # If streaming fails, continue — final result will still be printed.
        pass


def _simulate_streaming(
    agent_id: str,
    stream_id: str,
    text_chunks: list,
    chunk_delay: float = 0.25,
    final_override: Optional[str] = None,
):
    """
    Emit a structured simulation of a small network of subconscious subcomponents.
    - Subcomponents produce short comments about the prompt.
    - The 'ego' agent integrates their outputs incrementally and evolves an integration score.
    - Messages are emitted as streaming NDJSON (text:stream, progress, stream:status, stream_end).
    """
    # Announce streaming phase via contract log + checkpoint
    log_info(
        "psyche-sim: streaming simulation start",
        data={"agent_id": agent_id, "stream_id": stream_id},
    )
    checkpoint("streaming_start", 0.0, {"agent_id": agent_id, "stream_id": stream_id})
    base = {
        "agent_id": agent_id,
        "stream_id": stream_id,
        "timestamp": _now_iso(),
    }
    checkpoint_interval = int(_CE_CONFIG.get("checkpoint_interval") or 0)
    stream_data_count = 0
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
        prompt_fragment = (
            text_chunks[round_idx] if round_idx < len(text_chunks) else text_chunks[-1]
        )
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
                "model": {
                    "name": AGENT_MODEL,
                    "provider": "psyche-sim",
                    "component": comp["id"],
                },
            }
            _emit_stream_message(msg)
            sequence += 1
            # Checkpoint after N stream_data events (count text:stream only)
            if checkpoint_interval > 0:
                stream_data_count += 1
                if stream_data_count % checkpoint_interval == 0:
                    checkpoint_msg = {
                        **base,
                        "id": str(uuid.uuid4()),
                        "type": "agent.checkpoint",
                        "data": {
                            "stream_data_count": stream_data_count,
                            "sequence": sequence,
                            "round": round_idx + 1,
                        },
                        "sequence": sequence,
                    }
                    _emit_stream_message(checkpoint_msg)
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
        ego_state["integration_score"] = round(
            ego_state["integration_score"] + added, 3
        )
        ego_state["history"].append(
            {"round": round_idx + 1, "integration": integration_text}
        )
        ego_msg_text = f"ego: integrated round {round_idx+1}; score={ego_state['integration_score']}"
        ego_msg = {
            **base,
            "id": str(uuid.uuid4()),
            "type": "text:stream",
            "content": ego_msg_text,
            "isComplete": False,
            "sequence": sequence,
            "model": {
                "name": AGENT_MODEL,
                "provider": "psyche-sim",
                "component": "ego",
            },
        }
        _emit_stream_message(ego_msg)
        sequence += 1
        if checkpoint_interval > 0:
            stream_data_count += 1
            if stream_data_count % checkpoint_interval == 0:
                checkpoint_msg = {
                    **base,
                    "id": str(uuid.uuid4()),
                    "type": "agent.checkpoint",
                    "data": {
                        "stream_data_count": stream_data_count,
                        "sequence": sequence,
                        "round": round_idx + 1,
                    },
                    "sequence": sequence,
                }
                _emit_stream_message(checkpoint_msg)
                sequence += 1
        # Emit a stream status update for this round
        status_msg = {
            **base,
            "id": str(uuid.uuid4()),
            "type": "stream:status",
            "status": "active",
            "progress": {
                "current": round_idx + 1,
                "total": total_rounds,
                "percentage": int(((round_idx + 1) / total_rounds) * 100),
            },
            "sequence": sequence,
        }
        _emit_stream_message(status_msg)
        # Emit a checkpoint per round according to the agent contract
        try:
            checkpoint(
                "round",
                (round_idx + 1) / float(total_rounds),
                {"round": round_idx + 1, "total_rounds": total_rounds},
            )
        except Exception:
            pass
        sequence += 1
        time.sleep(chunk_delay)
    # Finalize: ego produces the final integrated response (optionally overridden by vLLM)
    if isinstance(final_override, str) and final_override.strip():
        final_response = final_override.strip()
    else:
        final_response = (
            f"Ego final synthesis (score={ego_state['integration_score']}): "
            f"{' // '.join([h['integration'][:60] for h in ego_state['history']])}"
        )
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
    if checkpoint_interval > 0:
        stream_data_count += 1
        if stream_data_count % checkpoint_interval == 0:
            checkpoint_msg = {
                **base,
                "id": str(uuid.uuid4()),
                "type": "agent.checkpoint",
                "data": {
                    "stream_data_count": stream_data_count,
                    "sequence": sequence,
                    "round": total_rounds,
                },
                "sequence": sequence,
            }
            _emit_stream_message(checkpoint_msg)
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
        "data": {
            "message": "psyche stream ended",
            "final_score": ego_state["integration_score"],
        },
        "sequence": sequence,
    }
    _emit_stream_message(end_msg)
    # streaming completed checkpoint
    try:
        checkpoint(
            "streaming_complete", 1.0, {"agent_id": agent_id, "stream_id": stream_id}
        )
        log_info(
            "psyche-sim: streaming simulation complete",
            data={"agent_id": agent_id, "stream_id": stream_id},
        )
    except Exception:
        pass
    # small pause
    time.sleep(0.02)


def _http_post_json(
    url: str, payload: Dict[str, Any], timeout: float = 20.0
) -> tuple[int, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="ignore")
        return resp.status or 0, body


def _vllm_generate_text(
    base: str, prompt: str, model: Optional[str] = None
) -> Optional[str]:
    if not base:
        return None
    b = base.rstrip("/")
    # Try OpenAI-style chat.completions
    payload = {
        "model": model or "",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
        "max_tokens": 256,
    }
    try:
        status, body = _http_post_json(f"{b}/v1/chat/completions", payload)
        if 200 <= status < 300:
            obj = json.loads(body)
            choices = obj.get("choices") or []
            if choices and choices[0].get("message", {}).get("content"):
                return str(choices[0]["message"]["content"]).strip()
    except Exception:
        pass
    # Try OpenAI-style completions
    try:
        payload2 = {
            "model": model or "",
            "prompt": prompt,
            "temperature": 0.7,
            "max_tokens": 256,
        }
        status, body = _http_post_json(f"{b}/v1/completions", payload2)
        if 200 <= status < 300:
            obj = json.loads(body)
            choices = obj.get("choices") or []
            if choices and (choices[0].get("text") is not None):
                return str(choices[0]["text"]).strip()
    except Exception:
        pass
    # Try vLLM non-OpenAI generate
    try:
        payload3 = {"prompt": prompt, "temperature": 0.7, "max_tokens": 256}
        status, body = _http_post_json(f"{b}/generate", payload3)
        if 200 <= status < 300:
            obj = json.loads(body)
            if isinstance(obj, dict) and obj.get("text"):
                return str(obj["text"]).strip()
            if isinstance(obj, dict) and obj.get("outputs"):
                outs = obj["outputs"]
                if outs and outs[0].get("text"):
                    return str(outs[0]["text"]).strip()
    except Exception:
        pass
    return None


def _vllm_stream_chat(base: str, prompt: str, model: Optional[str] = None):
    """Yield text deltas from vLLM OpenAI-style streaming when available."""
    if not base:
        return
    b = base.rstrip("/")
    payload = {
        "model": model or "",
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "temperature": 0.7,
        "max_tokens": 1024,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{b}/v1/chat/completions",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            for raw in resp:
                try:
                    line = raw.decode("utf-8", errors="ignore").strip()
                except Exception:
                    continue
                if not line or not line.startswith("data:"):
                    continue
                chunk = line[5:].strip()
                if chunk == "[DONE]":
                    break
                try:
                    obj = json.loads(chunk)
                    delta = ((obj.get("choices") or [{}])[0].get("delta") or {}).get(
                        "content"
                    )
                    if isinstance(delta, str) and delta:
                        yield delta
                except Exception:
                    continue
    except Exception:
        return


def process(
    spec: Dict[str, Any], context: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
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
            "confidence": round(0.5 + (len(comp_text) % 10) / 20.0, 3),
        }

    # Ego integrates: simple concatenation and a computed score
    integration_pieces = [v["text"] for v in result["components"].values()]
    ego_text = " || ".join(integration_pieces)
    integration_score = round(min(10.0, max(0.0, len(ego_text) / 80.0)), 3)

    result["ego"] = {
        "integrated_text": ego_text,
        "integration_score": integration_score,
        "analysis": f"Ego produced integration with score {integration_score}",
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
                    {
                        "id": comp["id"],
                        "type": "psyche.subcomponent",
                        "position": {"x": 100 + idx * 120, "y": 100},
                        "isMediaNode": False,
                    }
                    for idx, comp in enumerate(subcomponents)
                ]
                + [
                    {
                        "id": "ego",
                        "type": "psyche.ego",
                        "position": {"x": 100 + len(subcomponents) * 120, "y": 250},
                        "isMediaNode": False,
                    }
                ],
                "edges": [{"from": comp["id"], "to": "ego"} for comp in subcomponents],
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


def make_output(
    result_payload: Dict[str, Any], start_time: float, end_time: float
) -> Dict[str, Any]:
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
    # Emit process start log/checkpoint
    try:
        log_info("psyche-sim: start")
        checkpoint("start", 0.0)
    except Exception:
        pass
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
            # Emit error log
            try:
                log_error("psyche-sim: no stdin input")
            except Exception:
                pass
            return 1

        spec = incoming.get("spec") if isinstance(incoming, dict) else incoming
        context = incoming.get("context") if isinstance(incoming, dict) else None
        # Correlate by execution_id if present
        try:
            exec_id_for_corr = None
            if isinstance(incoming, dict):
                exec_id_for_corr = incoming.get("execution_id")
            if not exec_id_for_corr and isinstance(context, dict):
                exec_id_for_corr = context.get("execution_id")
            if exec_id_for_corr:
                set_correlation_id(str(exec_id_for_corr))
        except Exception:
            pass
        # Configure CloudEvents/Checkpoint from environment and incoming context
        ce_enabled = _env_flag_true(os.environ.get("PSYCHE_SIM_CE_ENABLED"))
        ce_source = os.environ.get(
            "PSYCHE_SIM_CE_SOURCE", "/mentatlab/agent/psyche-sim"
        )
        ce_version = os.environ.get("PSYCHE_SIM_CE_VERSION", "1.0")
        try:
            checkpoint_interval = int(
                os.environ.get("PSYCHE_SIM_CHECKPOINT_INTERVAL", "0") or "0"
            )
        except Exception:
            checkpoint_interval = 0
        exec_header = os.environ.get("PSYCHE_SIM_EXECUTION_ID_HEADER", "X-Execution-Id")

        execution_id: Optional[str] = None
        if isinstance(incoming, dict):
            v = incoming.get("execution_id")
            if isinstance(v, str) and v:
                execution_id = v
        if not execution_id and isinstance(context, dict):
            v = context.get("execution_id")
            if isinstance(v, str) and v:
                execution_id = v
            else:
                headers = context.get("headers")
                if isinstance(headers, dict) and exec_header:
                    target = exec_header.lower()
                    for k, v in headers.items():
                        if isinstance(k, str) and k.lower() == target:
                            execution_id = v if isinstance(v, str) else str(v)
                            break

        _CE_CONFIG.update(
            {
                "enabled": ce_enabled,
                "source": ce_source,
                "specversion": ce_version,
                "execution_id": execution_id,
                "checkpoint_interval": checkpoint_interval,
            }
        )

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
                text_chunks = [
                    "Psyche Simulation streaming message 1.",
                    "...message 2...",
                    "Final chunk.",
                ]

            # vLLM integration: if enabled, stream deltas from the model as text:stream
            vllm_base = os.environ.get("VLLM_BASE_URL", "").strip()
            use_vllm = _env_flag_true(os.environ.get("PSYCHE_USE_VLLM", "1")) and bool(
                vllm_base
            )
            vllm_model = os.environ.get("VLLM_MODEL", "")

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
            try:
                log_info(
                    "psyche-sim: initializing stream",
                    data={"agent_id": agent_id, "stream_id": stream_id},
                )
                checkpoint(
                    "initializing", 0.05, {"agent_id": agent_id, "stream_id": stream_id}
                )
            except Exception:
                pass
            if use_vllm and isinstance(spec, dict):
                prompt_val = spec.get("prompt") or ""
                # Announce start
                start_evt = {
                    "id": str(uuid.uuid4()),
                    "type": "stream_start",
                    "timestamp": _now_iso(),
                    "agent_id": agent_id,
                    "stream_id": stream_id,
                    "data": {"message": "psyche vLLM stream initiated"},
                    "sequence": 1,
                }
                _emit_stream_message(start_evt)
                seq = 2
                acc = []
                for delta in (
                    _vllm_stream_chat(vllm_base, str(prompt_val), vllm_model) or []
                ):
                    acc.append(delta)
                    msg = {
                        "id": str(uuid.uuid4()),
                        "type": "text:stream",
                        "timestamp": _now_iso(),
                        "agent_id": agent_id,
                        "stream_id": stream_id,
                        "content": delta,
                        "isComplete": False,
                        "sequence": seq,
                        "model": {
                            "name": AGENT_MODEL,
                            "provider": "psyche-sim",
                            "component": "vllm",
                        },
                    }
                    _emit_stream_message(msg)
                    seq += 1
                    status = {
                        "id": str(uuid.uuid4()),
                        "type": "stream:status",
                        "timestamp": _now_iso(),
                        "agent_id": agent_id,
                        "stream_id": stream_id,
                        "status": "active",
                        "progress": {"current": seq, "total": 0, "percentage": 0},
                        "sequence": seq,
                    }
                    _emit_stream_message(status)
                    seq += 1
                final_text = ("".join(acc)).strip()
                if final_text:
                    final_msg = {
                        "id": str(uuid.uuid4()),
                        "type": "text:stream",
                        "timestamp": _now_iso(),
                        "agent_id": agent_id,
                        "stream_id": stream_id,
                        "content": final_text,
                        "isComplete": True,
                        "sequence": seq,
                        "model": {
                            "name": AGENT_MODEL,
                            "provider": "psyche-sim",
                            "component": "vllm",
                        },
                    }
                    _emit_stream_message(final_msg)
                    seq += 1
                status_done = {
                    "id": str(uuid.uuid4()),
                    "type": "stream:status",
                    "timestamp": _now_iso(),
                    "agent_id": agent_id,
                    "stream_id": stream_id,
                    "status": "completed",
                    "progress": {"current": seq, "total": seq, "percentage": 100},
                    "sequence": seq,
                }
                _emit_stream_message(status_done)
                end_evt = {
                    "id": str(uuid.uuid4()),
                    "type": "stream_end",
                    "timestamp": _now_iso(),
                    "agent_id": agent_id,
                    "stream_id": stream_id,
                    "data": {"message": "psyche vLLM stream ended"},
                    "sequence": seq + 1,
                }
                _emit_stream_message(end_evt)
            else:
                # Simulated streaming with optional model-crafted final line
                final_override = (
                    _vllm_generate_text(vllm_base, spec.get("prompt", ""))
                    if vllm_base
                    else None
                )
                _simulate_streaming(
                    agent_id=agent_id,
                    stream_id=stream_id,
                    text_chunks=text_chunks,
                    chunk_delay=chunk_delay,
                    final_override=final_override,
                )
            # Small pause to ensure consumer can process
            time.sleep(0.05)

        # Always compute the final result payload (graph + text)
        result_payload = process(spec or {}, context)
        end_time = time.time()
        output = make_output(result_payload, start_time, end_time)
        # Emit the final single-line JSON result (orchestrator contract)
        if _CE_CONFIG.get("enabled"):
            final_envelope = make_cloudevent(
                output,
                "agent.final",
                _CE_CONFIG.get("source", "/mentatlab/agent/psyche-sim"),
                _CE_CONFIG.get("specversion", "1.0"),
                _CE_CONFIG.get("execution_id"),
            )
            print(json.dumps(final_envelope, separators=(",", ":"), ensure_ascii=False))
        else:
            print(json.dumps(output, separators=(",", ":"), ensure_ascii=False))
        sys.stdout.flush()
        # Completion log/checkpoint
        try:
            checkpoint("end", 1.0)
            log_info(
                "psyche-sim: completed",
                data={"seconds": round(end_time - start_time, 4)},
            )
        except Exception:
            pass
        return 0

    except Exception as exc:
        end_time = time.time()
        tb = traceback.format_exc()
        error_payload = {
            "error": "Internal agent error",
            "exception": str(exc),
            "traceback": tb,
        }
        out = make_output(error_payload, start_time, end_time)
        print(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
        sys.stdout.flush()
        # Emit error log
        try:
            log_error("psyche-sim: internal error", data={"exception": str(exc)})
        except Exception:
            pass
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
