import React from 'react';
import type { Flow } from '../../../types/graph';
import { linter } from '../../../services/mission-control/services';
import { loadFlow } from '../../../loadFlow';

type IssuesPanelProps = {
  flow?: Flow;
};

export default function IssuesPanel({ flow }: IssuesPanelProps) {
  const [issues, setIssues] = React.useState(() => [] as ReturnType<typeof linter.analyze>);
  const [status, setStatus] = React.useState<'idle' | 'running' | 'done'>('idle');

  const runLint = React.useCallback(async () => {
    setStatus('running');
    try {
      const targetFlow = flow ?? (await loadFlow('example-flow'));
      const results = linter.analyze(targetFlow);
      setIssues(results);
      setStatus('done');
    } catch (e) {
      console.error('[IssuesPanel] Lint failed', e);
      setIssues([]);
      setStatus('done');
    }
  }, [flow]);

  React.useEffect(() => {
    // auto-run once on mount
    runLint();
  }, [runLint]);

  return (
    <div className="h-full w-full flex flex-col">
      <div className="px-2 py-1 border-b bg-white/60 backdrop-blur flex items-center justify-between">
        <div className="text-[11px] text-gray-600">
          <span className="font-medium">Issues</span>
          <span className="mx-1 text-gray-300">|</span>
          <span>{issues.length} found</span>
          {status === 'running' && (
            <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Analyzing…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="h-6 px-2 text-[11px] rounded border bg-white hover:bg-gray-50"
            onClick={runLint}
            disabled={status === 'running'}
            title="Re-run linter"
          >
            Re-run
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {issues.length === 0 ? (
          <div className="p-3 text-[11px] text-gray-500">No issues found.</div>
        ) : (
          <ul className="divide-y">
            {issues.map((issue) => (
              <li key={issue.id} className="px-3 py-2 text-[11px]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          'inline-flex px-1.5 py-0.5 rounded border',
                          issue.kind === 'error'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : issue.kind === 'warning'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-gray-50 text-gray-700 border-gray-200',
                        ].join(' ')}
                      >
                        {issue.kind}
                      </span>
                      <span className="font-mono text-gray-500">{issue.rule}</span>
                      <span className="text-gray-300">|</span>
                      <span className="text-gray-700">{issue.message}</span>
                    </div>
                    <div className="mt-1 text-gray-400">
                      Target: {issue.target.type} {issue.target.id}
                    </div>
                  </div>
                  {issue.fix && (
                    <button
                      className="shrink-0 h-6 px-2 text-[11px] rounded border bg-white hover:bg-gray-50"
                      onClick={() => {
                        const f = issue.fix;
                        if (f) alert(`Quick fix: ${f.label} (placeholder)`);
                      }}
                      title={issue.fix ? issue.fix.label : 'Quick Fix'}
                    >
                      Quick Fix
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}