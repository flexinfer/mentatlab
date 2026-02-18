import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { traceService, type TraceData, type TraceSpan } from '@/services/api/traceService';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

// --- Helpers ---

function formatDuration(microseconds: number): string {
  if (microseconds < 1000) return `${microseconds}us`;
  if (microseconds < 1_000_000) return `${(microseconds / 1000).toFixed(1)}ms`;
  return `${(microseconds / 1_000_000).toFixed(2)}s`;
}

function statusColor(status: TraceSpan['status']): string {
  switch (status) {
    case 'error': return 'bg-red-500';
    case 'ok': return 'bg-emerald-500';
    default: return 'bg-amber-500';
  }
}

function statusBorder(status: TraceSpan['status']): string {
  switch (status) {
    case 'error': return 'border-red-500/30';
    case 'ok': return 'border-emerald-500/30';
    default: return 'border-amber-500/30';
  }
}

// --- Span Row ---

interface SpanRowProps {
  span: TraceSpan;
  depth: number;
  traceStart: number;
  traceDuration: number;
  selected: boolean;
  onSelect: (span: TraceSpan) => void;
}

function SpanRow({ span, depth, traceStart, traceDuration, selected, onSelect }: SpanRowProps) {
  const offsetPct = traceDuration > 0
    ? ((span.startTime - traceStart) / traceDuration) * 100
    : 0;
  const widthPct = traceDuration > 0
    ? Math.max((span.duration / traceDuration) * 100, 0.5)
    : 100;

  return (
    <button
      onClick={() => onSelect(span)}
      className={cn(
        'flex items-center w-full text-left hover:bg-white/5 transition-colors border-b border-white/5',
        selected && 'bg-white/10'
      )}
    >
      {/* Label column */}
      <div className="w-[280px] flex-shrink-0 px-2 py-1.5 overflow-hidden">
        <div
          className="flex items-center gap-1.5 text-xs truncate"
          style={{ paddingLeft: `${depth * 12}px` }}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusColor(span.status))} />
          <span className="text-muted-foreground truncate">{span.serviceName}</span>
          <span className="text-foreground font-medium truncate">{span.operationName}</span>
        </div>
      </div>

      {/* Waterfall bar column */}
      <div className="flex-1 relative h-6 min-w-0">
        <div
          className={cn('absolute top-1 h-4 rounded-sm', statusColor(span.status), 'opacity-60')}
          style={{
            left: `${offsetPct}%`,
            width: `${widthPct}%`,
            minWidth: '2px',
          }}
        />
        <span
          className="absolute top-0.5 text-[10px] text-muted-foreground whitespace-nowrap"
          style={{ left: `${Math.min(offsetPct + widthPct + 0.5, 90)}%` }}
        >
          {formatDuration(span.duration)}
        </span>
      </div>
    </button>
  );
}

// --- Span Detail ---

function SpanDetail({ span }: { span: TraceSpan }) {
  const tagEntries = Object.entries(span.tags).filter(([, v]) => v !== '');

  return (
    <div className="p-3 border-t border-white/10 bg-black/30 text-xs space-y-2 max-h-48 overflow-auto">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div>
          <span className="text-muted-foreground">Operation:</span>{' '}
          <span className="text-foreground font-medium">{span.operationName}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Service:</span>{' '}
          <span className="text-foreground">{span.serviceName}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Duration:</span>{' '}
          <span className="text-foreground">{formatDuration(span.duration)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Status:</span>{' '}
          <span className={cn(
            'font-medium',
            span.status === 'error' ? 'text-red-400' : span.status === 'ok' ? 'text-emerald-400' : 'text-amber-400'
          )}>
            {span.status}
          </span>
        </div>
        <div className="col-span-2">
          <span className="text-muted-foreground">Span ID:</span>{' '}
          <span className="text-foreground font-mono">{span.spanID}</span>
        </div>
      </div>

      {tagEntries.length > 0 && (
        <div>
          <div className="text-muted-foreground mb-1 font-medium">Attributes</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            {tagEntries.map(([key, value]) => (
              <div key={key} className="truncate">
                <span className="text-blue-400">{key}:</span>{' '}
                <span className="text-foreground">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Flatten tree for rendering ---

function flattenSpans(spans: TraceSpan[], depth = 0): Array<{ span: TraceSpan; depth: number }> {
  const result: Array<{ span: TraceSpan; depth: number }> = [];
  for (const span of spans) {
    result.push({ span, depth });
    if (span.children?.length) {
      result.push(...flattenSpans(span.children, depth + 1));
    }
  }
  return result;
}

// --- Main Component ---

export interface TracePanelProps {
  runId?: string | null;
  traceId?: string | null;
}

export default function TracePanel({ runId, traceId }: TracePanelProps): JSX.Element {
  const [traceData, setTraceData] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<TraceSpan | null>(null);
  const [manualTraceId, setManualTraceId] = useState('');

  const fetchTrace = useCallback(async (id: string, isRunId: boolean) => {
    setLoading(true);
    setError(null);
    setSelectedSpan(null);
    try {
      const data = isRunId
        ? await traceService.getTraceForRun(id)
        : await traceService.getTrace(id);

      if (data.spans.length === 0) {
        setError('No spans found for this trace');
        setTraceData(null);
      } else {
        setTraceData(data);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch trace');
      setTraceData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch when traceId or runId changes
  useEffect(() => {
    if (traceId) {
      fetchTrace(traceId, false);
    } else if (runId) {
      fetchTrace(runId, true);
    }
  }, [traceId, runId, fetchTrace]);

  const handleManualFetch = () => {
    const id = manualTraceId.trim();
    if (id) {
      // If it looks like a UUID, treat as trace_id; otherwise try as run_id
      fetchTrace(id, false);
    }
  };

  // Flatten the span tree for rendering
  const flatSpans = useMemo(() => {
    if (!traceData?.rootSpan) return [];
    return flattenSpans([traceData.rootSpan]);
  }, [traceData]);

  // Calculate trace-wide timing
  const traceStart = useMemo(() => {
    if (!traceData?.spans.length) return 0;
    return Math.min(...traceData.spans.map((s) => s.startTime));
  }, [traceData]);

  const traceDuration = useMemo(() => {
    if (!traceData?.spans.length) return 0;
    const end = Math.max(...traceData.spans.map((s) => s.startTime + s.duration));
    return end - traceStart;
  }, [traceData, traceStart]);

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-black/20">
        <Input
          size="sm"
          placeholder="Trace ID..."
          value={manualTraceId}
          onChange={(e) => setManualTraceId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleManualFetch()}
          className="font-mono text-xs max-w-[300px]"
        />
        <Button size="sm" variant="secondary" onClick={handleManualFetch} className="h-7 text-xs">
          Fetch
        </Button>
        {traceData && (
          <span className="text-[10px] text-muted-foreground ml-2">
            {traceData.spans.length} spans | {formatDuration(traceDuration)}
          </span>
        )}
        {loading && (
          <span className="text-[10px] text-blue-400 animate-pulse">Loading...</span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        {error && (
          <div className="p-4 text-sm text-red-400">{error}</div>
        )}

        {!traceData && !error && !loading && (
          <div className="h-full flex items-center justify-center text-muted-foreground/40 text-xs italic">
            Enter a trace ID or select a run to view its trace
          </div>
        )}

        {flatSpans.length > 0 && (
          <div className="font-mono">
            {/* Column headers */}
            <div className="flex items-center border-b border-white/10 bg-black/40 sticky top-0 z-10">
              <div className="w-[280px] flex-shrink-0 px-2 py-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                Service / Operation
              </div>
              <div className="flex-1 px-2 py-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                Timeline
              </div>
            </div>

            {/* Span rows */}
            {flatSpans.map(({ span, depth }) => (
              <SpanRow
                key={span.spanID}
                span={span}
                depth={depth}
                traceStart={traceStart}
                traceDuration={traceDuration}
                selected={selectedSpan?.spanID === span.spanID}
                onSelect={setSelectedSpan}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail pane */}
      {selectedSpan && <SpanDetail span={selectedSpan} />}
    </div>
  );
}
