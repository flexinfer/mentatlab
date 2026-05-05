import React from 'react';
import { orchestratorService } from '@/services/api/orchestratorService';
import { parseRunEvent } from '@/services/streaming/parse';
import type OrchestratorSSE from '@/services/api/streaming/orchestratorSSE';

type TimelineEntry = {
  id: string;
  at: string;
  label: string;
  data?: Record<string, unknown>;
  nodeId?: string;
};

type Props = {
  runId: string | null;
};

export function TimelinePanel({ runId }: Props) {
  const [entries, setEntries] = React.useState<TimelineEntry[]>([]);
  const [runStatus, setRunStatus] = React.useState<string>('unknown');
  const [selectedEntryId, setSelectedEntryId] = React.useState<string | null>(null);
  const sseRef = React.useRef<OrchestratorSSE | null>(null);
  const seqRef = React.useRef(0);

  React.useEffect(() => {
    if (!runId) {
      setEntries([]);
      setRunStatus('unknown');
      setSelectedEntryId(null);
      return;
    }

    seqRef.current = 0;
    setEntries([]);
    setRunStatus('running');

    const sse = orchestratorService.streamRunEvents(runId, {
      onOpen: () => {
        setRunStatus('connected');
      },
      onRaw: (evt: any) => {
        try {
          const parsed = parseRunEvent(evt);
          if (!parsed) return;

          const seq = seqRef.current++;
          const entry: TimelineEntry = {
            id: `tl-${seq}`,
            at: parsed.ts || new Date().toISOString(),
            label: formatLabel(parsed.type, parsed.data),
            data: parsed.data,
            nodeId: parsed.nodeId,
          };

          // Update run status from status events
          if (parsed.type === 'status' && parsed.data?.status) {
            setRunStatus(String(parsed.data.status));
          }

          setEntries((prev) => [...prev, entry]);
        } catch {
          // ignore parse errors
        }
      },
      onError: () => {
        // SSE client handles reconnection internally
      },
    });

    sseRef.current = sse;

    return () => {
      sse.close();
      sseRef.current = null;
    };
  }, [runId]);

  // Console event selection correlation
  React.useEffect(() => {
    const handleConsoleEventSelected = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail as { item?: { ts?: string }; runId?: string };
        if (detail?.runId !== runId || !detail?.item?.ts) return;

        const eventTime = new Date(detail.item.ts).getTime();
        let closest: { id: string; delta: number } | null = null;

        for (const entry of entries) {
          const entryTime = new Date(entry.at).getTime();
          const delta = Math.abs(entryTime - eventTime);
          if (!closest || delta < closest.delta) {
            closest = { id: entry.id, delta };
          }
        }

        if (closest && closest.delta < 5000) {
          setSelectedEntryId(closest.id);
          setTimeout(() => {
            const el = document.querySelector(`[data-timeline-id="${closest!.id}"]`);
            if (el) (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 50);
        }
      } catch {
        // ignore correlation errors
      }
    };

    window.addEventListener('consoleEventSelected', handleConsoleEventSelected);
    return () => window.removeEventListener('consoleEventSelected', handleConsoleEventSelected);
  }, [runId, entries]);

  if (!runId) {
    return (
      <div className="h-full w-full flex items-center justify-center text-[11px] text-gray-500">
        No run selected. Start a run to record timeline.
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col">
      <div className="px-2 py-1 border-b border-border/70 bg-card/80 backdrop-blur flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">
          <span className="font-medium">Run:</span> {runId}{' '}
          <span className="mx-1 text-muted-foreground/30">|</span>
          <span className="font-medium">Status:</span> {runStatus}{' '}
          <span className="mx-1 text-muted-foreground/30">|</span>
          <span className="font-medium">Events:</span> {entries.length}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {entries.length === 0 ? (
          <div className="p-3 text-[11px] text-gray-500">Waiting for events...</div>
        ) : (
          <ul className="divide-y">
            {entries.map((entry) => {
              const isSelected = selectedEntryId === entry.id;
              return (
                <li
                  key={entry.id}
                  data-timeline-id={entry.id}
                  className={[
                    'px-3 py-2 text-[11px] cursor-pointer transition-colors',
                    isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-muted/40',
                  ].join(' ')}
                  onClick={() => {
                    setSelectedEntryId(entry.id);
                    window.dispatchEvent(
                      new CustomEvent('timelineCheckpointSelected', {
                        detail: { checkpointId: entry.id, timestamp: entry.at, runId },
                      })
                    );
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex h-1.5 w-1.5 rounded-full ${statusColor(entry.label)}`} />
                    <span className="text-muted-foreground">{new Date(entry.at).toLocaleTimeString()}</span>
                    <span className="font-medium text-foreground">{entry.label}</span>
                  </div>
                  {entry.nodeId && (
                    <span className="text-muted-foreground font-mono text-[10px]">{entry.nodeId}</span>
                  )}
                </div>
                {entry.data && (
                    <pre className="mt-1 text-[10px] bg-muted/30 border border-border/70 rounded p-2 overflow-auto max-h-24">
                      {JSON.stringify(entry.data, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatLabel(type: string, data?: Record<string, unknown>): string {
  switch (type) {
    case 'node_status':
      return `node:${data?.status ?? 'update'}`;
    case 'status':
      return `run:${data?.status ?? 'update'}`;
    case 'hello':
      return 'run:connected';
    case 'checkpoint':
      return `checkpoint:${data?.type ?? 'event'}`;
    case 'condition_evaluated':
      return `condition:evaluated`;
    case 'branch_selected':
      return `branch:${data?.branch ?? 'selected'}`;
    case 'branch_skipped':
      return `branch:skipped`;
    case 'loop_started':
      return `loop:started (${data?.item_count ?? '?'} items)`;
    case 'loop_iteration':
      return `loop:iter ${data?.index ?? '?'}/${data?.total ?? '?'}`;
    case 'loop_complete':
      return `loop:complete`;
    default:
      return type;
  }
}

function statusColor(label: string): string {
  if (label.includes('succeeded') || label.includes('complete')) return 'bg-green-500';
  if (label.includes('failed') || label.includes('error')) return 'bg-red-500';
  if (label.includes('running') || label.includes('started')) return 'bg-blue-500';
  if (label.includes('skipped')) return 'bg-yellow-500';
  return 'bg-indigo-500';
}

export default TimelinePanel;
