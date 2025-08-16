import React from 'react';
import { Handle, Position } from 'reactflow';
import Badge from '@/components/ui/Badge';

export type NodeStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type NodeCardData = {
  id: string;
  title?: string;
  status: NodeStatus;
  attempts?: number;
  lastExitCode?: number | null;
  progress?: number | null; // optional checkpoint-derived progress
};

export default function NodeCard({ data, selected }: { data: NodeCardData; selected?: boolean }) {
  const title = data.title || data.id;

  const statusBadge = (() => {
    switch (data.status) {
      case 'queued':
        return <Badge variant="info">Queued</Badge>;
      case 'running':
        return (
          <Badge variant="warning">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Running
            </span>
          </Badge>
        );
      case 'succeeded':
        return <Badge variant="success">Succeeded</Badge>;
      case 'failed':
        return <Badge variant="danger">Failed</Badge>;
      default:
        return <Badge>Unknown</Badge>;
    }
  })();

  return (
    <div
      className={[
        'px-2 py-1.5 rounded-md border text-[11px] shadow-sm relative transition-all',
        'bg-card/90 dark:bg-slate-900/70 border-slate-200 dark:border-slate-800 text-foreground',
        selected ? 'outline outline-1 outline-indigo-400' : '',
      ].join(' ')}
      style={{ minWidth: 160 }}
    >
      {/* Default handles (kept subtle) */}
      <Handle type="target" position={Position.Left} id="in" style={{ background: 'hsl(var(--ring))' }} />
      <Handle type="source" position={Position.Right} id="out" style={{ background: 'hsl(var(--ring))' }} />

      <div className="flex items-center justify-between gap-2">
        <div className="font-medium truncate">{title}</div>
        <div>{statusBadge}</div>
      </div>

      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="truncate">Attempts: {data.attempts ?? 0}</span>
        {typeof data.lastExitCode === 'number' && (
          <span title="Last exit code">exit={data.lastExitCode}</span>
        )}
      </div>

      {typeof data.progress === 'number' && data.status === 'running' && (
        <div className="mt-1">
          <div className="w-full h-1.5 bg-muted rounded overflow-hidden">
            <div
              className="h-1.5 bg-amber-500 transition-all"
              style={{ width: `${Math.max(0, Math.min(100, data.progress))}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}