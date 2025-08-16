import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { subscribeRunEvents } from '@/services/streaming/orchestratorSSE';
import { parseRunEvent, NormalizedRunEvent } from '@/services/streaming/parse';

export type ConsoleType = 'log' | 'checkpoint' | 'node_status' | 'status' | string;
export type ConsoleLevel = 'debug' | 'info' | 'warn' | 'error' | string;

export interface ConsoleItem {
  seq: number;
  ts?: string;
  type: ConsoleType;
  level?: ConsoleLevel;
  nodeId?: string;
  message?: string;
  data?: any;
  id?: string;
}

export interface ConsoleFilters {
  types?: Set<ConsoleType>;
  levels?: Set<ConsoleLevel>;
  nodeId?: string | null;
  query?: string;
}

export interface UseRunConsoleResult {
  items: ConsoleItem[];
  filtered: ConsoleItem[];
  nodes: string[];
  applyFilters: (f: ConsoleFilters) => void;
  filters: ConsoleFilters;
  autoscroll: boolean;
  setAutoscroll: (v: boolean) => void;
  paused: boolean;
  setPaused: (v: boolean) => void;
  clear: () => void;
}

/**
 * useRunConsole
 * - Subscribes to Gateway SSE for a runId (replay last 500 by default)
 * - Buffers events and commits in rAF to avoid excessive re-renders
 * - Normalizes events using parseRunEvent()
 * - Derives nodeId list and exposes filtering + autoscroll state
 */
export function useRunConsole(runId: string | null | undefined, selectedNodeId?: string | null): UseRunConsoleResult {
  const [items, setItems] = useState<ConsoleItem[]>([]);
  const [autoscroll, setAutoscroll] = useState<boolean>(true);
  const [paused, setPaused] = useState<boolean>(false);

  // Filters
  const [filters, setFilters] = useState<ConsoleFilters>({
    types: new Set<ConsoleType>(['log', 'checkpoint', 'node_status', 'status']),
    levels: new Set<ConsoleLevel>(['debug', 'info', 'warn', 'error']),
    nodeId: selectedNodeId ?? null,
    query: '',
  });

  // Keep node selection coming from Graph in sync unless user has explicitly overridden node filter
  const userOverrodeNode = useRef<boolean>(false);
  useEffect(() => {
    if (!userOverrodeNode.current) {
      setFilters((prev) => ({ ...prev, nodeId: selectedNodeId ?? null }));
    }
  }, [selectedNodeId]);

  const applyFilters = useCallback((f: ConsoleFilters) => {
    if (f.nodeId !== (selectedNodeId ?? null)) {
      userOverrodeNode.current = true;
    }
    setFilters({
      types: f.types ?? new Set<ConsoleType>(['log', 'checkpoint', 'node_status', 'status']),
      levels: f.levels ?? new Set<ConsoleLevel>(['debug', 'info', 'warn', 'error']),
      nodeId: f.nodeId ?? null,
      query: (f.query ?? '').trim(),
    });
  }, [selectedNodeId]);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  // Append buffer + rAF commit to batch UI updates under load
  const bufferRef = useRef<ConsoleItem[]>([]);
  const rafRef = useRef<number | null>(null);

  const commitBuffer = useCallback(() => {
    rafRef.current = null;
    if (bufferRef.current.length === 0) return;
    setItems((prev) => {
      // Append and keep chronological by seq (best effort)
      const appended = [...prev, ...bufferRef.current];
      bufferRef.current = [];
      appended.sort((a, b) => a.seq - b.seq);
      return appended;
    });
  }, []);

  const scheduleCommit = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(commitBuffer);
  }, [commitBuffer]);

  // SSE subscription
  useEffect(() => {
    let unsub: { close(): void } | null = null;
    bufferRef.current = [];
    setItems([]);
    userOverrodeNode.current = false;

    if (!runId) return;

    unsub = subscribeRunEvents(runId, {
      replay: 500,
      onEvent: (evt) => {
        if (paused) return;

        // Normalize via shared parser
        const n: NormalizedRunEvent = parseRunEvent(evt);

        // Map to ConsoleItem shape
        const type = (n.type as ConsoleType) || 'message';
        const level = (n.level as ConsoleLevel | undefined);
        const nodeId = n.nodeId;
        const data = n.data;
        const message: string | undefined =
          typeof data?.message === 'string' ? data.message
          : typeof (data?.msg) === 'string' ? data.msg
          : undefined;

        const item: ConsoleItem = {
          seq: n.seq,
          ts: n.ts,
          type,
          level,
          nodeId,
          message,
          data,
          id: n.id,
        };

        bufferRef.current.push(item);
        scheduleCommit();
      },
      onError: (err) => {
        // Tolerate; upstream sse client will reconnect
        const item: ConsoleItem = {
          seq: Date.now(),
          ts: new Date().toISOString(),
          type: 'status',
          level: 'error',
          message: `SSE error: ${err?.message ?? String(err)}`,
          data: { error: err?.message ?? String(err) },
        };
        bufferRef.current.push(item);
        scheduleCommit();
      },
    });

    return () => {
      if (unsub) unsub.close();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      bufferRef.current = [];
    };
  }, [runId, paused, scheduleCommit]);

  // Derived nodes list
  const nodes = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      if (it.nodeId) s.add(it.nodeId);
    }
    return Array.from(s).sort();
  }, [items]);

  // Filtering
  const filtered = useMemo(() => {
    const q = (filters.query ?? '').toLowerCase();
    const hasQuery = q.length > 0;
    const types = filters.types ?? new Set<ConsoleType>(['log', 'checkpoint', 'node_status', 'status']);
    const levels = filters.levels ?? new Set<ConsoleLevel>(['debug', 'info', 'warn', 'error']);
    const nodeId = filters.nodeId ?? null;

    return items.filter((it) => {
      if (types.size && !types.has(it.type)) return false;
      if (it.type === 'log' && levels.size && it.level && !levels.has(it.level)) return false;
      if (nodeId && it.nodeId !== nodeId) return false;
      if (hasQuery) {
        const msg = (it.message ?? '').toLowerCase();
        const dataStr = safeDataStr(it.data);
        if (!msg.includes(q) && !dataStr.includes(q)) return false;
      }
      return true;
    });
  }, [items, filters]);

  return {
    items,
    filtered,
    nodes,
    applyFilters,
    filters,
    autoscroll,
    setAutoscroll,
    paused,
    setPaused,
    clear,
  };
}

function safeDataStr(v: unknown): string {
  if (v == null) return '';
  try {
    return JSON.stringify(v).toLowerCase();
  } catch {
    try { return String(v).toLowerCase(); } catch { return ''; }
  }
}