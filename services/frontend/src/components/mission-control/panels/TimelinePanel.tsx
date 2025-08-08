import React from 'react';
import { flightRecorder, reports } from '../../../services/mission-control/services';

type Props = {
  runId: string | null;
};

export function TimelinePanel({ runId }: Props) {
  const [checkpoints, setCheckpoints] = React.useState(() => (runId ? flightRecorder.listCheckpoints(runId) : []));
  const [summary, setSummary] = React.useState(() => (runId ? flightRecorder.getRun(runId) : undefined));
  const [reportMd, setReportMd] = React.useState<string | null>(null);

  // Selection state for UI highlighting when a timeline item is chosen
  const [selectedCheckpointId, setSelectedCheckpointId] = React.useState<string | null>(null);

  // Subscribe to checkpoint stream for this run and selection events
  React.useEffect(() => {
    if (!runId) {
      setCheckpoints([]);
      setSummary(undefined);
      setReportMd(null);
      setSelectedCheckpointId(null);
      return;
    }

    // Initial snapshot
    try {
      setCheckpoints(flightRecorder.listCheckpoints(runId));
      setSummary(flightRecorder.getRun(runId));
    } catch {
      setCheckpoints([]);
      setSummary(undefined);
    }

    const unsub = flightRecorder.subscribe(runId, () => {
      try {
        setCheckpoints(flightRecorder.listCheckpoints(runId));
        setSummary(flightRecorder.getRun(runId));
      } catch {
        // ignore
      }
    });

    // Subscribe to selection channel so Timeline highlights when selection changes elsewhere
    const unsubSelect = flightRecorder.onSelect((payload) => {
      try {
        if (payload?.runId === runId) setSelectedCheckpointId(payload.checkpointId);
      } catch {
        // ignore
      }
    });

    return () => {
      unsub?.();
      unsubSelect?.();
      setSelectedCheckpointId(null);
    };
  }, [runId]);

  if (!runId) {
    return (
      <div className="h-full w-full flex items-center justify-center text-[11px] text-gray-500">
        No run selected. Start a run to record timeline.
      </div>
    );
  }

  const onGenerateReport = () => {
    const md = reports.generate(runId, { mode: 'engineer', includeArtifacts: false }, flightRecorder).markdown;
    setReportMd(md);
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="px-2 py-1 border-b bg-white/60 backdrop-blur flex items-center justify-between">
        <div className="text-[11px] text-gray-600">
          <span className="font-medium">Run:</span> {runId}{' '}
          <span className="mx-1 text-gray-300">|</span>
          <span className="font-medium">Status:</span> {summary?.status ?? 'unknown'}{' '}
          {summary?.metrics?.durationMs !== undefined && (
            <>
              <span className="mx-1 text-gray-300">|</span>
              <span className="font-medium">Duration:</span> {Math.round(summary.metrics.durationMs)}ms
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="h-6 px-2 text-[11px] rounded border bg-white hover:bg-gray-50"
            onClick={onGenerateReport}
          >
            Generate Report
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {checkpoints.length === 0 ? (
          <div className="p-3 text-[11px] text-gray-500">No checkpoints yet. Actions you take will appear here.</div>
        ) : (
          <ul className="divide-y">
            {checkpoints.map((c) => {
              const isSelected = selectedCheckpointId === c.id;
              return (
                <li
                  key={c.id}
                  className={['px-3 py-2 text-[11px] cursor-pointer', isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''].join(' ')}
                  onClick={() => {
                    try {
                      flightRecorder.selectCheckpoint(runId!, c.id);
                    } catch {
                      // ignore selection errors
                    }
                    try {
                      // Attempt to scroll console anchor into view
                      const el = document.getElementById(`console-${c.id}`);
                      if (el && typeof el.scrollIntoView === 'function') {
                        el.scrollIntoView({ block: 'nearest' });
                      }
                    } catch {
                      // ignore DOM errors
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-1.5 w-1.5 rounded-full bg-indigo-500" />
                      <span className="text-gray-400">{new Date(c.at).toLocaleTimeString()}</span>
                      <span className="font-medium text-gray-700">{c.label}</span>
                    </div>
                    {c.media?.length ? (
                      <span className="text-gray-400">{c.media.length} media</span>
                    ) : null}
                  </div>
                  {c.data && (
                    <pre className="mt-1 text-[10px] bg-gray-50 border rounded p-2 overflow-auto max-h-24">
                      {JSON.stringify(c.data, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {reportMd && (
        <div className="border-t">
          <div className="px-2 py-1 bg-gray-50 text-[11px] text-gray-600 flex items-center justify-between">
            <span>Report (Engineer View)</span>
            <button
              className="h-6 px-2 text-[11px] rounded border bg-white hover:bg-gray-50"
              onClick={() => setReportMd(null)}
            >
              Close
            </button>
          </div>
          <pre className="p-2 text-[11px] overflow-auto max-h-40 whitespace-pre-wrap">{reportMd}</pre>
        </div>
      )}
    </div>
  );
}

export default TimelinePanel;