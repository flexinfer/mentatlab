/**
 * ForEachNode - Visual node for loop iteration in DAG workflows.
 *
 * Renders as a distinctive purple-colored node with:
 * - Single input handle (top)
 * - Body output handle (bottom) for loop body nodes
 * - Complete output handle (right) for post-loop continuation
 * - Collection expression and item variable display
 * - Iteration progress during execution
 */
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { cn } from '@/lib/cn';
import Badge from '@/components/ui/Badge';

export type NodeStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface ForEachNodeData {
  id: string;
  label?: string;
  collection: string;      // Expression yielding array, e.g., "inputs.items"
  itemVar: string;         // Variable name for each item, e.g., "item"
  indexVar?: string;       // Optional index variable
  maxParallel?: number;    // 0 = sequential, > 0 = parallel
  body?: string[];         // Node IDs in the loop body
  status?: NodeStatus;
  // Runtime state
  currentIteration?: number;
  totalIterations?: number;
}

export default function ForEachNode({ data, selected }: NodeProps<ForEachNodeData>) {
  const label = data.label || 'For Each';
  const maxParallel = data.maxParallel || 1;
  const isParallel = maxParallel > 1;

  const progress = data.totalIterations && data.currentIteration !== undefined
    ? (data.currentIteration / data.totalIterations) * 100
    : null;

  const statusBadge = (() => {
    switch (data.status) {
      case 'queued':
        return <Badge variant="info">Queued</Badge>;
      case 'running':
        return (
          <Badge variant="warning">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
              {data.currentIteration !== undefined && data.totalIterations
                ? `${data.currentIteration}/${data.totalIterations}`
                : 'Iterating'}
            </span>
          </Badge>
        );
      case 'succeeded':
        return <Badge variant="success">Complete</Badge>;
      case 'failed':
        return <Badge variant="danger">Failed</Badge>;
      case 'skipped':
        return <Badge>Skipped</Badge>;
      default:
        return null;
    }
  })();

  return (
    <div
      className={cn(
        'px-3 py-2 rounded-lg border-2 border-dashed text-[11px] shadow-sm relative transition-all',
        'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700',
        selected && 'outline outline-2 outline-purple-500'
      )}
      style={{ minWidth: 180 }}
    >
      {/* Input handle (top center) */}
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        className="!bg-purple-500 !border-purple-600"
      />

      {/* Header with icon and label */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-purple-600 dark:text-purple-400" title="For Each Loop">
            {/* Repeat icon */}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </span>
          <span className="font-medium text-purple-800 dark:text-purple-200">{label}</span>
        </div>
        {statusBadge}
      </div>

      {/* Loop expression */}
      <div className="text-[10px] text-purple-700 dark:text-purple-300 mt-1">
        <span className="font-mono bg-purple-100/50 dark:bg-purple-900/30 px-1 rounded">
          {data.itemVar || 'item'}
        </span>
        {data.indexVar && (
          <>
            {', '}
            <span className="font-mono bg-purple-100/50 dark:bg-purple-900/30 px-1 rounded">
              {data.indexVar}
            </span>
          </>
        )}
        <span className="text-purple-600/70 dark:text-purple-400/70"> in </span>
        <span className="font-mono bg-purple-100/50 dark:bg-purple-900/30 px-1 rounded truncate" title={data.collection}>
          {data.collection || '[]'}
        </span>
      </div>

      {/* Parallel indicator */}
      {isParallel && (
        <div className="flex items-center gap-1 mt-1.5 text-[9px] text-purple-600 dark:text-purple-400">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>{maxParallel} parallel</span>
        </div>
      )}

      {/* Body nodes count */}
      {data.body && data.body.length > 0 && (
        <div className="mt-1.5 text-[9px] text-purple-600/70 dark:text-purple-400/70">
          {data.body.length} body node{data.body.length !== 1 ? 's' : ''}
        </div>
      )}

      {/* Progress bar during execution */}
      {progress !== null && data.status === 'running' && (
        <div className="mt-2">
          <div className="w-full h-1.5 bg-purple-200 dark:bg-purple-800 rounded overflow-hidden">
            <div
              className="h-1.5 bg-purple-500 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        </div>
      )}

      {/* Body output handle (bottom) - connects to loop body nodes */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="body"
        className="!bg-purple-500 !border-purple-600"
        style={{ left: '30%' }}
      />

      {/* Complete output handle (right) - connects to post-loop nodes */}
      <Handle
        type="source"
        position={Position.Right}
        id="complete"
        className="!bg-emerald-500 !border-emerald-600"
      />

      {/* Handle labels */}
      <div className="absolute -bottom-4 left-[30%] -translate-x-1/2 text-[8px] text-purple-500">
        body
      </div>
      <div className="absolute top-1/2 -right-4 translate-x-1/2 -translate-y-1/2 text-[8px] text-emerald-500 rotate-90">
        done
      </div>
    </div>
  );
}
