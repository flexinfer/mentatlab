import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRunConsole, ConsoleLevel, ConsoleType, ConsoleFilters, ConsoleItem } from './console/useRunConsole';
import Badge from '@/components/ui/Badge';
import CodeInline from '@/components/ui/CodeInline';
import { PanelShell } from '@/components/ui/PanelShell';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';
import { useToast } from '../../../contexts/ToastContext';

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
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const toast = useToast();

  // Export functions
  const downloadFile = useCallback((content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const exportAsJSON = useCallback(() => {
    const data = filtered.map((item) => ({
      timestamp: item.ts,
      type: item.type,
      level: item.level,
      nodeId: item.nodeId,
      message: item.message,
      data: item.data,
    }));
    const json = JSON.stringify(data, null, 2);
    const filename = `console-export-${runId || 'all'}-${Date.now()}.json`;
    downloadFile(json, filename, 'application/json');
    toast.success(`Exported ${filtered.length} events to JSON`);
    setExportMenuOpen(false);
  }, [filtered, runId, downloadFile, toast]);

  const exportAsText = useCallback(() => {
    const lines = filtered.map((item) => {
      const time = item.ts ? formatTime(item.ts) : '';
      const level = item.level ? `[${item.level.toUpperCase()}]` : '';
      const node = item.nodeId ? `<${item.nodeId}>` : '';
      const msg = item.message || (item.data ? JSON.stringify(item.data) : '');
      return `${time} ${item.type} ${level} ${node} ${msg}`.trim();
    });
    const text = lines.join('\n');
    const filename = `console-export-${runId || 'all'}-${Date.now()}.txt`;
    downloadFile(text, filename, 'text/plain');
    toast.success(`Exported ${filtered.length} events to text`);
    setExportMenuOpen(false);
  }, [filtered, runId, downloadFile, toast]);

  const exportAsCSV = useCallback(() => {
    const escapeCSV = (val: any) => {
      if (val === null || val === undefined) return '';
      const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };
    const headers = ['timestamp', 'type', 'level', 'nodeId', 'message', 'data'];
    const rows = filtered.map((item) =>
      [item.ts, item.type, item.level, item.nodeId, item.message, item.data ? JSON.stringify(item.data) : '']
        .map(escapeCSV)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const filename = `console-export-${runId || 'all'}-${Date.now()}.csv`;
    downloadFile(csv, filename, 'text/csv');
    toast.success(`Exported ${filtered.length} events to CSV`);
    setExportMenuOpen(false);
  }, [filtered, runId, downloadFile, toast]);

  // Close export menu when clicking outside
  const exportMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [exportMenuOpen]);

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

  // Scroll container and autoscroll handling
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isUserAtBottomRef = useRef<boolean>(true);

  const scrollToBottom = () => {
    if (!scrollContainerRef.current) return;
    scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
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
            <span className="text-[11px] text-muted-foreground">Types:</span>
            {typeDefs.map(({ key, label }) => (
              <Checkbox
                key={key}
                label={label}
                checked={typeSet.has(key)}
                onChange={() => toggleType(key)}
              />
            ))}
          </div>

          {/* Levels (for logs) */}
          <div className="flex items-center gap-2 ml-3">
            <span className="text-[11px] text-muted-foreground">Log levels:</span>
            {levelDefs.map(({ key, label }) => (
              <Checkbox
                key={key}
                label={label}
                checked={levelSet.has(key)}
                onChange={() => toggleLevel(key)}
              />
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
          <div className="flex items-center gap-3 ml-auto">
            <Checkbox
              label="Autoscroll"
              checked={autoscroll}
              onChange={(e) => setAutoscroll(e.target.checked)}
            />
            <Checkbox
              label="Pause"
              checked={paused}
              onChange={(e) => setPaused(e.target.checked)}
            />

            {/* Clear */}
            <button
              className="ml-2 h-6 px-2 text-[11px] rounded border bg-card hover:bg-muted"
              onClick={clear}
              title="Clear console view"
            >
              Clear
            </button>

            {/* Export dropdown */}
            <div ref={exportMenuRef} className="relative ml-2">
              <button
                className="h-6 px-2 text-[11px] rounded border bg-card hover:bg-muted"
                onClick={() => setExportMenuOpen(!exportMenuOpen)}
                title="Export console events"
              >
                Export ▾
              </button>
              {exportMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] rounded-md border bg-popover shadow-md py-1">
                  <button
                    className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-accent hover:text-accent-foreground"
                    onClick={exportAsJSON}
                  >
                    Export as JSON
                  </button>
                  <button
                    className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-accent hover:text-accent-foreground"
                    onClick={exportAsText}
                  >
                    Export as Text
                  </button>
                  <button
                    className="w-full px-3 py-1.5 text-left text-[11px] hover:bg-accent hover:text-accent-foreground"
                    onClick={exportAsCSV}
                  >
                    Export as CSV
                  </button>
                </div>
              )}
            </div>

            {/* Counts */}
            <span className="ml-3 text-[11px] text-gray-500">
              {filtered.length}/{items.length}
            </span>
          </div>
        </div>
      }
      className="h-full w-full"
    >
      {/* Console Events List */}
      <div className="flex-1 p-2 font-sans text-[11px]" style={{ height: 'calc(100% - 48px)' }}>
        {filtered.length === 0 ? (
          <div className="text-gray-500">No events.</div>
        ) : (
          <div
            ref={scrollContainerRef}
            className="h-full overflow-y-auto"
            onScroll={(e) => {
              const container = e.currentTarget;
              const threshold = 8;
              const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
              isUserAtBottomRef.current = atBottom;

              if (!atBottom && autoscroll) {
                setAutoscroll(false);
              } else if (atBottom && !autoscroll) {
                setAutoscroll(true);
              }
            }}
          >
            {filtered.map((it, index) => (
              <div key={index} className="px-2 py-1">
                <div className="flex items-center gap-2 hover:bg-muted/40 rounded transition-colors h-8 px-2">
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
            ))}
          </div>
        )}
      </div>
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