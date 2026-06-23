import json
import sys
import os
import time
import traceback
import ast
from typing import Any, Dict, Optional, List

try:
    from agents.common.emit import (
        log_info,
        log_error,
        checkpoint,
        set_correlation_id,
        emit_error,
        emit_progress,
        emit_heartbeat,
    )
except ImportError:
    # Fallback for different execution environments
    def log_info(msg, data=None):
        print(f"INFO: {msg} {data or ''}", file=sys.stderr)

    def log_error(msg, data=None):
        print(f"ERROR: {msg} {data or ''}", file=sys.stderr)

    def checkpoint(name, progress, data=None):
        pass

    def emit_error(code, message, **kwargs):
        print(f"ERROR [{code}]: {message}", file=sys.stderr)

    def emit_progress(current, total, **kwargs):
        pass

    def emit_heartbeat(**kwargs):
        pass

    def set_correlation_id(cid):
        pass


class MentatAgent:
    """
    Base class for Mentat agents implementing the Template Method pattern.
    Provides standard input reading, output writing, and error handling.
    """

    def __init__(self, agent_id: str, version: str = "0.1.0"):
        self.agent_id = agent_id
        self.version = version
        self.model = f"{agent_id}/{version}"
        self.start_time = 0.0

    def run(self) -> int:
        """Main entry point for the agent."""
        self.start_time = time.time()
        try:
            self.setup()
            incoming = self.read_input()

            if incoming is None:
                return self.handle_no_input()

            spec = incoming.get("spec", {})
            context = incoming.get("context", {})

            # Extract execution ID for correlation
            exec_id = incoming.get("execution_id") or context.get("execution_id")
            if exec_id:
                set_correlation_id(str(exec_id))

            result_payload = self.process(spec, context)

            self.write_output(result_payload)
            self.teardown()
            return 0

        except Exception as exc:
            return self.handle_error(exc)

    def setup(self):
        """Hook for initialization logic."""
        log_info(f"{self.agent_id}: starting")
        checkpoint("start", 0.0)

    def read_input(self) -> Optional[Dict[str, Any]]:
        """Reads agent input from stdin or environment variables."""
        # 1) Try stdin
        try:
            if not sys.stdin.isatty():
                raw = sys.stdin.read().strip()
                if raw:
                    return json.loads(raw)
        except Exception:
            pass

        # 2) Fallback to env vars (INPUT_SPEC, INPUT_CONTEXT)
        try:
            spec_s = os.environ.get("INPUT_SPEC", "")
            ctx_s = os.environ.get("INPUT_CONTEXT", "")

            spec = self._parse_maybe_json(spec_s) if spec_s else None
            ctx = self._parse_maybe_json(ctx_s) if ctx_s else None

            if spec or ctx:
                incoming = {}
                if spec:
                    incoming["spec"] = spec
                if ctx:
                    incoming["context"] = ctx
                return incoming
        except Exception:
            pass

        return None

    def process(self, spec: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Core logic to be implemented by subclasses."""
        raise NotImplementedError("Subclasses must implement process()")

    def write_output(self, result_payload: Dict[str, Any]):
        """Writes the final result to stdout in the standard format."""
        end_time = time.time()
        output = self.make_output_envelope(result_payload, self.start_time, end_time)

        # Check for CloudEvents mode (can be extended by subclasses)
        if self.should_use_cloudevents():
            output = self.wrap_cloudevent(output)

        sys.stdout.write(
            json.dumps(output, separators=(",", ":"), ensure_ascii=False) + "\n"
        )
        sys.stdout.flush()

        log_info(
            f"{self.agent_id}: completed",
            data={"seconds": round(end_time - self.start_time, 4)},
        )
        checkpoint("end", 1.0)

    def teardown(self):
        """Hook for cleanup logic."""
        pass

    def handle_no_input(self) -> int:
        """Handles cases where no input was received."""
        err_msg = "No input received on stdin or environment variables."
        log_error(f"{self.agent_id}: {err_msg}")

        out = self.make_output_envelope(
            {"error": err_msg}, self.start_time, time.time()
        )
        print(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
        return 1

    def handle_error(self, exc: Exception) -> int:
        """Standard error handling and reporting."""
        log_error(f"{self.agent_id}: internal error", data={"exception": str(exc)})
        tb = traceback.format_exc()

        err_payload = {
            "error": "Internal agent error",
            "exception": str(exc),
            "traceback": tb,
        }

        out = self.make_output_envelope(err_payload, self.start_time, time.time())
        print(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
        return 2

    def make_output_envelope(
        self, result: Dict[str, Any], start_time: float, end_time: float
    ) -> Dict[str, Any]:
        """Wraps result with standard mentat_meta block."""
        return {
            "result": result,
            "mentat_meta": {
                "tokens_input": 0,
                "tokens_output": 0,
                "seconds": round(end_time - start_time, 4),
                "model": self.model,
            },
        }

    def should_use_cloudevents(self) -> bool:
        """Override to enable CloudEvents wrapping."""
        return os.environ.get("AGENT_CE_ENABLED", "").lower() in ("1", "true", "yes")

    def wrap_cloudevent(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Simple CloudEvent wrapper."""
        import uuid
        from datetime import datetime, timezone

        return {
            "specversion": "1.0",
            "id": str(uuid.uuid4()),
            "source": f"/mentatlab/agent/{self.agent_id}",
            "type": "agent.final",
            "time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "datacontenttype": "application/json",
            "data": payload,
        }

    def _parse_maybe_json(self, s: str) -> Optional[Dict[str, Any]]:
        if not s or not s.strip():
            return None
        try:
            return json.loads(s)
        except Exception:
            try:
                return ast.literal_eval(s)
            except Exception:
                return None
