import React from 'react';
import { flightRecorder } from '@/services/mission-control/services';
import type { BackoffType } from '@/types/orchestrator';
import { useCanvasStore } from '@/stores/canvas';

interface RetryPolicyState {
  max_retries: number;
  backoff_type: BackoffType;
  backoff_base: number;
  backoff_max: number;
}

export default function InspectorPanel({ runId }: { runId: string | null }) {
  const [stats, setStats] = React.useState<{ checkpoints: number; status?: string }>({ checkpoints: 0 });
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!runId) {
      setStats({ checkpoints: 0 });
      return;
    }
    try {
      const initial = flightRecorder.listCheckpoints(runId).length;
      setStats({ checkpoints: initial, status: flightRecorder.getRun(runId)?.status });
      const unsub = flightRecorder.subscribe(runId, () => {
        setStats({ checkpoints: flightRecorder.listCheckpoints(runId).length, status: flightRecorder.getRun(runId)?.status });
      });
      return () => unsub?.();
    } catch {
      setStats({ checkpoints: 0 });
    }
  }, [runId]);

  // Listen for node selection changes from GraphPanel via window events.
  React.useEffect(() => {
    const onSel = (e: Event) => {
      try {
        const id = (e as CustomEvent).detail?.nodeId as string | undefined;
        setSelectedNodeId(id ?? null);
      } catch {
        setSelectedNodeId(null);
      }
    };
    const onClear = () => setSelectedNodeId(null);
    window.addEventListener('graphNodeSelected', onSel as EventListener);
    window.addEventListener('graphNodeCleared', onClear as EventListener);
    return () => {
      window.removeEventListener('graphNodeSelected', onSel as EventListener);
      window.removeEventListener('graphNodeCleared', onClear as EventListener);
    };
  }, []);

  // Get selected node data from canvas store
  const selectedNode = React.useMemo(() => {
    if (!selectedNodeId) return null;
    const { nodes } = useCanvasStore.getState();
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [selectedNodeId]);

  // Local state for retry policy editing
  const [retryPolicy, setRetryPolicy] = React.useState<RetryPolicyState>({
    max_retries: 3,
    backoff_type: 'exponential',
    backoff_base: 2,
    backoff_max: 60,
  });

  const [nodeTimeout, setNodeTimeout] = React.useState<string>('');

  // Sync local state when selected node changes
  React.useEffect(() => {
    if (selectedNode?.data?.retry_policy) {
      const rp = selectedNode.data.retry_policy;
      setRetryPolicy({
        max_retries: rp.max_retries ?? 3,
        backoff_type: rp.backoff_type ?? 'exponential',
        backoff_base: rp.backoff_base ?? 2,
        backoff_max: rp.backoff_max ?? 60,
      });
    } else {
      setRetryPolicy({ max_retries: 3, backoff_type: 'exponential', backoff_base: 2, backoff_max: 60 });
    }
    setNodeTimeout(selectedNode?.data?.timeout ? String(selectedNode.data.timeout) : '');
  }, [selectedNode]);

  function handleRetryChange(field: keyof RetryPolicyState, value: string) {
    const updated = { ...retryPolicy };
    if (field === 'backoff_type') {
      updated.backoff_type = value as BackoffType;
    } else {
      updated[field] = parseInt(value, 10) || 0;
    }
    setRetryPolicy(updated);

    // Persist to canvas store
    if (selectedNodeId) {
      useCanvasStore.getState().updateNodeConfig(selectedNodeId, { retry_policy: updated });
    }
  }

  function handleTimeoutChange(value: string) {
    setNodeTimeout(value);
    if (selectedNodeId) {
      const seconds = parseInt(value, 10) || 0;
      useCanvasStore.getState().updateNodeConfig(selectedNodeId, {
        timeout: seconds > 0 ? seconds * 1e9 : undefined,
      });
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="font-medium">Run</div>
      {runId ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="text-gray-500">runId</div>
          <div className="font-mono truncate" title={runId}>{runId}</div>
          <div className="text-gray-500">status</div>
          <div>{stats.status || 'n/a'}</div>
          <div className="text-gray-500">checkpoints</div>
          <div>{stats.checkpoints}</div>
        </div>
      ) : (
        <div className="text-gray-500">No active run</div>
      )}

      <div className="font-medium mt-3">Selection</div>
      {selectedNodeId ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="text-gray-500">nodeId</div>
            <div className="font-mono truncate" title={selectedNodeId}>{selectedNodeId}</div>
            {selectedNode?.type && (
              <>
                <div className="text-gray-500">type</div>
                <div>{selectedNode.type}</div>
              </>
            )}
          </div>

          {/* Timeout config */}
          <div className="border-t border-white/10 pt-2">
            <div className="font-medium text-gray-400 mb-1">Timeout</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                placeholder="seconds"
                value={nodeTimeout}
                onChange={(e) => handleTimeoutChange(e.target.value)}
                className="w-20 px-1.5 py-1 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200"
              />
              <span className="text-gray-500 text-[10px]">seconds (0 = no timeout)</span>
            </div>
          </div>

          {/* Retry policy editor */}
          <div className="border-t border-white/10 pt-2">
            <div className="font-medium text-gray-400 mb-1">Retry Policy</div>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="text-gray-500 text-[10px]">Max retries</label>
              <input
                type="number"
                min="0"
                max="10"
                value={retryPolicy.max_retries}
                onChange={(e) => handleRetryChange('max_retries', e.target.value)}
                className="w-full px-1.5 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200"
              />

              <label className="text-gray-500 text-[10px]">Backoff type</label>
              <select
                value={retryPolicy.backoff_type}
                onChange={(e) => handleRetryChange('backoff_type', e.target.value)}
                className="w-full px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200"
              >
                <option value="exponential">Exponential</option>
                <option value="fixed">Fixed</option>
                <option value="linear">Linear</option>
              </select>

              <label className="text-gray-500 text-[10px]">Base (sec)</label>
              <input
                type="number"
                min="1"
                max="300"
                value={retryPolicy.backoff_base}
                onChange={(e) => handleRetryChange('backoff_base', e.target.value)}
                className="w-full px-1.5 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200"
              />

              <label className="text-gray-500 text-[10px]">Max (sec)</label>
              <input
                type="number"
                min="1"
                max="3600"
                value={retryPolicy.backoff_max}
                onChange={(e) => handleRetryChange('backoff_max', e.target.value)}
                className="w-full px-1.5 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded text-zinc-200"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="text-gray-500">No node selected</div>
      )}
    </div>
  );
}
