import React from 'react';
import type { Flow } from '../../../types/graph';
import { linter, type LintIssue } from '../../../services/mission-control/services';
import { useCanvasStore } from '@/stores';
import { useToast } from '../../../contexts/ToastContext';

type IssuesPanelProps = {
  onCountChange?: (count: number) => void;
};

export default function IssuesPanel({ onCountChange }: IssuesPanelProps) {
  const toast = useToast();

  // Get store state and actions for applying fixes
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const setNodes = useCanvasStore((s) => s.setNodes);
  const setEdges = useCanvasStore((s) => s.setEdges);

  // Build current flow from store state
  const currentFlow = React.useMemo((): Flow => {
    return {
      apiVersion: 'v1',
      kind: 'Flow',
      meta: { id: 'current', name: 'Current Flow', version: '0.0.0', createdAt: new Date().toISOString(), description: '' },
      graph: {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type ?? 'default',
          params: n.data ?? {},
          position: n.position,
        })),
        edges: edges.map((e) => ({
          from: e.source,
          to: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          targetHandle: e.targetHandle ?? undefined,
        })),
      },
    };
  }, [nodes, edges]);

  // Compute issues synchronously based on current flow
  const issues = React.useMemo(() => {
    try {
      return linter.analyze(currentFlow);
    } catch (e) {
      console.error('[IssuesPanel] Lint failed', e);
      return [];
    }
  }, [currentFlow]);

  // Notify parent only when the number of issues changes
  const issuesCount = issues.length;
  React.useEffect(() => {
    onCountChange?.(issuesCount);
  }, [issuesCount, onCountChange]);

  // Apply a quick fix to the flow and update the store
  const applyQuickFix = React.useCallback((issue: LintIssue) => {
    if (!issue.fix) return;

    if (!linter.canAutoApply(issue)) {
      toast.info(`${issue.fix.title} - open the relevant panel to apply`);
      return;
    }

    try {
      const updatedFlow = linter.applyQuickFix(currentFlow, issue);

      if (updatedFlow.graph) {
        const newNodes = updatedFlow.graph.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position ?? { x: 0, y: 0 },
          data: n.params ?? {},
        }));
        const newEdges = updatedFlow.graph.edges.map((e, idx) => ({
          id: `edge-${idx}`,
          source: e.from,
          target: e.to,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
        }));

        setNodes(newNodes);
        setEdges(newEdges);
      }

      toast.success(`Applied: ${issue.fix.title}`);
    } catch (e) {
      console.error('[IssuesPanel] Failed to apply quick fix', e);
      toast.error('Failed to apply fix');
    }
  }, [currentFlow, setNodes, setEdges, toast]);

  return (
    <div className="h-full w-full flex flex-col">
      <div className="px-2 py-1 border-b bg-card/60 backdrop-blur flex items-center justify-between">
        <div className="text-[11px] text-gray-600 dark:text-gray-300">
          <span className="font-medium">Issues</span>
          <span className="mx-1 text-gray-300">|</span>
          <span>{issues.length} found</span>
        </div>
        {/* Re-run button is purely decorative now since it computes on the fly, but we can keep it for UX consistency if desired */}
        <div className="flex items-center gap-2">
          <button
            className="h-6 px-2 text-[11px] rounded border bg-background hover:bg-muted dark:bg-card dark:hover:bg-muted/80 opacity-50 cursor-not-allowed"
            disabled
            title="Analysis is continuous"
          >
            Live Analysis
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
                            ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
                            : issue.kind === 'warning'
                              ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                              : 'bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-700',
                        ].join(' ')}
                      >
                        {issue.kind}
                      </span>
                      <span className="font-mono text-gray-500">{issue.rule}</span>
                      <span className="text-gray-300">|</span>
                      <span className="text-gray-700 dark:text-gray-300">{issue.message}</span>
                    </div>
                    <div className="mt-1 text-gray-400">
                      Target: {issue.target.type} {issue.target.id}
                    </div>
                  </div>
                  {issue.fix && (
                    <button
                      className="shrink-0 h-6 px-2 text-[11px] rounded border bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                      onClick={() => applyQuickFix(issue)}
                      title={issue.fix.title}
                    >
                      {linter.canAutoApply(issue) ? 'Apply Fix' : 'Quick Fix'}
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
