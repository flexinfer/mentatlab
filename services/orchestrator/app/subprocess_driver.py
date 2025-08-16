from __future__ import annotations

import asyncio
import json
import os
from asyncio.subprocess import PIPE
from typing import Any, Dict, List, Optional

from services.orchestrator.app.runstore import RunStore


class LocalSubprocessDriver:
    """
    Launches a local subprocess for a node, streams stdout/stderr, parses NDJSON from stdout,
    and emits structured events through the configured RunStore.

    Event semantics:
    - stdout lines:
        * If JSON parse succeeds:
            - event type = line.get("type", "log")
            - data = entire object (augmented with runId/nodeId and correlation_id passthrough)
            - level = line.get("level") if present
        * If JSON parse fails:
            - event type = "log"
            - data = { "runId", "nodeId", "message": raw_line, "level": "info" }
            - level = "info"
    - stderr lines:
        * event type = "log"
        * level = "error"
        * data = { "runId", "nodeId", "message": raw_line }

    Node status events (node_status) are emitted:
    - at start: running
    - on exit code 0: succeeded
    - on non-zero exit: failed
    - on timeout or cancellation: failed
    """

    def __init__(
        self,
        run_store: RunStore,
        *,
        env_passthrough: Optional[Dict[str, str]] = None,
        cwd: Optional[str] = None,
    ) -> None:
        self._store = run_store
        self._env_passthrough = env_passthrough or {}
        self._cwd = cwd

    async def _emit_event(
        self,
        run_id: str,
        event_type: str,
        data: Dict[str, Any],
        *,
        node_id: Optional[str] = None,
        level: Optional[str] = None,
    ) -> None:
        # Ensure runId/nodeId in payload for SSE consumers
        if "runId" not in data:
            data["runId"] = run_id
        if node_id is not None and "nodeId" not in data:
            data["nodeId"] = node_id
        await self._store.append_event(run_id, event_type, data, node_id=node_id, level=level)

    async def run_node(
        self,
        run_id: str,
        node_id: str,
        cmd: List[str],
        env: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> int:
        """
        Execute the provided command as a subprocess.

        - Streams stdout/stderr concurrently
        - Parses NDJSON from stdout
        - Emits node_status transitions and log events
        - Enforces an optional timeout
        - Returns the subprocess exit code
        """
        # Emit node running status
        await self._emit_event(
            run_id,
            "node_status",
            {"status": "running"},
            node_id=node_id,
        )

        merged_env = os.environ.copy()
        merged_env.update(self._env_passthrough or {})
        if env:
            merged_env.update(env)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=PIPE,
            stderr=PIPE,
            cwd=self._cwd,
            env=merged_env,
        )

        async def _read_stdout() -> None:
            assert proc.stdout is not None
            while True:
                try:
                    raw = await proc.stdout.readline()
                except asyncio.CancelledError:
                    break
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                # Try NDJSON parse
                try:
                    obj = json.loads(line)
                    # Map to event fields
                    evt_type = obj.get("type", "log")
                    level = obj.get("level")
                    # Ensure correlation_id passthrough remains within data object
                    data = dict(obj)
                    # Add run/node identifiers if missing
                    data.setdefault("runId", run_id)
                    data.setdefault("nodeId", node_id)
                    await self._emit_event(
                        run_id,
                        evt_type,
                        data,
                        node_id=node_id,
                        level=level,
                    )
                except Exception:
                    # Fallback: plain log line
                    await self._emit_event(
                        run_id,
                        "log",
                        {"message": line, "level": "info"},
                        node_id=node_id,
                        level="info",
                    )

        async def _read_stderr() -> None:
            assert proc.stderr is not None
            while True:
                try:
                    raw = await proc.stderr.readline()
                except asyncio.CancelledError:
                    break
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                await self._emit_event(
                    run_id,
                    "log",
                    {"message": line, "level": "error"},
                    node_id=node_id,
                    level="error",
                )

        stdout_task = asyncio.create_task(_read_stdout())
        stderr_task = asyncio.create_task(_read_stderr())

        exit_code: int = 0
        try:
            if timeout and timeout > 0:
                try:
                    await asyncio.wait_for(proc.wait(), timeout=timeout)
                except asyncio.TimeoutError:
                    # Timeout: terminate then kill if needed
                    with contextlib.suppress(Exception):
                        proc.terminate()
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=2.0)
                    except Exception:
                        with contextlib.suppress(Exception):
                            proc.kill()
                    exit_code = proc.returncode if proc.returncode is not None else 1
                    # Mark failed due to timeout
                    await self._emit_event(
                        run_id,
                        "log",
                        {"message": f"node {node_id} timed out after {timeout}s", "level": "error"},
                        node_id=node_id,
                        level="error",
                    )
                    await self._emit_event(
                        run_id,
                        "node_status",
                        {"status": "failed", "reason": "timeout"},
                        node_id=node_id,
                    )
                    return exit_code if exit_code is not None else 1
            else:
                await proc.wait()
            exit_code = proc.returncode or 0
        except asyncio.CancelledError:
            # Graceful cancellation
            with contextlib.suppress(Exception):
                proc.terminate()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            await self._emit_event(
                run_id,
                "node_status",
                {"status": "failed", "reason": "cancelled"},
                node_id=node_id,
            )
            raise
        finally:
            # Ensure readers are done
            for t in (stdout_task, stderr_task):
                if not t.done():
                    t.cancel()
            with contextlib.suppress(Exception):
                await asyncio.gather(stdout_task, stderr_task)

        # Final node status
        if exit_code == 0:
            await self._emit_event(
                run_id,
                "node_status",
                {"status": "succeeded"},
                node_id=node_id,
            )
        else:
            await self._emit_event(
                run_id,
                "node_status",
                {"status": "failed", "exitCode": exit_code},
                node_id=node_id,
            )

        return exit_code


# Local import to avoid top-level dependency for small helper
import contextlib  # noqa: E402