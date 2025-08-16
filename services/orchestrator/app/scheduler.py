from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from services.orchestrator.app.runstore import RunStore
from services.orchestrator.app.subprocess_driver import LocalSubprocessDriver


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class NodeSpec:
    id: str
    agent: Optional[str] = None
    params: Dict[str, Any] | None = None
    max_retries: int = 0
    backoff_seconds: int = 2
    timeout_ms: Optional[int] = None


@dataclass
class EdgeSpec:
    src: str
    dst: str


@dataclass
class RunSpec:
    run_id: str
    name: str
    created_at: str
    plan_nodes: List[NodeSpec]
    plan_edges: List[EdgeSpec]


@dataclass
class _RunCtx:
    run_id: str
    name: str
    node_specs: Dict[str, NodeSpec]
    dependents: Dict[str, Set[str]]  # node_id -> set of downstream ids
    remaining_preds: Dict[str, int]  # node_id -> count of predecessors not yet succeeded
    # Runtime
    tasks: Dict[str, asyncio.Task[int]] = field(default_factory=dict)  # node_id -> task running driver
    done: asyncio.Event = field(default_factory=asyncio.Event)
    cancelled: asyncio.Event = field(default_factory=asyncio.Event)


class Scheduler:
    """
    Minimal single-process scheduler:
    - Persists state via RunStore (node_state and run_status)
    - Emits events via RunStore (run_status, node_status)
    - Executes nodes via LocalSubprocessDriver
    - Retries with exponential backoff using per-node attempts stored in RunStore node state
    """

    def __init__(
        self,
        store: RunStore,
        driver: LocalSubprocessDriver,
        resolve_cmd: Callable[[NodeSpec], List[str]],
        *,
        max_parallelism: Optional[int] = None,
        default_max_retries: Optional[int] = None,
        default_backoff_seconds: Optional[int] = None,
    ) -> None:
        self._store = store
        self._driver = driver
        self._resolve_cmd = resolve_cmd
        self._runs: Dict[str, _RunCtx] = {}
        self._lock = asyncio.Lock()
        self._sem = asyncio.Semaphore(max_parallelism) if max_parallelism and max_parallelism > 0 else None
        # Global defaults (env override)
        self._default_max_retries = (
            int(os.getenv("ORCH_MAX_RETRIES_DEFAULT", "").strip() or "0")
            if default_max_retries is None
            else default_max_retries
        )
        self._default_backoff_seconds = (
            int(os.getenv("ORCH_BACKOFF_SECONDS_DEFAULT", "").strip() or "2")
            if default_backoff_seconds is None
            else default_backoff_seconds
        )

    # ---------- Public API ----------

    async def enqueue_run(self, run_spec: RunSpec) -> None:
        """
        Register the run with the scheduler and set node queued events.
        Assumes the RunStore run record is already created.
        """
        async with self._lock:
            if run_spec.run_id in self._runs:
                return

            node_specs: Dict[str, NodeSpec] = {}
            for n in run_spec.plan_nodes:
                # hydrate defaults if not provided
                max_retries = n.max_retries if n.max_retries is not None else self._default_max_retries
                backoff = n.backoff_seconds if n.backoff_seconds is not None else self._default_backoff_seconds
                node_specs[n.id] = NodeSpec(
                    id=n.id,
                    agent=n.agent,
                    params=n.params or {},
                    max_retries=int(max_retries or 0),
                    backoff_seconds=int(backoff or 2),
                    timeout_ms=n.timeout_ms,
                )

            dependents: Dict[str, Set[str]] = {n_id: set() for n_id in node_specs}
            remaining_preds: Dict[str, int] = {n_id: 0 for n_id in node_specs}
            for e in run_spec.plan_edges:
                if e.src in node_specs and e.dst in node_specs:
                    dependents[e.src].add(e.dst)
                    remaining_preds[e.dst] += 1

            ctx = _RunCtx(
                run_id=run_spec.run_id,
                name=run_spec.name,
                node_specs=node_specs,
                dependents=dependents,
                remaining_preds=remaining_preds,
            )
            self._runs[run_spec.run_id] = ctx

        # Emit node_status queued for all nodes (events only; node_state snapshot was set at create)
        for node_id in node_specs:
            await self._emit_node_status(run_spec.run_id, node_id, "queued")

        # Emit run_status queued (compat with existing format)
        await self._store.append_event(run_spec.run_id, "status", {"runId": run_spec.run_id, "status": "queued"})

    async def start_run(self, run_id: str) -> None:
        """
        Transition the run to running, compute initial ready set, and start worker loop.
        """
        ctx = self._runs.get(run_id)
        if not ctx:
            raise KeyError(f"run {run_id} not enqueued")

        # Mark run running in store + event
        started_iso = _utc_iso()
        await self._store.update_run_status(run_id, "running", started_at=started_iso)
        await self._store.append_event(run_id, "hello", {"runId": run_id})
        await self._store.append_event(run_id, "status", {"runId": run_id, "status": "running"})

        # Schedule the run loop
        asyncio.create_task(self._run_loop(ctx))

    async def cancel_run(self, run_id: str) -> None:
        """
        Mark cancellation and stop active nodes. Emits node_status failed (reason=canceled) via driver handling,
        then finalize run as failed.
        """
        ctx = self._runs.get(run_id)
        # Persist cancellation intent to store (will set meta status=cancelled)
        try:
            await self._store.cancel_run(run_id)
        except KeyError:
            # if store doesn't have it, ignore
            pass

        if ctx:
            ctx.cancelled.set()
            # Cancel active node tasks (driver will emit node_status failed reason=cancelled)
            for t in list(ctx.tasks.values()):
                if not t.done():
                    t.cancel()

        # Emit run failed (requested behavior for cancel)
        finished_iso = _utc_iso()
        await self._store.update_run_status(run_id, "failed", finished_at=finished_iso)
        await self._store.append_event(run_id, "status", {"runId": run_id, "status": "failed"})

    # ---------- Internal ----------

    async def _run_loop(self, ctx: _RunCtx) -> None:
        """
        Worker loop for a single run: selects ready nodes, manages retries, and completes the run.
        """
        run_id = ctx.run_id
        # Initialize: find nodes with no predecessors and schedule them if allowed
        await self._maybe_schedule_new_ready(ctx)

        try:
            # Main loop: wait for any task to complete, then react; also periodically check for
            # retry windows opening and schedule ready nodes.
            while True:
                if ctx.cancelled.is_set() and not ctx.tasks:
                    break

                # If no active tasks, try schedule more; if nothing to do and all nodes done, exit
                if not ctx.tasks:
                    scheduled_any = await self._maybe_schedule_new_ready(ctx)
                    if not scheduled_any:
                        # Are we fully done?
                        done = await self._check_run_completion(ctx)
                        if done:
                            break
                        # Otherwise, sleep briefly and continue
                        await asyncio.sleep(0.05)
                        continue

                # Wait for any task to finish or a short timeout to rescan schedule
                done_set, _ = await asyncio.wait(
                    set(ctx.tasks.values()),
                    timeout=0.25,
                    return_when=asyncio.FIRST_COMPLETED,
                )

                # Process completed tasks
                for finished_task in done_set:
                    # Find node_id by task
                    node_id = None
                    for nid, t in list(ctx.tasks.items()):
                        if t is finished_task:
                            node_id = nid
                            break
                    if node_id is not None:
                        # Pop it from active tasks
                        ctx.tasks.pop(node_id, None)
                        # Inspect result to proceed
                        try:
                            exit_code = finished_task.result()
                        except asyncio.CancelledError:
                            # already handled by cancel path; just continue
                            exit_code = 1
                        except Exception:
                            exit_code = 1
                        await self._on_node_finished(ctx, node_id, exit_code)

                # Attempt to schedule additional ready nodes (especially after successes)
                await self._maybe_schedule_new_ready(ctx)

                # Check finalization
                if await self._check_run_completion(ctx):
                    break

        finally:
            ctx.done.set()

    async def _maybe_schedule_new_ready(self, ctx: _RunCtx) -> bool:
        """
        Scan nodes to find ones that:
        - have remaining_preds == 0
        - are not currently running
        - have status queued in store
        - next_earliest_start_at (if set) is in the past
        Schedule them concurrently via driver.
        Returns True if any node got scheduled.
        """
        run_id = ctx.run_id
        scheduled = False

        # Snapshot meta to consult attempts and node timing windows
        try:
            meta = await self._store.get_run_meta(run_id)
        except KeyError:
            return False
        nodes_meta: Dict[str, Dict[str, Any]] = meta.get("nodes", {}) or {}

        now = datetime.now(timezone.utc)

        for node_id, spec in ctx.node_specs.items():
            # Skip if already has active task
            if node_id in ctx.tasks:
                continue
            # Must have no remaining predecessors
            if ctx.remaining_preds.get(node_id, 0) != 0:
                continue

            # Check current node meta/state
            st = (nodes_meta.get(node_id) or {}).get("status", "queued")
            attempts = int((nodes_meta.get(node_id) or {}).get("attempts", 0) or 0)
            next_start_iso = (nodes_meta.get(node_id) or {}).get("next_earliest_start_at")
            if next_start_iso:
                try:
                    next_start = datetime.fromisoformat(next_start_iso.replace("Z", "+00:00"))
                except Exception:
                    next_start = now
            else:
                next_start = now

            # Ready if queued and window open
            if st == "queued" and next_start <= now:
                # schedule
                task = asyncio.create_task(self._exec_node(ctx, spec, attempts + 1))
                ctx.tasks[node_id] = task
                scheduled = True

                # Update node state to running timestamps will be handled by driver for events,
                # but we keep attempts in store for retries
                started_iso = _utc_iso()
                node_state = dict(nodes_meta.get(node_id) or {})
                node_state.update(
                    {
                        "status": "running",
                        "attempts": attempts + 1,
                        "startedAt": started_iso,
                        "finishedAt": None,
                        "durationMs": None,
                        "error": None,
                        "last_exit_code": None,
                    }
                )
                await self._store.update_node_state(run_id, node_id, node_state)

        return scheduled

    async def _exec_node(self, ctx: _RunCtx, spec: NodeSpec, attempt: int) -> int:
        """
        Execute a node using the LocalSubprocessDriver and return the exit code.
        """
        run_id = ctx.run_id
        cmd = self._resolve_cmd(spec)

        timeout_s: Optional[float] = None
        if spec.timeout_ms and spec.timeout_ms > 0:
            try:
                timeout_s = float(spec.timeout_ms) / 1000.0
            except Exception:
                timeout_s = None

        # Allow optional parallelism limiting
        if self._sem:
            async with self._sem:
                return await self._driver.run_node(run_id, spec.id, cmd, env={"ATTEMPT": str(attempt)}, timeout=timeout_s)
        else:
            return await self._driver.run_node(run_id, spec.id, cmd, env={"ATTEMPT": str(attempt)}, timeout=timeout_s)

    async def _on_node_finished(self, ctx: _RunCtx, node_id: str, exit_code: int) -> None:
        """
        Handle a node finishing: schedule retry or unlock downstream and mark state accordingly.
        """
        run_id = ctx.run_id
        spec = ctx.node_specs[node_id]

        # Refresh node meta
        try:
            meta = await self._store.get_run_meta(run_id)
        except KeyError:
            return
        node_meta = meta.get("nodes", {}).get(node_id, {}) or {}
        attempts = int(node_meta.get("attempts", 0) or 0)

        finished_iso = _utc_iso()
        started_at = node_meta.get("startedAt")
        duration_ms = None
        if started_at:
            try:
                start_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                end_dt = datetime.fromisoformat(finished_iso.replace("Z", "+00:00"))
                duration_ms = int((end_dt - start_dt).total_seconds() * 1000)
            except Exception:
                pass

        if exit_code == 0:
            # Mark succeeded
            node_state = dict(node_meta)
            node_state.update(
                {
                    "status": "succeeded",
                    "finishedAt": finished_iso,
                    "durationMs": duration_ms,
                    "error": None,
                    "last_exit_code": 0,
                    "next_earliest_start_at": None,
                }
            )
            await self._store.update_node_state(run_id, node_id, node_state)

            # Unlock downstream
            for dst in ctx.dependents.get(node_id, set()):
                ctx.remaining_preds[dst] = max(0, ctx.remaining_preds.get(dst, 0) - 1)

        else:
            # Failure: decide retry or permanent failure
            if attempts <= (spec.max_retries or 0) - 1:
                # schedule retry
                next_attempt = attempts + 1
                delay = float(spec.backoff_seconds or 2) * (2 ** (attempts))
                # optional clamp to 60s
                if delay > 60.0:
                    delay = 60.0
                next_time = (datetime.now(timezone.utc) + timedelta(seconds=delay)).isoformat().replace("+00:00", "Z")

                node_state = dict(node_meta)
                node_state.update(
                    {
                        "status": "queued",
                        "finishedAt": finished_iso,
                        "durationMs": duration_ms,
                        "error": f"exit_code={exit_code}",
                        "last_exit_code": exit_code,
                        "next_earliest_start_at": next_time,
                        "attempts": attempts,  # attempts already incremented at start; keep count consistent
                    }
                )
                await self._store.update_node_state(run_id, node_id, node_state)
                # Emit node queued transition for visibility
                await self._emit_node_status(run_id, node_id, "queued", extra={"attempts": attempts, "retryAt": next_time})
            else:
                # permanent failure
                node_state = dict(node_meta)
                node_state.update(
                    {
                        "status": "failed",
                        "finishedAt": finished_iso,
                        "durationMs": duration_ms,
                        "error": f"exit_code={exit_code}",
                        "last_exit_code": exit_code,
                        "next_earliest_start_at": None,
                    }
                )
                await self._store.update_node_state(run_id, node_id, node_state)

        # After handling, maybe the run can advance; scheduling occurs in main loop via _maybe_schedule_new_ready

    async def _check_run_completion(self, ctx: _RunCtx) -> bool:
        """
        Determine if the run is completed (success or failed) and emit final run_status.
        """
        run_id = ctx.run_id
        try:
            meta = await self._store.get_run_meta(run_id)
        except KeyError:
            return True

        nodes_meta: Dict[str, Dict[str, Any]] = meta.get("nodes", {}) or {}
        statuses = [ (state or {}).get("status", "queued") for state in nodes_meta.values() ]
        any_running = any(s == "running" for s in statuses)
        any_queued = any(s == "queued" for s in statuses)
        any_failed = any(s == "failed" for s in statuses)
        all_succeeded = len(statuses) > 0 and all(s == "succeeded" for s in statuses)

        # If cancelled flag latched and no tasks remain, treat as failed (per requirement)
        if ctx.cancelled.is_set() and not ctx.tasks:
            finished_iso = _utc_iso()
            await self._store.update_run_status(run_id, "failed", finished_at=finished_iso)
            await self._store.append_event(run_id, "status", {"runId": run_id, "status": "failed"})
            return True

        if all_succeeded:
            finished_iso = _utc_iso()
            await self._store.update_run_status(run_id, "succeeded", finished_at=finished_iso)
            await self._store.append_event(run_id, "status", {"runId": run_id, "status": "succeeded"})
            return True

        # If there exists a node failed with no more retries possible AND it blocks downstream completion (i.e., graph cannot complete),
        # a simple criterion here is: at least one failed, none running, and no queued that could become ready (predecessor counts already set).
        # For minimal implementation, if any failed and no running tasks and no queued nodes, we end as failed.
        if any_failed and not any_running and not any_queued:
            finished_iso = _utc_iso()
            await self._store.update_run_status(run_id, "failed", finished_at=finished_iso)
            await self._store.append_event(run_id, "status", {"runId": run_id, "status": "failed"})
            return True

        return False

    async def _emit_node_status(self, run_id: str, node_id: str, status: str, *, extra: Optional[Dict[str, Any]] = None) -> None:
        data: Dict[str, Any] = {"status": status, "runId": run_id, "nodeId": node_id}
        if extra:
            data.update(extra)
        await self._store.append_event(run_id, "node_status", data, node_id=node_id)