/**
 * GateNode - Visual node for manual approval/pause gates in DAG workflows.
 *
 * Renders as a distinctive blue-colored node with:
 * - Single input handle (top)
 * - Single output handle (bottom)
 * - Approval/reject buttons when status is waiting_approval
 * - Description and timeout display
 */
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { cn } from '@/lib/cn';
import Badge from '@/components/ui/Badge';

export type NodeStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'waiting_approval';

export interface GateNodeData {
  id: string;
  label?: string;
  description?: string;
  timeout?: number;       // Gate timeout in seconds
  autoReject?: boolean;   // Auto-reject on timeout
  status?: NodeStatus;
  runId?: string;         // Run ID for approve/reject API calls
}

export default function GateNode({ data, selected }: NodeProps<GateNodeData>) {
  const label = data.label || 'Approval Gate';
  const isWaiting = data.status === 'waiting_approval';

  const statusBadge = (() => {
    switch (data.status) {
      case 'queued':
        return <Badge variant="info">Queued</Badge>;
      case 'running':
        return (
          <Badge variant="warning">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              Processing
            </span>
          </Badge>
        );
      case 'waiting_approval':
        return (
          <Badge variant="warning">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
              Awaiting Approval
            </span>
          </Badge>
        );
      case 'succeeded':
        return <Badge variant="success">Approved</Badge>;
      case 'failed':
        return <Badge variant="danger">Rejected</Badge>;
      case 'skipped':
        return <Badge>Skipped</Badge>;
      default:
        return null;
    }
  })();

  async function handleApprove() {
    if (!data.runId || !data.id) return;
    try {
      await fetch(`/api/v1/runs/${data.runId}/nodes/${data.id}/approve`, { method: 'POST' });
    } catch (err) {
      console.error('Gate approve failed', err);
    }
  }

  async function handleReject() {
    if (!data.runId || !data.id) return;
    try {
      await fetch(`/api/v1/runs/${data.runId}/nodes/${data.id}/reject`, { method: 'POST' });
    } catch (err) {
      console.error('Gate reject failed', err);
    }
  }

  return (
    <div
      className={cn(
        'px-3 py-2 rounded-lg border-2 text-[11px] shadow-sm relative transition-all',
        'bg-sky-50 dark:bg-sky-900/20 border-sky-300 dark:border-sky-700',
        isWaiting && 'border-yellow-400 dark:border-yellow-600 shadow-yellow-500/20 shadow-md',
        selected && 'outline outline-2 outline-sky-500'
      )}
      style={{ minWidth: 180 }}
    >
      {/* Input handle (top center) */}
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        className="!bg-sky-500 !border-sky-600"
      />

      {/* Header with icon and label */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sky-600 dark:text-sky-400" title="Approval Gate">
            {/* Shield check icon */}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </span>
          <span className="font-medium text-sky-800 dark:text-sky-200">{label}</span>
        </div>
        {statusBadge}
      </div>

      {/* Type indicator */}
      <div className="text-[10px] text-sky-600/70 dark:text-sky-400/70 uppercase tracking-wider mb-1">
        Manual Gate
      </div>

      {/* Description */}
      {data.description && (
        <div className="text-[10px] text-sky-700 dark:text-sky-300 bg-sky-100/50 dark:bg-sky-900/30 px-2 py-1 rounded mb-1">
          {data.description}
        </div>
      )}

      {/* Timeout indicator */}
      {data.timeout && data.timeout > 0 && (
        <div className="flex items-center gap-1 text-[9px] text-sky-600/70 dark:text-sky-400/70">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Timeout: {data.timeout}s{data.autoReject ? ' (auto-reject)' : ''}</span>
        </div>
      )}

      {/* Approve/Reject buttons when waiting */}
      {isWaiting && (
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleApprove}
            className="flex-1 px-2 py-1 text-[10px] font-medium rounded bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
          >
            Approve
          </button>
          <button
            onClick={handleReject}
            className="flex-1 px-2 py-1 text-[10px] font-medium rounded bg-red-500 hover:bg-red-600 text-white transition-colors"
          >
            Reject
          </button>
        </div>
      )}

      {/* Output handle (bottom center) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        className="!bg-sky-500 !border-sky-600"
      />
    </div>
  );
}
