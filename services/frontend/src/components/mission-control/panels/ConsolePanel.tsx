import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useRunConsole, ConsoleLevel, ConsoleType, ConsoleFilters, ConsoleItem } from './console/useRunConsole';
import { ConsoleVirtualList, formatTime } from './console/ConsoleVirtualList';
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
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);
  const toast = useToast();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Handle event click - emit custom event for timeline correlation
  const handleItemClick = useCallback((item: ConsoleItem, index: number) => {
    setSelectedEventIndex(index);
    // Emit event for timeline correlation
    window.dispatchEvent(new CustomEvent('consoleEventSelected', {
      detail: { item, index, runId }
    }));
  }, [runId]);

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

  // Cmd+F to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Listen for timeline checkpoint selection to correlate with console
  useEffect(() => {
    const handleTimelineCheckpointSelected = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as { timestamp?: string; runId?: string };
        if (detail?.runId !== runId || !detail?.timestamp) return;

        // Find the console event closest to this timestamp
        const targetTime = new Date(detail.timestamp).getTime();
        let closestIndex = -1;
        let closestDelta = Infinity;

        for (let i = 0; i < filtered.length; i++) {
          const item = filtered[i];
          if (!item?.ts) continue;
          const itemTime = new Date(item.ts).getTime();
          const delta = Math.abs(itemTime - targetTime);
          if (delta < closestDelta) {
            closestDelta = delta;
            closestIndex = i;
          }
        }

        // If within 5 seconds, select and scroll to it
        if (closestIndex >= 0 && closestDelta < 5000) {
          setSelectedEventIndex(closestIndex);
          // The virtualized list will automatically scroll via autoscroll behavior
          // or we can disable autoscroll and manually trigger scroll
          setAutoscroll(false);
        }
      } catch {
        // ignore correlation errors
      }
    };

    window.addEventListener('timelineCheckpointSelected', handleTimelineCheckpointSelected);
    return () => window.removeEventListener('timelineCheckpointSelected', handleTimelineCheckpointSelected);
  }, [runId, filtered]);

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

          {/* Search (Cmd+F to focus) */}
          <div className="flex items-center gap-1 ml-3">
            <Input
              ref={searchInputRef}
              type="text"
              placeholder="Search (⌘F)…"
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
      {/* Console Events List (Virtualized) */}
      <div className="flex-1 font-sans" style={{ height: 'calc(100% - 48px)' }}>
        <ConsoleVirtualList
          items={filtered}
          autoscroll={autoscroll}
          onAutoscrollChange={setAutoscroll}
          onItemClick={handleItemClick}
          selectedIndex={selectedEventIndex}
        />
      </div>
    </PanelShell>
  );
}