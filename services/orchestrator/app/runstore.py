from __future__ import annotations

import asyncio
import json
import os
from collections import deque
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Deque, Dict, Iterable, List, Optional, Protocol, Tuple, Union

try:
    # Optional import; only required when ORCH_RUNSTORE=redis
    from redis.asyncio import Redis  # type: ignore
except Exception:  # pragma: no cover - env without redis
    Redis = None  # type: ignore


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class Event:
    id: str                    # monotonic sequence as string
    ts: str                    # ISO-8601 Z
    type: str                  # SSE 'event' name
    data: Dict[str, Any]       # JSON payload
    run_id: str
    node_id: Optional[str] = None
    level: Optional[str] = None

    def to_sse(self) -> bytes:
        # Maintain SSE format: id, event, data: JSON
        lines = []
        if self.id:
            lines.append(f"id: {self.id}")
        if self.type:
            lines.append(f"event: {self.type}")
        lines.append("data: " + json.dumps(self.data, separators=(",", ":")))
        return ("\n".join(lines) + "\n\n").encode("utf-8")


class RunStore(Protocol):
    async def create_run(self, name: str, plan: Dict[str, Any]) -> str: ...
    async def get_run_meta(self, run_id: str) -> Dict[str, Any]: ...
    async def list_runs(self) -> List[str]: ...
    async def update_run_status(
        self,
        run_id: str,
        status: str,
        started_at: Optional[str] = None,
        finished_at: Optional[str] = None,
    ) -> None: ...
    async def update_node_state(self, run_id: str, node_id: str, node_state: Dict[str, Any]) -> None: ...
    async def cancel_run(self, run_id: str) -> None: ...
    async def append_event(
        self,
        run_id: str,
        event_type: str,
        data: Dict[str, Any],
        *,
        node_id: Optional[str] = None,
        level: Optional[str] = None,
    ) -> Event: ...
    async def get_events_since(self, run_id: str, last_event_id: Optional[str]) -> Iterable[Event]: ...
    async def subscribe(self, run_id: str) -> AsyncIterator[Event]: ...
    async def adapter_info(self) -> Dict[str, Any]: ...


# ---------------- InMemoryRunStore ----------------

class InMemoryRunStore(RunStore):
    class _Run:
        __slots__ = ("run_id", "name", "plan", "status", "startedAt", "finishedAt", "nodes",
                     "events", "next_seq", "subscribers", "cancelled")

        def __init__(self, run_id: str, name: str, plan: Dict[str, Any], maxlen: int = 5000):
            self.run_id = run_id
            self.name = name
            self.plan = plan
            self.status = "queued"
            self.startedAt: Optional[str] = None
            self.finishedAt: Optional[str] = None
            # nodes is Dict[node_id, NodeState-like dict]
            self.nodes: Dict[str, Dict[str, Any]] = {
                n.get("id"): {"status": "queued", "attempts": 0, "startedAt": None, "finishedAt": None, "durationMs": None, "error": None}
                for n in (plan.get("nodes") or [])
                if n.get("id")
            }
            self.events: Deque[Event] = deque(maxlen=maxlen)
            self.next_seq: int = 1
            self.subscribers: set[asyncio.Queue[Event]] = set()
            self.cancelled: bool = False

    def __init__(self, *, ring_maxlen: int = 5000):
        self._runs: Dict[str, InMemoryRunStore._Run] = {}
        self._lock = asyncio.Lock()
        self._ring_maxlen = ring_maxlen

    async def create_run(self, name: str, plan: Dict[str, Any]) -> str:
        async with self._lock:
            run_id = os.urandom(16).hex()
            self._runs[run_id] = InMemoryRunStore._Run(run_id, name, plan, self._ring_maxlen)
            return run_id

    async def get_run_meta(self, run_id: str) -> Dict[str, Any]:
        async with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                raise KeyError(run_id)
            return {
                "runId": rec.run_id,
                "name": rec.name,
                "status": rec.status,
                "startedAt": rec.startedAt,
                "finishedAt": rec.finishedAt,
                "nodes": rec.nodes,
                "plan": rec.plan,
            }

    async def list_runs(self) -> List[str]:
        async with self._lock:
            return list(self._runs.keys())

    async def update_run_status(
        self,
        run_id: str,
        status: str,
        started_at: Optional[str] = None,
        finished_at: Optional[str] = None,
    ) -> None:
        async with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                raise KeyError(run_id)
            rec.status = status
            if started_at is not None:
                rec.startedAt = started_at
            if finished_at is not None:
                rec.finishedAt = finished_at

    async def update_node_state(self, run_id: str, node_id: str, node_state: Dict[str, Any]) -> None:
        async with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                raise KeyError(run_id)
            rec.nodes[node_id] = node_state

    async def cancel_run(self, run_id: str) -> None:
        async with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                raise KeyError(run_id)
            rec.cancelled = True
            rec.status = "cancelled"

    async def append_event(
        self,
        run_id: str,
        event_type: str,
        data: Dict[str, Any],
        *,
        node_id: Optional[str] = None,
        level: Optional[str] = None,
    ) -> Event:
        async with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                raise KeyError(run_id)
            seq = rec.next_seq
            rec.next_seq += 1
            evt = Event(
                id=str(seq),
                ts=_utc_iso(),
                type=event_type,
                data=data,
                run_id=run_id,
                node_id=node_id,
                level=level,
            )
            rec.events.append(evt)
            # non-blocking fanout
            for q in list(rec.subscribers):
                try:
                    q.put_nowait(evt)
                except Exception:
                    try:
                        rec.subscribers.remove(q)
                    except Exception:
                        pass
            return evt

    async def get_events_since(self, run_id: str, last_event_id: Optional[str]) -> Iterable[Event]:
        async with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                raise KeyError(run_id)
            if not last_event_id:
                # no resume id -> nothing backfilled here; caller may emit hello
                return list(rec.events)
            try:
                last = int(last_event_id)
            except Exception:
                # bad id -> just return all
                return list(rec.events)
            return [e for e in rec.events if int(e.id) > last]

    async def subscribe(self, run_id: str) -> AsyncIterator[Event]:
        async with self._lock:
            rec = self._runs.get(run_id)
            if not rec:
                raise KeyError(run_id)
            q: asyncio.Queue[Event] = asyncio.Queue()
            rec.subscribers.add(q)

        try:
            while True:
                evt = await q.get()
                yield evt
        finally:
            # cleanup
            async with self._lock:
                rec2 = self._runs.get(run_id)
                if rec2:
                    try:
                        rec2.subscribers.remove(q)
                    except Exception:
                        pass

    async def adapter_info(self) -> Dict[str, Any]:
        return {"adapter": "memory", "details": {"runs": len(self._runs)}}


# ---------------- RedisRunStore ----------------

class RedisRunStore(RunStore):
    def __init__(self, url: str = "redis://localhost:6379/0", *, prefix: str = "runs"):
        if Redis is None:
            raise RuntimeError("redis-py not installed. Add 'redis~=5.0' and set ORCH_RUNSTORE=memory or install dependency.")
        self._redis: Redis = Redis.from_url(url, decode_responses=True)
        self._prefix = prefix

    # Key helpers
    def _k_meta(self, run_id: str) -> str: return f"{self._prefix}:{run_id}:meta"
    def _k_nodes(self, run_id: str) -> str: return f"{self._prefix}:{run_id}:nodes"
    def _k_events(self, run_id: str) -> str: return f"{self._prefix}:{run_id}:events"
    def _k_seq(self, run_id: str) -> str: return f"{self._prefix}:{run_id}:seq"

    async def create_run(self, name: str, plan: Dict[str, Any]) -> str:
        run_id = os.urandom(16).hex()
        # Initialize meta and seq
        pipe = self._redis.pipeline()
        pipe.hset(self._k_meta(run_id), mapping={
            "runId": run_id,
            "name": name,
            "status": "queued",
            "startedAt": "",
            "finishedAt": "",
        })
        # Store nodes snapshot as JSON in a hash (one field 'json') for simplicity
        nodes = {
            n.get("id"): {"status": "queued", "attempts": 0, "startedAt": None, "finishedAt": None, "durationMs": None, "error": None}
            for n in (plan.get("nodes") or [])
            if n.get("id")
        }
        pipe.hset(self._k_nodes(run_id), mapping={"json": json.dumps(nodes, separators=(",", ":"))})
        # Initialize sequence counter to 0, first event will be 1
        pipe.set(self._k_seq(run_id), 0, keepttl=False)
        await pipe.execute()
        return run_id

    async def get_run_meta(self, run_id: str) -> Dict[str, Any]:
        meta = await self._redis.hgetall(self._k_meta(run_id))
        if not meta:
            raise KeyError(run_id)
        nodes_json = await self._redis.hget(self._k_nodes(run_id), "json")
        nodes = json.loads(nodes_json) if nodes_json else {}
        return {
            "runId": meta.get("runId", run_id),
            "name": meta.get("name", ""),
            "status": meta.get("status", "queued"),
            "startedAt": meta.get("startedAt") or None,
            "finishedAt": meta.get("finishedAt") or None,
            "nodes": nodes,
            # plan is not persisted here to keep minimal
        }

    async def list_runs(self) -> List[str]:
        # Scan keys by meta pattern
        pattern = f"{self._prefix}:*:meta"
        cursor: int = 0
        run_ids: List[str] = []
        while True:
            cursor, keys = await self._redis.scan(cursor=cursor, match=pattern, count=100)
            for k in keys:
                # k like runs:{run_id}:meta
                parts = k.split(":")
                if len(parts) >= 3:
                    run_ids.append(parts[1])
            if cursor == 0:
                break
        return run_ids

    async def update_run_status(
        self,
        run_id: str,
        status: str,
        started_at: Optional[str] = None,
        finished_at: Optional[str] = None,
    ) -> None:
        mapping: Dict[str, str] = {"status": status}
        if started_at is not None:
            mapping["startedAt"] = started_at or ""
        if finished_at is not None:
            mapping["finishedAt"] = finished_at or ""
        await self._redis.hset(self._k_meta(run_id), mapping=mapping)

    async def update_node_state(self, run_id: str, node_id: str, node_state: Dict[str, Any]) -> None:
        nodes_json = await self._redis.hget(self._k_nodes(run_id), "json")
        nodes = json.loads(nodes_json) if nodes_json else {}
        nodes[node_id] = node_state
        await self._redis.hset(self._k_nodes(run_id), mapping={"json": json.dumps(nodes, separators=(",", ":"))})

    async def cancel_run(self, run_id: str) -> None:
        await self.update_run_status(run_id, "cancelled")

    async def append_event(
        self,
        run_id: str,
        event_type: str,
        data: Dict[str, Any],
        *,
        node_id: Optional[str] = None,
        level: Optional[str] = None,
    ) -> Event:
        # Assign sequence atomically
        seq = await self._redis.incr(self._k_seq(run_id))
        evt = Event(
            id=str(seq),
            ts=_utc_iso(),
            type=event_type,
            data=data,
            run_id=run_id,
            node_id=node_id,
            level=level,
        )
        fields: Dict[str, str] = {
            "seq": evt.id,
            "ts": evt.ts,
            "type": evt.type,
            "data": json.dumps(evt.data, separators=(",", ":")),
        }
        if node_id is not None:
            fields["node_id"] = node_id
        if level is not None:
            fields["level"] = level
        # XADD with MAXLEN ~ 5000 approximate retention like memory ring
        try:
            await self._redis.xadd(self._k_events(run_id), fields=fields, maxlen=5000, approximate=True)
        except Exception:
            # Fallback: if Streams unavailable (unlikely), no-op or could use list
            # Keep minimal: ignore persistence failure but return evt for live
            pass
        return evt

    async def get_events_since(self, run_id: str, last_event_id: Optional[str]) -> Iterable[Event]:
        # Use XRANGE from - to +, then filter by seq
        try:
            entries = await self._redis.xrange(self._k_events(run_id), min="-", max="+", count=None)
        except Exception:
            entries = []
        if not entries:
            return []
        last = None
        if last_event_id:
            try:
                last = int(last_event_id)
            except Exception:
                last = None
        out: List[Event] = []
        for _id, fields in entries:
            seq_str = fields.get("seq")
            if seq_str is None:
                continue
            try:
                if last is not None and int(seq_str) <= last:
                    continue
            except Exception:
                pass
            data_str = fields.get("data") or "{}"
            try:
                payload = json.loads(data_str)
            except Exception:
                payload = {"raw": data_str}
            out.append(Event(
                id=seq_str,
                ts=fields.get("ts") or _utc_iso(),
                type=fields.get("type") or "message",
                data=payload,
                run_id=run_id,
                node_id=fields.get("node_id"),
                level=fields.get("level"),
            ))
        # Ensure ordered by seq
        out.sort(key=lambda e: int(e.id))
        return out

    async def subscribe(self, run_id: str) -> AsyncIterator[Event]:
        # XREAD BLOCK from latest ('$') forward. If no new events yet, block.
        stream = self._k_events(run_id)
        last_id = "$"
        while True:
            try:
                resp = await self._redis.xread({stream: last_id}, block=0, count=1)
            except asyncio.CancelledError:
                break
            except Exception:
                # On error, wait briefly then retry to avoid busy-loop
                await asyncio.sleep(0.1)
                continue
            if not resp:
                continue
            # resp: List[Tuple[stream, List[Tuple[id, fields]]]]
            _, events = resp[0]
            for _id, fields in events:
                last_id = _id
                data_str = fields.get("data") or "{}"
                try:
                    payload = json.loads(data_str)
                except Exception:
                    payload = {"raw": data_str}
                evt = Event(
                    id=fields.get("seq") or "0",
                    ts=fields.get("ts") or _utc_iso(),
                    type=fields.get("type") or "message",
                    data=payload,
                    run_id=run_id,
                    node_id=fields.get("node_id"),
                    level=fields.get("level"),
                )
                yield evt

    async def adapter_info(self) -> Dict[str, Any]:
        try:
            pong = await self._redis.ping()
        except Exception as e:
            pong = f"error: {e}"
        return {"adapter": "redis", "details": {"ping": pong, "prefix": self._prefix}}


async def get_store_from_env() -> RunStore:
    mode = os.getenv("ORCH_RUNSTORE", "memory").lower()
    if mode == "redis":
        url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        return RedisRunStore(url)
    # default memory
    return InMemoryRunStore()