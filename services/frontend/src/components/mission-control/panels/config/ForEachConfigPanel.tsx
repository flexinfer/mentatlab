/**
 * ForEachConfigPanel - Configuration panel for for-each/loop nodes.
 *
 * Allows editing:
 * - Collection expression
 * - Item and index variable names
 * - Parallelism settings
 * - Body node selection
 */
import React from 'react';
import { Input } from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import type { ForEachConfig } from '@/types/orchestrator';

export interface ForEachConfigPanelProps {
  nodeId: string;
  config: ForEachConfig;
  onUpdate: (config: ForEachConfig) => void;
  readOnly?: boolean;
  availableNodes?: string[]; // For body node selection
}

export default function ForEachConfigPanel({
  nodeId,
  config,
  onUpdate,
  readOnly = false,
  availableNodes = [],
}: ForEachConfigPanelProps) {
  const handleCollectionChange = (collection: string) => {
    if (readOnly) return;
    onUpdate({ ...config, collection });
  };

  const handleItemVarChange = (item_var: string) => {
    if (readOnly) return;
    onUpdate({ ...config, item_var });
  };

  const handleIndexVarChange = (index_var: string) => {
    if (readOnly) return;
    onUpdate({ ...config, index_var: index_var || undefined });
  };

  const handleMaxParallelChange = (value: string) => {
    if (readOnly) return;
    const num = parseInt(value, 10);
    onUpdate({ ...config, max_parallel: isNaN(num) ? 1 : Math.max(1, num) });
  };

  const toggleBodyNode = (bodyNodeId: string) => {
    if (readOnly) return;
    const body = config.body || [];
    const newBody = body.includes(bodyNodeId)
      ? body.filter((id) => id !== bodyNodeId)
      : [...body, bodyNodeId];
    onUpdate({ ...config, body: newBody });
  };

  const maxParallel = config.max_parallel || 1;
  const isParallel = maxParallel > 1;

  return (
    <div className="space-y-4 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="font-medium text-sm">For Each: {nodeId}</div>
        {isParallel ? (
          <Badge variant="warning">{maxParallel} Parallel</Badge>
        ) : (
          <Badge variant="info">Sequential</Badge>
        )}
      </div>

      {/* Collection expression */}
      <div className="space-y-1">
        <label className="text-gray-500">Collection Expression</label>
        <Input
          size="sm"
          value={config.collection}
          onChange={(e) => handleCollectionChange(e.target.value)}
          placeholder="e.g., inputs.items or context.files"
          className="font-mono"
          readOnly={readOnly}
        />
        <div className="text-[10px] text-gray-500">
          Expression that evaluates to an array to iterate over
        </div>
      </div>

      {/* Variable names */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-gray-500">Item Variable</label>
          <Input
            size="sm"
            value={config.item_var}
            onChange={(e) => handleItemVarChange(e.target.value)}
            placeholder="item"
            className="font-mono"
            readOnly={readOnly}
          />
        </div>
        <div className="space-y-1">
          <label className="text-gray-500">Index Variable (optional)</label>
          <Input
            size="sm"
            value={config.index_var || ''}
            onChange={(e) => handleIndexVarChange(e.target.value)}
            placeholder="i"
            className="font-mono"
            readOnly={readOnly}
          />
        </div>
      </div>

      {/* Parallelism */}
      <div className="space-y-1">
        <label className="text-gray-500">Max Parallel</label>
        <div className="flex items-center gap-3">
          <Input
            size="sm"
            type="number"
            min="1"
            max="100"
            value={maxParallel}
            onChange={(e) => handleMaxParallelChange(e.target.value)}
            className="w-20 font-mono"
            readOnly={readOnly}
          />
          <div className="flex gap-2">
            {[1, 2, 4, 8].map((n) => (
              <button
                key={n}
                className={`px-2 py-1 rounded border text-xs ${
                  maxParallel === n
                    ? 'bg-purple-500/20 border-purple-500 text-purple-400'
                    : 'border-white/10 text-gray-400 hover:border-white/20'
                }`}
                onClick={() => handleMaxParallelChange(String(n))}
                disabled={readOnly}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="text-[10px] text-gray-500">
          {maxParallel === 1
            ? 'Iterations run sequentially'
            : `Up to ${maxParallel} iterations run in parallel`}
        </div>
      </div>

      {/* Body nodes */}
      <div className="space-y-2">
        <label className="text-gray-500">
          Body Nodes ({(config.body || []).length} selected)
        </label>
        {availableNodes.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {availableNodes.map((availableNodeId) => {
              const isSelected = (config.body || []).includes(availableNodeId);
              return (
                <button
                  key={availableNodeId}
                  className={`px-2 py-1 rounded border text-xs font-mono ${
                    isSelected
                      ? 'bg-purple-500/20 border-purple-500 text-purple-400'
                      : 'border-white/10 text-gray-400 hover:border-white/20'
                  }`}
                  onClick={() => toggleBodyNode(availableNodeId)}
                  disabled={readOnly}
                >
                  {availableNodeId}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-gray-500 italic">
            {(config.body || []).length > 0
              ? `Body: ${config.body?.join(', ')}`
              : 'No body nodes configured'}
          </div>
        )}
      </div>

      {/* Variable usage help */}
      <div className="p-2 rounded bg-white/5 border border-white/10 text-[10px] text-gray-500">
        <div className="font-medium text-gray-400 mb-1">Variables in Loop Body</div>
        <ul className="space-y-0.5">
          <li>
            <code className="text-purple-400">{config.item_var || 'item'}</code> - Current item value
          </li>
          {config.index_var && (
            <li>
              <code className="text-purple-400">{config.index_var}</code> - Current iteration index (0-based)
            </li>
          )}
          <li>
            <code className="text-purple-400">LOOP_{config.item_var || 'item'}</code> - Available as env var
          </li>
          <li>
            <code className="text-purple-400">ITERATION_INDEX</code> - Index as env var
          </li>
        </ul>
      </div>

      {/* Performance note for parallel */}
      {isParallel && (
        <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400">
          <div className="font-medium mb-0.5">Parallel Execution</div>
          <div>
            Iterations execute in parallel. Ensure body nodes are idempotent and don't depend on execution order.
          </div>
        </div>
      )}
    </div>
  );
}
