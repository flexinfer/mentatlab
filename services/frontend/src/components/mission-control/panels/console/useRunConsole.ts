import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { subscribeRunEvents } from '@/services/streaming/orchestratorSSE';
import { parseRunEvent, NormalizedRunEvent } from '@/services/streaming/parse';

/**
 * Console event types - matches backend EventType constants
 * See: orchestrator-go/pkg/types/event.go
 */
export type ConsoleType =
  | 'log'
  | 'checkpoint'
  | 'node_status'
  | 'run_status'
  | 'status' // legacy alias for run_status
  | 'progress'
  | 'error'
  | 'stream_start'
  | 'stream_end'
  | 'stream_data'
  | 'condition_evaluated'
  | 'branch_selected'
  | 'branch_skipped'
  | 'loop_started'
  | 'loop_iteration'
  | 'loop_complete'
  | 'hello'
  | string;

/**
 * Console log levels - matches backend LogLevel constants
 * Note: Backend uses 'warning' not 'warn'
 */
export type ConsoleLevel = 'debug' | 'info' | 'warning' | 'warn' | 'error' | string;

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

  // Filters - default to showing key event types
  // Include both 'run_status' (new) and 'status' (legacy) for compatibility
  const [filters, setFilters] = useState<ConsoleFilters>({
    types: new Set<ConsoleType>(['log', 'checkpoint', 'node_status', 'run_status', 'status', 'progress', 'error']),
    levels: new Set<ConsoleLevel>(['debug', 'info', 'warning', 'warn', 'error']),
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
      types: f.types ?? new Set<ConsoleType>(['log', 'checkpoint', 'node_status', 'run_status', 'status', 'progress', 'error']),
      levels: f.levels ?? new Set<ConsoleLevel>(['debug', 'info', 'warning', 'warn', 'error']),
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
        // Normalize level: backend sends 'warning', frontend historically used 'warn'
        const rawLevel = n.level as ConsoleLevel | undefined;
        const level = rawLevel === 'warning' ? 'warn' : rawLevel;
        const nodeId = n.nodeId;
        const data = n.data;

        // Extract message based on event type
        // Message can be at data.message (flat) or data.data.message (nested LogEvent from backend)
        const nestedData = data?.data;
        const message: string | undefined = extractMessage(type, data, nestedData);

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
    const types = filters.types ?? new Set<ConsoleType>(['log', 'checkpoint', 'node_status', 'run_status', 'status', 'progress', 'error']);
    const levels = filters.levels ?? new Set<ConsoleLevel>(['debug', 'info', 'warning', 'warn', 'error']);
    const nodeId = filters.nodeId ?? null;

    return items.filter((it) => {
      if (types.size && !types.has(it.type)) return false;
      // Level filtering for log events - check both 'warn' and 'warning' since backend uses 'warning'
      if (it.type === 'log' && levels.size && it.level) {
        const normalizedLevel = it.level === 'warning' ? 'warn' : it.level;
        if (!levels.has(normalizedLevel) && !levels.has(it.level)) return false;
      }
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

/**
 * Extract a human-readable message from event data based on event type.
 * Handles different backend event structures.
 */
function extractMessage(type: ConsoleType, data: any, nestedData: any): string | undefined {
  // First try standard message fields
  if (typeof data?.message === 'string') return data.message;
  if (typeof data?.msg === 'string') return data.msg;
  if (typeof nestedData?.message === 'string') return nestedData.message;
  if (typeof nestedData?.msg === 'string') return nestedData.msg;

  // Type-specific message extraction
  switch (type) {
    case 'progress': {
      // Progress: show current/total or percentage
      const current = data?.current ?? nestedData?.current;
      const total = data?.total ?? nestedData?.total;
      const percent = data?.percent ?? nestedData?.percent;
      if (current != null && total != null) return `Progress: ${current}/${total}`;
      if (percent != null) return `Progress: ${percent}%`;
      return undefined;
    }
    case 'error': {
      // Error: extract error message
      const error = data?.error ?? nestedData?.error;
      if (typeof error === 'string') return error;
      if (typeof error?.message === 'string') return error.message;
      return undefined;
    }
    case 'node_status': {
      // Node status: show status change
      const status = data?.status ?? nestedData?.status;
      const exitCode = data?.exit_code ?? nestedData?.exit_code;
      if (status && exitCode != null) return `Status: ${status} (exit ${exitCode})`;
      if (status) return `Status: ${status}`;
      return undefined;
    }
    case 'run_status':
    case 'status': {
      // Run status: show status
      const status = data?.status ?? nestedData?.status;
      if (status) return `Run status: ${status}`;
      return undefined;
    }
    case 'condition_evaluated': {
      // Conditional: show expression and result
      const expr = data?.expression ?? nestedData?.expression;
      const result = data?.result ?? nestedData?.result;
      if (expr && result !== undefined) return `Condition "${expr}" → ${result}`;
      return undefined;
    }
    case 'branch_selected': {
      // Branch: show which branch was taken
      const branch = data?.branch ?? nestedData?.branch;
      if (branch) return `Branch selected: ${branch}`;
      return undefined;
    }
    case 'branch_skipped': {
      const branch = data?.branch ?? nestedData?.branch;
      if (branch) return `Branch skipped: ${branch}`;
      return undefined;
    }
    case 'loop_started': {
      const collection = data?.collection ?? nestedData?.collection;
      const count = data?.count ?? nestedData?.count;
      if (count != null) return `Loop started: ${count} items`;
      return `Loop started`;
    }
    case 'loop_iteration': {
      const index = data?.index ?? nestedData?.index;
      const total = data?.total ?? nestedData?.total;
      if (index != null && total != null) return `Loop iteration ${index + 1}/${total}`;
      if (index != null) return `Loop iteration ${index + 1}`;
      return undefined;
    }
    case 'loop_complete': {
      const iterations = data?.iterations ?? nestedData?.iterations;
      if (iterations != null) return `Loop complete: ${iterations} iterations`;
      return `Loop complete`;
    }
    case 'checkpoint': {
      const label = data?.label ?? nestedData?.label;
      if (label) return `Checkpoint: ${label}`;
      return undefined;
    }
    default:
      return undefined;
  }
}

function safeDataStr(v: unknown): string {
  if (v == null) return '';
  try {
    return JSON.stringify(v).toLowerCase();
  } catch {
    try { return String(v).toLowerCase(); } catch { return ''; }
  }
}