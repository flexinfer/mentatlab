/**
 * ConditionalNode - Visual node for if/switch branching in DAG workflows.
 *
 * Renders as a distinctive amber-colored node with:
 * - Single input handle (top)
 * - Multiple output handles for branches (bottom, positioned based on branch count)
 * - Expression display in monospace font
 * - Status indication matching the standard node card pattern
 */
import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { cn } from '@/lib/cn';
import Badge from '@/components/ui/Badge';

export type NodeStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface ConditionalBranch {
  condition?: string;  // For switch cases
  targets: string[];   // Downstream node IDs
}

export interface ConditionalNodeData {
  id: string;
  label?: string;
  type: 'if' | 'switch';
  expression: string;
  branches: Record<string, ConditionalBranch>;
  default?: string;
  status?: NodeStatus;
  selectedBranch?: string;  // Set after evaluation
}

export default function ConditionalNode({ data, selected }: NodeProps<ConditionalNodeData>) {
  const label = data.label || 'Conditional';
  const branchKeys = Object.keys(data.branches || {});
  const branchCount = branchKeys.length;

  const statusBadge = (() => {
    switch (data.status) {
      case 'queued':
        return <Badge variant="info">Queued</Badge>;
      case 'running':
        return (
          <Badge variant="warning">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Evaluating
            </span>
          </Badge>
        );
      case 'succeeded':
        return <Badge variant="success">Evaluated</Badge>;
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
        'px-3 py-2 rounded-lg border-2 text-[11px] shadow-sm relative transition-all',
        'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700',
        selected && 'outline outline-2 outline-amber-500'
      )}
      style={{ minWidth: 180 }}
    >
      {/* Input handle (top center) */}
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        className="!bg-amber-500 !border-amber-600"
      />

      {/* Header with icon and label */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="text-amber-600 dark:text-amber-400" title="Conditional">
            {/* Git branch icon */}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </span>
          <span className="font-medium text-amber-800 dark:text-amber-200">{label}</span>
        </div>
        {statusBadge}
      </div>

      {/* Type indicator */}
      <div className="text-[10px] text-amber-600/70 dark:text-amber-400/70 uppercase tracking-wider mb-1">
        {data.type === 'if' ? 'If/Else' : 'Switch'}
      </div>

      {/* Expression */}
      <div className="font-mono text-[10px] text-amber-700 dark:text-amber-300 bg-amber-100/50 dark:bg-amber-900/30 px-2 py-1 rounded truncate" title={data.expression}>
        {data.expression || '(no expression)'}
      </div>

      {/* Branch labels */}
      {branchCount > 0 && (
        <div className="mt-2 flex justify-between text-[9px] text-amber-600/80 dark:text-amber-400/80">
          {branchKeys.map((branchId, index) => {
            const isSelected = data.selectedBranch === branchId;
            return (
              <span
                key={branchId}
                className={cn(
                  'px-1 rounded',
                  isSelected && 'bg-amber-200 dark:bg-amber-800 font-medium'
                )}
              >
                {branchId}
              </span>
            );
          })}
        </div>
      )}

      {/* Output handles for each branch */}
      {branchKeys.map((branchId, index) => {
        // Position handles evenly across the bottom
        const position = branchCount === 1
          ? 50
          : ((index + 1) / (branchCount + 1)) * 100;

        return (
          <Handle
            key={branchId}
            type="source"
            position={Position.Bottom}
            id={branchId}
            className={cn(
              '!bg-amber-500 !border-amber-600',
              data.selectedBranch === branchId && '!bg-emerald-500 !border-emerald-600'
            )}
            style={{ left: `${position}%` }}
          />
        );
      })}

      {/* Default handle if no branches or for fallback */}
      {branchCount === 0 && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="default"
          className="!bg-amber-500 !border-amber-600"
        />
      )}
    </div>
  );
}
