import React from 'react';
import { flightRecorder } from '@/services/mission-control/services';

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
        <div className="grid grid-cols-2 gap-2">
          <div className="text-gray-500">nodeId</div>
          <div className="font-mono truncate" title={selectedNodeId}>{selectedNodeId}</div>
        </div>
      ) : (
        <div className="text-gray-500">No node selected</div>
      )}
    </div>
  );
}
