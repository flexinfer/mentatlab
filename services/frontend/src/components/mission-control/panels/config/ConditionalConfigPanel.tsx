/**
 * ConditionalConfigPanel - Configuration panel for conditional/branching nodes.
 *
 * Allows editing:
 * - Condition type (if/switch)
 * - Expression to evaluate
 * - Branch definitions
 */
import React from 'react';
import { Input } from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import type { ConditionalConfig, ConditionalBranch } from '@/types/orchestrator';

export interface ConditionalConfigPanelProps {
  nodeId: string;
  config: ConditionalConfig;
  onUpdate: (config: ConditionalConfig) => void;
  readOnly?: boolean;
}

export default function ConditionalConfigPanel({
  nodeId,
  config,
  onUpdate,
  readOnly = false,
}: ConditionalConfigPanelProps) {
  const handleTypeChange = (type: 'if' | 'switch') => {
    if (readOnly) return;
    onUpdate({ ...config, type });
  };

  const handleExpressionChange = (expression: string) => {
    if (readOnly) return;
    onUpdate({ ...config, expression });
  };

  const handleDefaultChange = (defaultBranch: string) => {
    if (readOnly) return;
    onUpdate({ ...config, default: defaultBranch || undefined });
  };

  const handleBranchConditionChange = (branchId: string, condition: string) => {
    if (readOnly) return;
    const branches = { ...config.branches };
    branches[branchId] = { ...branches[branchId], condition };
    onUpdate({ ...config, branches });
  };

  const addBranch = () => {
    if (readOnly) return;
    const branchId = `branch_${Object.keys(config.branches).length + 1}`;
    const branches = {
      ...config.branches,
      [branchId]: { condition: '', targets: [] },
    };
    onUpdate({ ...config, branches });
  };

  const removeBranch = (branchId: string) => {
    if (readOnly) return;
    const branches = { ...config.branches };
    delete branches[branchId];
    onUpdate({ ...config, branches });
  };

  const branchKeys = Object.keys(config.branches || {});

  return (
    <div className="space-y-4 text-xs">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="font-medium text-sm">Conditional: {nodeId}</div>
        <Badge variant={config.type === 'if' ? 'info' : 'warning'}>
          {config.type === 'if' ? 'If/Else' : 'Switch'}
        </Badge>
      </div>

      {/* Type selector */}
      <div className="space-y-1">
        <label className="text-gray-500">Type</label>
        <div className="flex gap-2">
          <button
            className={`px-3 py-1 rounded border text-xs ${
              config.type === 'if'
                ? 'bg-primary/10 border-primary text-primary'
                : 'border-white/10 text-gray-400 hover:border-white/20'
            }`}
            onClick={() => handleTypeChange('if')}
            disabled={readOnly}
          >
            If/Else
          </button>
          <button
            className={`px-3 py-1 rounded border text-xs ${
              config.type === 'switch'
                ? 'bg-primary/10 border-primary text-primary'
                : 'border-white/10 text-gray-400 hover:border-white/20'
            }`}
            onClick={() => handleTypeChange('switch')}
            disabled={readOnly}
          >
            Switch
          </button>
        </div>
      </div>

      {/* Expression */}
      <div className="space-y-1">
        <label className="text-gray-500">
          {config.type === 'if' ? 'Condition Expression' : 'Switch Expression'}
        </label>
        <Input
          size="sm"
          value={config.expression}
          onChange={(e) => handleExpressionChange(e.target.value)}
          placeholder={config.type === 'if' ? 'e.g., inputs.score > 0.8' : 'e.g., inputs.status'}
          className="font-mono"
          readOnly={readOnly}
        />
        <div className="text-[10px] text-gray-500">
          Available: inputs.*, context.*, len(), string functions
        </div>
      </div>

      {/* Branches */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-gray-500">Branches</label>
          {!readOnly && (
            <button
              className="px-2 py-0.5 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/20 text-xs"
              onClick={addBranch}
            >
              + Add
            </button>
          )}
        </div>

        {branchKeys.length === 0 ? (
          <div className="text-gray-500 italic">No branches defined</div>
        ) : (
          <div className="space-y-2">
            {branchKeys.map((branchId) => {
              const branch = config.branches[branchId];
              return (
                <div
                  key={branchId}
                  className="flex items-center gap-2 p-2 rounded border border-white/10 bg-white/5"
                >
                  <div className="flex-1">
                    <div className="font-mono text-amber-400 text-[10px] mb-1">
                      {branchId}
                    </div>
                    {config.type === 'switch' && (
                      <Input
                        size="sm"
                        value={branch.condition || ''}
                        onChange={(e) => handleBranchConditionChange(branchId, e.target.value)}
                        placeholder="Case value"
                        className="font-mono text-xs"
                        readOnly={readOnly}
                      />
                    )}
                    {branch.targets.length > 0 && (
                      <div className="text-[10px] text-gray-500 mt-1">
                        Targets: {branch.targets.join(', ')}
                      </div>
                    )}
                  </div>
                  {!readOnly && (
                    <button
                      className="p-1 text-gray-500 hover:text-red-400"
                      onClick={() => removeBranch(branchId)}
                      title="Remove branch"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Default branch (for switch) */}
      {config.type === 'switch' && (
        <div className="space-y-1">
          <label className="text-gray-500">Default Branch</label>
          <Input
            size="sm"
            value={config.default || ''}
            onChange={(e) => handleDefaultChange(e.target.value)}
            placeholder="Branch ID for default case"
            className="font-mono"
            readOnly={readOnly}
          />
        </div>
      )}

      {/* Expression Help */}
      <div className="p-2 rounded bg-white/5 border border-white/10 text-[10px] text-gray-500">
        <div className="font-medium text-gray-400 mb-1">Expression Syntax Help</div>
        <ul className="space-y-0.5">
          <li><code className="text-amber-400">inputs.nodeId.field</code> - Access node output</li>
          <li><code className="text-amber-400">context.run_id</code> - Access run context</li>
          <li><code className="text-amber-400">len(items)</code> - Get array length</li>
          <li><code className="text-amber-400">a && b || c</code> - Logical operators</li>
          <li><code className="text-amber-400">{'x > 0.8'}</code> - Comparisons</li>
        </ul>
      </div>
    </div>
  );
}
