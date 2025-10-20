import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRunConsole, ConsoleLevel, ConsoleType, ConsoleFilters } from './console/useRunConsole';
import Badge from '@/components/ui/Badge';
import CodeInline from '@/components/ui/CodeInline';
import { PanelShell } from '@/components/ui/PanelShell';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ScrollArea } from '@/components/ui/ScrollArea';
import { cn } from '@/lib/cn';

/**
 * Mission Control Console Panel
 *
 * Curl examples (via Gateway SSE):
 *
 *   # Subscribe to live events for a run
 *   curl -N "$GATEWAY/api/v1/runs/<run_id>/events"
 *
 *   # Subscribe starting from a specific last event id
 *   curl -N "$GATEWAY/api/v1/runs/<run_id>/events?fromId=<lastEventId>"
 *
 *   # Replay last 100 events on connect
 *   curl -N "$GATEWAY/api/v1/runs/<run_id>/events?replay=100"
 */

export default function ConsolePanel({ runId, selectedNodeId = null }: { runId: string | null; selectedNodeId?: string | null }) {
  const {
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
  } = useRunConsole(runId, selectedNodeId);

  // Controls state mirrors the hook filters for controlled inputs
  const [typeSet, setTypeSet] = useState<Set<ConsoleType>>(filters.types ?? new Set(['log', 'checkpoint', 'node_status', 'status']));
  const [levelSet, setLevelSet] = useState<Set<ConsoleLevel>>(filters.levels ?? new Set(['debug', 'info', 'warn', 'error']));
  const [nodeFilter, setNodeFilter] = useState<string | null>(filters.nodeId ?? null);
  const [query, setQuery] = useState<string>(filters.query ?? '');

  // Keep UI controls in sync if external selection changes
  useEffect(() => {
    setNodeFilter(filters.nodeId ?? null);
    // Do not reset query/types/levels automatically
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.nodeId]);

  // Derived nodes list with "All" option
  const nodeOptions = useMemo(() => ['(all nodes)', ...nodes], [nodes]);

  // Apply UI controls to hook filters
  useEffect(() => {
    const f: ConsoleFilters = {
      types: typeSet,
      levels: levelSet,
      nodeId: nodeFilter,
      query,
    };
    applyFilters(f);
  }, [typeSet, levelSet, nodeFilter, query, applyFilters]);

  // List + autoscroll handling
  const scrollRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef<boolean>(true);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    // On initial mount or when autoscroll enabled, jump to bottom
    if (autoscroll) {
      scrollToBottom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // When filtered items change, if autoscroll is on or user is at bottom, keep pinned to bottom
    if (autoscroll || isUserAtBottomRef.current) {
      scrollToBottom();
    }
  }, [filtered, autoscroll]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 8; // px tolerance
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    isUserAtBottomRef.current = atBottom;

    // If user scrolls away from bottom, pause autoscroll
    // Inline comment: this implements "pause when user scrolls up; resume when toggled back or scrolled to bottom"
    if (!atBottom && autoscroll) {
      setAutoscroll(false);
    } else if (atBottom && !autoscroll) {
      // Resume automatically when scrolled back to bottom
      setAutoscroll(true);
    }
  };

  const toggleType = (t: ConsoleType) => {
    setTypeSet((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const toggleLevel = (l: ConsoleLevel) => {
    setLevelSet((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  };

  const typeDefs: Array<{ key: ConsoleType; label: string }> = [
    { key: 'log', label: 'Log' },
    { key: 'checkpoint', label: 'Checkpoint' },
    { key: 'node_status', label: 'Node Status' },
    { key: 'status', label: 'Status' },
  ];

  const levelDefs: Array<{ key: ConsoleLevel; label: string }> = [
    { key: 'debug', label: 'debug' },
    { key: 'info', label: 'info' },
    { key: 'warn', label: 'warn' },
    { key: 'error', label: 'error' },
  ];

  // Helpers to color badges
  const typeVariant = (t: ConsoleType) => {
    switch (t) {
      case 'log': return 'info' as const;
      case 'checkpoint': return 'success' as const;
      case 'node_status': return 'warning' as const;
      case 'status': return 'default' as const;
      default: return 'default' as const;
    }
  };

  const levelVariant = (l?: ConsoleLevel) => {
    switch (l) {
      case 'debug': return 'default' as const;
      case 'info': return 'info' as const;
      case 'warn': return 'warning' as const;
      case 'error': return 'danger' as const;
      default: return 'default' as const;
    }
  };

  return (
    <PanelShell
      title={<span className="uppercase tracking-wide text-gray-500">Console</span>}
      toolbar={
        <div className="flex flex-wrap items-center gap-2 p-2 border-b bg-card/70 backdrop-blur">
          {/* Types */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500">Types:</span>
            {typeDefs.map(({ key, label }) => (
              <label key={key} className="inline-flex items-center gap-1 text-[11px]">
                <Input
                  type="checkbox"
                  checked={typeSet.has(key)}
                  onChange={() => toggleType(key)}
                  size="sm"
                  className="w-auto h-4"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {/* Levels (for logs) */}
          <div className="flex items-center gap-2 ml-3">
            <span className="text-[11px] text-gray-500">Log levels:</span>
            {levelDefs.map(({ key, label }) => (
              <label key={key} className="inline-flex items-center gap-1 text-[11px]">
                <Input
                  type="checkbox"
                  checked={levelSet.has(key)}
                  onChange={() => toggleLevel(key)}
                  size="sm"
                  className="w-auto h-4"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {/* Node filter */}
          <div className="flex items-center gap-1 ml-3">
            <span className="text-[11px] text-gray-500">Node:</span>
            <div className="w-48">
              <Select
                size="sm"
                className="text-[11px]"
                value={nodeFilter ?? '(all)'}
                onChange={(e) => {
                  const val = e.target.value;
                  setNodeFilter(val === '(all)' || val === '(all nodes)' ? null : val);
                }}
              >
                {nodeOptions.map((n) => (
                  <option key={n} value={n === '(all nodes)' ? '(all)' : n}>
                    {n}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Search */}
          <div className="flex items-center gap-1 ml-3">
            <Input
              type="text"
              placeholder="Search message or data…"
              size="sm"
              className={cn('px-2 text-[11px] min-w-[180px]')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* Autoscroll */}
          <div className="flex items-center gap-1 ml-auto">
            <label className="inline-flex items-center gap-1 text-[11px]">
              <Input
                type="checkbox"
                checked={autoscroll}
                onChange={(e) => setAutoscroll(e.target.checked)}
                size="sm"
                className="w-auto h-4"
              />
              <span>Autoscroll</span>
            </label>

            {/* Pause stream */}
            <label className="inline-flex items-center gap-1 text-[11px] ml-2">
              <Input
                type="checkbox"
                checked={paused}
                onChange={(e) => setPaused(e.target.checked)}
                size="sm"
                className="w-auto h-4"
              />
              <span>Pause</span>
            </label>

            {/* Clear */}
            <button
              className="ml-2 h-6 px-2 text-[11px] rounded border bg-card hover:bg-muted"
              onClick={clear}
              title="Clear console view"
            >
              Clear
            </button>

            {/* Counts */}
            <span className="ml-3 text-[11px] text-gray-500">
              {filtered.length}/{items.length}
            </span>
          </div>
        </div>
      }
      className="h-full w-full"
    >
      {/* List */}
      <ScrollArea orientation="vertical" className="flex-1">
        <div
          ref={scrollRef}
          className="p-2 space-y-1 font-sans text-[11px] flex-1"
          onScroll={onScroll}
        >
          {filtered.length === 0 && (
            <div className="text-gray-500">No events.</div>
          )}

          {filtered.map((it) => {
            return (
              <div key={`${it.seq}-${it.id ?? ''}`} className="px-2 py-1 rounded hover:bg-muted/40 transition-colors">
                <div className="flex items-center gap-2">
                  {/* Time */}
                  <span className="text-gray-400 min-w-[120px] tabular-nums">
                    {formatTime(it.ts)}
                  </span>
                  {/* Type */}
                  <Badge variant={typeVariant(it.type)} title={String(it.type)}>
                    {it.type}
                  </Badge>
                  {/* Level */}
                  {it.type === 'log' && it.level && (
                    <Badge variant={levelVariant(it.level)} title={String(it.level)}>
                      {it.level}
                    </Badge>
                  )}
                  {/* Node */}
                  {it.nodeId && (
                    <span className="text-gray-500">· {it.nodeId}</span>
                  )}
                  {/* Message/Data */}
                  <span className="flex-1 text-gray-800 dark:text-gray-200">
                    {renderMessageOrData(it)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </PanelShell>
  );
}

function renderMessageOrData(it: { type: ConsoleType; message?: string; data?: any }) {
  if (it.type === 'log' && it.message) {
    return <span className="whitespace-pre-wrap break-words">{it.message}</span>;
  }
  // Compact JSON preview of payload
  return <CodeInline value={compactData(it.data)} maxLength={240} />;
}

function compactData(d: any) {
  if (!d) return d;
  // Prefer a small selection if obvious fields exist
  const { message, msg, node_id, nodeId, type, kind, level, ...rest } = d || {};
  const head: any = {};
  if (type) head.type = type;
  if (kind) head.kind = kind;
  if (level) head.level = level;
  if (message) head.message = message;
  if (msg) head.msg = msg;
  if (node_id) head.node_id = node_id;
  if (nodeId) head.nodeId = nodeId;
  // If head has content, include it first and then show a small tail if any
  if (Object.keys(head).length > 0) {
    if (rest && Object.keys(rest).length) {
      head._ = rest;
    }
    return head;
  }
  return d;
}

function formatTime(ts?: string) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    // hh:mm:ss.mmm
    const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  } catch {
    return ts;
  }
}