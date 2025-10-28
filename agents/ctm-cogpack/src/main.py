#!/usr/bin/env python3
"""
CTM Cogpack - Continuous Thought Machine agent

Contract:
- Reads a single-line JSON object from stdin with fields:
  {
    "spec": { ... },
    "context": { ... }   # optional
  }

- Writes a single-line JSON object to stdout with fields:
  {
    "result": { ... },
    "mentat_meta": { "tokens_input": 0, "tokens_output": 0, "seconds": 0.0, "model": "ctm/0.1.0" }
  }

Additionally, when spec.get("mode") == "stream", this agent will emit
streaming messages (one JSON object per line, flushed) following the
frontend streaming shape.

The CTM implements:
- Tick-based temporal processing independent of input sequence
- Neuron-level MLPs with private parameters and oscillation dynamics
- Synapse aggregator and synchronization matrix for inter-neuron communication
- Adaptive computation with certainty-based halting
"""
from __future__ import annotations

import json
import sys
import time
import traceback
import uuid
import os
import datetime
import asyncio
from typing import Any, Dict, Optional, List
import ast
import urllib.request
import urllib.error
try:
    import torch
    import torch.nn as nn
except Exception:  # Optional torch import for minimal images
    torch = None
    nn = None

# CTM modules
from ctm.config import CTMConfig, load_config_from_env
from ctm.timekeeper import TimeKeeper
from ctm.memory import SlidingMemory
from ctm.neuron import NeuronPool
from ctm.synapse import SynapseAggregator
from ctm.sync import SynchronizationMatrix
from ctm.attention import AttentionRouter
from ctm.halting import HaltingController
from ctm.telemetry import TelemetryBus

AGENT_MODEL = "ctm/0.1.0"


def _parse_maybe_json_or_python_dict(s: str) -> Optional[Dict[str, Any]]:
    if not isinstance(s, str) or not s.strip():
        return None
    try:
        v = json.loads(s)
        if isinstance(v, dict):
            return v
    except Exception:
        pass
    try:
        v = ast.literal_eval(s)
        if isinstance(v, dict):
            return v
    except Exception:
        pass
    return None


def _http_post_json(url: str, payload: Dict[str, Any], timeout: float = 20.0) -> tuple[int, str]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="ignore")
        return resp.status or 0, body


def _vllm_generate_text(base: str, prompt: str, model: Optional[str] = None) -> Optional[str]:
    if not base:
        return None
    b = base.rstrip('/')
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
    # 2) env fallback path
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


def _now_rfc3339() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _env_flag_true(val: Optional[str]) -> bool:
    if val is None:
        return False
    return val.strip().lower() in ("1", "true", "yes", "on")


# CloudEvents helpers
_CE_CONFIG: Dict[str, Any] = {
    "enabled": False,
    "source": "/mentatlab/agent/ctm-cogpack",
    "specversion": "1.0",
    "execution_id": None,
}


def derive_type(payload: dict, default_type: str = "agent.data") -> str:
    t = None
    if isinstance(payload, dict):
        t = payload.get("type") or payload.get("event_type")
    return t if isinstance(t, str) and t else default_type


def make_cloudevent(payload: dict, event_type: str, source: str, specversion: str, execution_id: Optional[str]) -> dict:
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
    """
    try:
        if _CE_CONFIG.get("enabled"):
            evt_type = derive_type(msg, "agent.data")
            wrapped = make_cloudevent(
                msg,
                evt_type,
                _CE_CONFIG.get("source", "/mentatlab/agent/ctm-cogpack"),
                _CE_CONFIG.get("specversion", "1.0"),
                _CE_CONFIG.get("execution_id"),
            )
            sys.stdout.write(json.dumps(wrapped, separators=(",", ":"), ensure_ascii=False) + "\n")
        else:
            sys.stdout.write(json.dumps(msg, separators=(",", ":"), ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except Exception:
        pass


class CTMProcessor:
    """Main CTM processing engine."""
    
    def __init__(self, config: CTMConfig):
        self.config = config
        if torch is None:
            raise RuntimeError("PyTorch is not available in this image. Install torch or use a compatible image.")
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        
        # Initialize CTM components
        self.timekeeper = TimeKeeper(config.tick)
        self.memory = SlidingMemory(config.compute.history_len)
        self.neuron_pool = NeuronPool(config.compute, self.device)
        self.synapse = SynapseAggregator(config.compute)
        self.sync_matrix = SynchronizationMatrix(config.compute)
        self.attention = AttentionRouter(config.compute, self.device)
        self.halting = HaltingController(config.halting)
        self.telemetry = TelemetryBus(config.telemetry)
        
    def process_tick(self, input_embedding: torch.Tensor, tick: int) -> Dict[str, Any]:
        """Process a single tick of the CTM."""
        tick_data = {"tick": tick}
        
        # Get pre-activations from memory
        pre_activations = self.memory.get_window()
        
        # Neuron processing with oscillations
        neuron_outputs = self.neuron_pool.forward(
            input_embedding, 
            pre_activations,
            tick
        )
        tick_data["neuron_outputs"] = neuron_outputs
        
        # Synapse aggregation
        aggregated = self.synapse.aggregate(neuron_outputs)
        tick_data["aggregated"] = aggregated
        
        # Synchronization computation
        sync_scores = self.sync_matrix.compute(neuron_outputs)
        tick_data["sync_scores"] = sync_scores
        
        # Attention routing
        attended = self.attention.route(aggregated, sync_scores)
        tick_data["attended"] = attended
        
        # Store in memory
        self.memory.push(attended)
        
        # Compute certainty for halting
        certainty = self.halting.compute_certainty(attended, sync_scores)
        tick_data["certainty"] = certainty
        
        return tick_data
    
    async def run_streaming(self, prompt: str, agent_id: str, stream_id: str):
        """Run CTM in streaming mode with telemetry."""
        # Initial embedding from prompt
        input_embedding = self._encode_prompt(prompt)
        
        # Stream start event
        start_msg = {
            "id": str(uuid.uuid4()),
            "type": "stream_start",
            "timestamp": _now_iso(),
            "agent_id": agent_id,
            "stream_id": stream_id,
            "data": {"message": "ctm stream initiated", "config": self.config.to_dict()},
            "sequence": 0
        }
        _emit_stream_message(start_msg)
        
        sequence = 1
        tick = 0
        should_halt = False
        final_output = None
        
        while tick < self.config.tick.max_ticks and not should_halt:
            # Tick start event
            tick_msg = {
                "id": str(uuid.uuid4()),
                "type": "ctm.tick_start",
                "timestamp": _now_iso(),
                "agent_id": agent_id,
                "stream_id": stream_id,
                "data": {"tick": tick},
                "sequence": sequence
            }
            _emit_stream_message(tick_msg)
            sequence += 1
            
            # Process tick
            tick_data = self.process_tick(input_embedding, tick)
            
            # Neuron fire events (sample a few)
            if tick % 5 == 0:  # Every 5 ticks
                for i in range(min(3, self.config.compute.num_neurons)):
                    neuron_msg = {
                        "id": str(uuid.uuid4()),
                        "type": "ctm.neuron.fire",
                        "timestamp": _now_iso(),
                        "agent_id": agent_id,
                        "stream_id": stream_id,
                        "data": {
                            "neuron_id": i,
                            "tick": tick,
                            "activation": float(tick_data["neuron_outputs"][i].mean().item())
                        },
                        "sequence": sequence
                    }
                    _emit_stream_message(neuron_msg)
                    sequence += 1
            
            # Sync update event
            if tick % 3 == 0:
                sync_msg = {
                    "id": str(uuid.uuid4()),
                    "type": "ctm.sync.update",
                    "timestamp": _now_iso(),
                    "agent_id": agent_id,
                    "stream_id": stream_id,
                    "data": {
                        "tick": tick,
                        "mean_sync": float(tick_data["sync_scores"].mean().item())
                    },
                    "sequence": sequence
                }
                _emit_stream_message(sync_msg)
                sequence += 1
            
            # Attention route event
            if tick % 4 == 0:
                attn_msg = {
                    "id": str(uuid.uuid4()),
                    "type": "ctm.attn.route",
                    "timestamp": _now_iso(),
                    "agent_id": agent_id,
                    "stream_id": stream_id,
                    "data": {
                        "tick": tick,
                        "attended_norm": float(tick_data["attended"].norm().item())
                    },
                    "sequence": sequence
                }
                _emit_stream_message(attn_msg)
                sequence += 1
            
            # Progress event
            progress_msg = {
                "id": str(uuid.uuid4()),
                "type": "progress",
                "timestamp": _now_iso(),
                "agent_id": agent_id,
                "stream_id": stream_id,
                "operation": "ctm.tick",
                "progress": int((tick / self.config.tick.max_ticks) * 100),
                "message": f"Processing tick {tick}/{self.config.tick.max_ticks}",
                "details": {"tick": tick, "certainty": float(tick_data["certainty"])},
                "sequence": sequence
            }
            _emit_stream_message(progress_msg)
            sequence += 1
            
            # Check halting condition
            should_halt = self.halting.should_halt(tick_data["certainty"])
            if should_halt:
                final_output = tick_data["attended"]
            
            # Status update
            status_msg = {
                "id": str(uuid.uuid4()),
                "type": "stream:status",
                "timestamp": _now_iso(),
                "agent_id": agent_id,
                "stream_id": stream_id,
                "status": "completed" if should_halt else "active",
                "progress": {
                    "current": tick + 1,
                    "total": self.config.tick.max_ticks,
                    "percentage": int(((tick + 1) / self.config.tick.max_ticks) * 100)
                },
                "sequence": sequence
            }
            _emit_stream_message(status_msg)
            sequence += 1
            
            tick += 1
            await asyncio.sleep(self.config.tick.tick_interval)
        
        # Final output
        if final_output is None:
            final_output = self.process_tick(input_embedding, tick)["attended"]
        
        # Generate text from final output
        final_text = self._decode_output(final_output)
        
        # Final text stream
        final_msg = {
            "id": str(uuid.uuid4()),
            "type": "text:stream",
            "timestamp": _now_iso(),
            "agent_id": agent_id,
            "stream_id": stream_id,
            "content": final_text,
            "isComplete": True,
            "sequence": sequence,
            "model": {"name": AGENT_MODEL, "provider": "ctm", "component": "decoder"}
        }
        _emit_stream_message(final_msg)
        sequence += 1
        
        # Stream end
        end_msg = {
            "id": str(uuid.uuid4()),
            "type": "stream_end",
            "timestamp": _now_iso(),
            "agent_id": agent_id,
            "stream_id": stream_id,
            "data": {
                "message": "ctm stream ended",
                "final_tick": tick,
                "halted": should_halt,
                "certainty": float(tick_data["certainty"])
            },
            "sequence": sequence
        }
        _emit_stream_message(end_msg)
        
        return final_text, tick
    
    def _encode_prompt(self, prompt: str) -> torch.Tensor:
        """Encode prompt to embedding (simplified)."""
        # Simple hash-based encoding for demonstration
        hash_val = hash(prompt) % (2**32)
        torch.manual_seed(hash_val)
        return torch.randn(1, self.config.compute.model_dim, device=self.device)
    
    def _decode_output(self, output: torch.Tensor) -> str:
        """Decode output tensor to text (simplified)."""
        # Generate deterministic text based on output statistics
        mean_val = output.mean().item()
        std_val = output.std().item()
        norm_val = output.norm().item()
        
        responses = [
            f"CTM converged with high certainty (μ={mean_val:.3f}, σ={std_val:.3f})",
            f"Temporal processing stabilized at norm {norm_val:.3f}",
            f"Neuron synchronization achieved equilibrium",
            f"Adaptive computation completed with final state statistics: mean={mean_val:.3f}",
        ]
        
        # Select response based on output characteristics
        idx = int(abs(mean_val * 100)) % len(responses)
        return responses[idx]


def process(spec: Dict[str, Any], context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Process non-streaming CTM request.
    """
    config = load_config_from_env()
    processor = CTMProcessor(config)
    
    prompt = ""
    if isinstance(spec, dict) and isinstance(spec.get("prompt"), str):
        prompt = spec["prompt"].strip()
    else:
        prompt = str(spec) if spec is not None else " "
    
    # Run CTM for a fixed number of ticks
    input_embedding = processor._encode_prompt(prompt)
    
    tick_history = []
    final_output = None
    final_tick = 0
    
    for tick in range(config.tick.max_ticks):
        tick_data = processor.process_tick(input_embedding, tick)
        tick_history.append({
            "tick": tick,
            "certainty": float(tick_data["certainty"]),
            "sync_mean": float(tick_data["sync_scores"].mean().item()),
        })
        
        if processor.halting.should_halt(tick_data["certainty"]):
            final_output = tick_data["attended"]
            final_tick = tick
            break
        
        final_output = tick_data["attended"]
        final_tick = tick
    
    # Generate result
    final_text = processor._decode_output(final_output)
    
    result = {
        "text": final_text,
        "ctm_stats": {
            "final_tick": final_tick,
            "total_ticks": len(tick_history),
            "halted_early": final_tick < config.tick.max_ticks - 1,
            "final_certainty": tick_history[-1]["certainty"] if tick_history else 0.0,
            "config": config.to_dict()
        },
        "tick_history": tick_history[:10]  # First 10 ticks for summary
    }
    
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
            err = {
                "error": "No input received on stdin. Please provide a single-line JSON object with keys 'spec' and optional 'context'."
            }
            end_time = time.time()
            out = make_output(err, start_time, end_time)
            print(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
            return 1
        
        spec = incoming.get("spec") if isinstance(incoming, dict) else incoming
        context = incoming.get("context") if isinstance(incoming, dict) else None
        
        # Configure CloudEvents from environment
        ce_enabled = _env_flag_true(os.environ.get("CE_ENABLED"))
        ce_source = os.environ.get("CTM_CE_SOURCE", "/mentatlab/agent/ctm-cogpack")
        ce_version = os.environ.get("CTM_CE_VERSION", "1.0")
        
        execution_id: Optional[str] = None
        if isinstance(incoming, dict):
            v = incoming.get("execution_id")
            if isinstance(v, str) and v:
                execution_id = v
        if not execution_id and isinstance(context, dict):
            v = context.get("execution_id")
            if isinstance(v, str) and v:
                execution_id = v
        
        _CE_CONFIG.update({
            "enabled": ce_enabled,
            "source": ce_source,
            "specversion": ce_version,
            "execution_id": execution_id,
        })
        
        # Check for streaming mode
        mode = None
        if isinstance(spec, dict):
            mode = spec.get("mode")
        
        # Determine if we should use vLLM backend
        vllm_base = os.environ.get("VLLM_BASE_URL", "").strip()
        use_vllm = _env_flag_true(os.environ.get("CTM_USE_VLLM", "1")) and bool(vllm_base)
        vllm_model = os.environ.get("VLLM_MODEL", "")

        if mode == "stream":
            prompt = spec.get("prompt", "CTM streaming test") if isinstance(spec, dict) else "CTM test"
            agent_id = spec.get("agent_id", "mentatlab.ctm-cogpack") if isinstance(spec, dict) else "mentatlab.ctm-cogpack"
            stream_id = spec.get("stream_id", str(uuid.uuid4())) if isinstance(spec, dict) else str(uuid.uuid4())

            # Header status
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

            if use_vllm or torch is None:
                # vLLM-based streaming: one-shot completion then chunk into stream events
                text = _vllm_generate_text(vllm_base, prompt, vllm_model) or "CTM(vLLM): no response"
                # Chunk into sentences/parts
                parts = [p.strip() for p in text.replace("\n", " ").split(".") if p.strip()]
                seq = 1
                for i, part in enumerate(parts[:10]):
                    msg = {
                        "id": str(uuid.uuid4()),
                        "type": "text:stream",
                        "timestamp": _now_iso(),
                        "agent_id": agent_id,
                        "stream_id": stream_id,
                        "content": part + ("." if not part.endswith(".") else ""),
                        "isComplete": i == len(parts[:10]) - 1,
                        "sequence": seq,
                        "model": {"name": AGENT_MODEL, "provider": "ctm", "component": "vllm"}
                    }
                    _emit_stream_message(msg)
                    seq += 1
                    # status updates
                    st = {
                        "id": str(uuid.uuid4()),
                        "type": "stream:status",
                        "timestamp": _now_iso(),
                        "agent_id": agent_id,
                        "stream_id": stream_id,
                        "status": "completed" if i == len(parts[:10]) - 1 else "active",
                        "progress": {"current": i + 1, "total": len(parts[:10]), "percentage": int(((i + 1) / max(1, len(parts[:10]))) * 100)},
                        "sequence": seq,
                    }
                    _emit_stream_message(st)
                    seq += 1
                    time.sleep(0.05)
                final_text = text
                final_tick = len(parts[:10])
            else:
                # Torch-based CTM simulation
                config = load_config_from_env()
                processor = CTMProcessor(config)
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                final_text, final_tick = loop.run_until_complete(
                    processor.run_streaming(prompt, agent_id, stream_id)
                )
                loop.close()

            # Create result with streaming summary
            result_payload = {
                "text": final_text,
                "stream_summary": {
                    "stream_id": stream_id,
                    "final_tick": final_tick,
                    "mode": "stream",
                    "backend": "vllm" if (use_vllm or torch is None) else "ctm"
                }
            }
        else:
            # Non-streaming mode
            if use_vllm or torch is None:
                prompt = "" if not isinstance(spec, dict) else str(spec.get("prompt") or "")
                text = _vllm_generate_text(vllm_base, prompt, vllm_model) or "CTM(vLLM): no response"
                result_payload = {"text": text, "backend": "vllm"}
            else:
                result_payload = process(spec or {}, context)
        
        end_time = time.time()
        output = make_output(result_payload, start_time, end_time)
        
        # Emit final result
        if _CE_CONFIG.get("enabled"):
            final_envelope = make_cloudevent(
                output,
                "agent.final",
                _CE_CONFIG.get("source", "/mentatlab/agent/ctm-cogpack"),
                _CE_CONFIG.get("specversion", "1.0"),
                _CE_CONFIG.get("execution_id"),
            )
            print(json.dumps(final_envelope, separators=(",", ":"), ensure_ascii=False))
        else:
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
