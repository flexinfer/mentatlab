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
  const [eventSelectedNodeId, setEventSelectedNodeId] = React.useState<string | null>(null);
  const canvasSelectedNodeId = typeof useCanvasStore === 'function'
    ? useCanvasStore((state) => state.selectedNodeId)
    : null;
  const canvasNodes = typeof useCanvasStore === 'function'
    ? useCanvasStore((state) => state.nodes)
    : null;
  const selectedNodeId = canvasSelectedNodeId ?? eventSelectedNodeId;

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
        setEventSelectedNodeId(id ?? null);
      } catch {
        setEventSelectedNodeId(null);
      }
    };
    const onClear = () => setEventSelectedNodeId(null);
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
    const nodes = canvasNodes ?? useCanvasStore.getState().nodes;
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [canvasNodes, selectedNodeId]);

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
    <div className="space-y-4 text-xs">
      <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Run</div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {runId ? 'Live run' : 'Design mode'}
            </div>
          </div>
          <div className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
            runId ? 'bg-emerald-500/10 text-emerald-500' : 'bg-cyan-500/10 text-cyan-500'
          }`}>
            {runId ? 'ACTIVE' : 'DRAFT'}
          </div>
        </div>
      {runId ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="text-gray-500">runId</div>
          <div className="font-mono truncate" title={runId}>{runId}</div>
          <div className="text-gray-500">status</div>
          <div>{stats.status || 'n/a'}</div>
          <div className="text-gray-500">checkpoints</div>
          <div>{stats.checkpoints}</div>
        </div>
      ) : (
        <div className="mt-2 text-muted-foreground">
          <div>No active run</div>
          <div className="mt-1">Build, validate, then press Run when the DAG is ready.</div>
        </div>
      )}
      </div>

      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Selection</div>
      {selectedNodeId ? (
        <div className="space-y-3 rounded-xl border border-border/70 bg-card/80 p-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {(selectedNode?.data?.label as string | undefined) ?? 'Selected node'}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Configure execution safety and runtime behavior for this step.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/20 p-2">
            <div className="text-muted-foreground">nodeId</div>
            <div className="font-mono truncate" title={selectedNodeId}>{selectedNodeId}</div>
            {selectedNode?.type && (
              <>
                <div className="text-muted-foreground">type</div>
                <div>{selectedNode.type}</div>
              </>
            )}
          </div>

          {/* Timeout config */}
          <div className="rounded-lg border border-border/70 bg-background/50 p-3">
            <div className="mb-1 flex items-center justify-between">
              <div className="font-medium text-foreground">Timeout</div>
              <span className="text-[10px] text-muted-foreground">Safety guard</span>
            </div>
            <div className="mb-2 text-[11px] text-muted-foreground">
              Prevent stalled agent work from blocking the whole workflow.
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                placeholder="seconds"
                value={nodeTimeout}
                onChange={(e) => handleTimeoutChange(e.target.value)}
                className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-primary"
              />
              <span className="text-muted-foreground text-[10px]">seconds, 0 = no timeout</span>
            </div>
          </div>

          {/* Retry policy editor */}
          <div className="rounded-lg border border-border/70 bg-background/50 p-3">
            <div className="mb-1 flex items-center justify-between">
              <div className="font-medium text-foreground">Retry Policy</div>
              <span className="text-[10px] text-muted-foreground">Failure recovery</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-muted-foreground text-[10px]">Max retries</label>
              <input
                type="number"
                min="0"
                max="10"
                value={retryPolicy.max_retries}
                onChange={(e) => handleRetryChange('max_retries', e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-[10px] text-foreground outline-none focus:border-primary"
              />

              <label className="text-muted-foreground text-[10px]">Backoff type</label>
              <select
                value={retryPolicy.backoff_type}
                onChange={(e) => handleRetryChange('backoff_type', e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-[10px] text-foreground outline-none focus:border-primary"
              >
                <option value="exponential">Exponential</option>
                <option value="fixed">Fixed</option>
                <option value="linear">Linear</option>
              </select>

              <label className="text-muted-foreground text-[10px]">Base (sec)</label>
              <input
                type="number"
                min="1"
                max="300"
                value={retryPolicy.backoff_base}
                onChange={(e) => handleRetryChange('backoff_base', e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-[10px] text-foreground outline-none focus:border-primary"
              />

              <label className="text-muted-foreground text-[10px]">Max (sec)</label>
              <input
                type="number"
                min="1"
                max="3600"
                value={retryPolicy.backoff_max}
                onChange={(e) => handleRetryChange('backoff_max', e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-[10px] text-foreground outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/80 bg-muted/10 p-4">
          <div className="text-sm font-semibold text-foreground">No node selected</div>
          <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
            Select a canvas node to edit retries, timeouts, and runtime metadata. The builder should feel like a checklist, not a treasure hunt.
          </div>
          <div className="mt-3 space-y-2">
            {['Choose a starter recipe', 'Wire inputs to agents', 'Run and inspect checkpoints'].map((step, index) => (
              <div key={step} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {step}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
