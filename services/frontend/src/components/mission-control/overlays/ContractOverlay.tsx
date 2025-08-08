import React from 'react';
import useStore from '../../../store';
import {
  isPinMediaType,
  isPinStreamType,
  type PinType,
} from '../../../types/graph';

/**
 * ContractOverlay
 * A lightweight, non-invasive overlay that evaluates type compatibility on edges
 * and surfaces potential contract issues without modifying the graph.
 *
 * MVP behavior:
 * - Parses "nodeId.handleId" endpoints
 * - Looks up source/target pin types from node.data.outputs / node.data.inputs
 * - Flags unknown pins and incompatible types
 * - Renders a compact floating panel listing issues
 */
type Issue = {
  id: string;
  edgeId: string;
  from: string;
  to: string;
  kind: 'error' | 'warning' | 'info';
  reason: string;
};

function parseEndpoint(endpoint: string): { nodeId: string; handleId?: string } {
  if (typeof endpoint !== 'string') return { nodeId: String(endpoint) };
  const [nodeId, handleId] = endpoint.split('.');
  return { nodeId, handleId };
}

function getPinTypeOnNode(
  node: any,
  handleId: string | undefined,
  isSource: boolean
): PinType | undefined {
  if (!node || !handleId) return undefined;
  const pins = isSource ? node.data?.outputs : node.data?.inputs;
  const pin = pins?.[handleId];
  return pin?.type as PinType | undefined;
}

function compatible(a?: PinType, b?: PinType): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  // Media compatibility (generic "media" accepts any media subtype)
  if (isPinMediaType(a) && isPinMediaType(b)) {
    return a === 'media' || b === 'media' || a === b;
  }
  // Streams: both must be stream types and nodes should support streaming (skipped here)
  if (isPinStreamType(a) && isPinStreamType(b)) {
    return true;
  }
  return false;
}

export default function ContractOverlay() {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);

  // Local dismissed set (ephemeral)
  const [dismissed, setDismissed] = React.useState<Set<string>>(() => new Set());
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0); // used when lint trigger events arrive

  // Optional: listen to global lint trigger events to force a recompute if needed
  React.useEffect(() => {
    const onLint = () => setTick((t) => t + 1);
    window.addEventListener('lint:trigger', onLint as EventListener);
    return () => window.removeEventListener('lint:trigger', onLint as EventListener);
  }, []);

  const nodeById = React.useMemo(() => {
    const m = new Map<string, any>();
    nodes.forEach((n: any) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const allIssues = React.useMemo<Issue[]>(() => {
    const out: Issue[] = [];
    edges.forEach((e: any) => {
      const id = e.id ?? `e-${e.source}-${e.target}`;
      const sourceNode = nodeById.get(e.source);
      const targetNode = nodeById.get(e.target);

      const fromType =
        getPinTypeOnNode(sourceNode, e.sourceHandle ?? parseEndpoint(e.source).handleId, true) ??
        undefined;
      const toType =
        getPinTypeOnNode(targetNode, e.targetHandle ?? parseEndpoint(e.target).handleId, false) ??
        undefined;

      if (!fromType || !toType) {
        out.push({
          id: `${id}-unknown`,
          edgeId: id,
          from: `${e.source}${e.sourceHandle ? '.' + e.sourceHandle : ''}`,
          to: `${e.target}${e.targetHandle ? '.' + e.targetHandle : ''}`,
          kind: 'warning',
          reason: 'Unknown pin type (source or target)',
        });
        return;
      }

      if (!compatible(fromType, toType)) {
        out.push({
          id: `${id}-incompatible`,
          edgeId: id,
          from: `${e.source}${e.sourceHandle ? '.' + e.sourceHandle : ''}`,
          to: `${e.target}${e.targetHandle ? '.' + e.targetHandle : ''}`,
          kind: 'error',
          reason: `Incompatible pin types: ${String(fromType)} → ${String(toType)}`,
        });
      }
    });
    return out;
  }, [edges, nodeById, tick]);

  // Filter dismissed and cap to 200 items for UI performance
  const visibleIssues = React.useMemo(() => {
    return allIssues.filter((i) => !dismissed.has(i.id)).slice(0, 200);
  }, [allIssues, dismissed]);

  // Toast helper
  const showToast = (msg: string, ms = 2000) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), ms);
  };

  // Import linter lazily to call applyQuickFix (stub)
  const onApplyFix = async (issue: Issue) => {
    try {
      // Dynamic import to avoid cyclic deps in some setups
      const mod = await import('../../../services/mission-control/services');
      const l = (mod as any).linter;
      // Call stub applier with a minimal flow object (MC1: no mutation)
      try {
        l?.applyQuickFix?.({} as any, { id: issue.id, kind: issue.kind as any, target: { type: 'edge', id: issue.edgeId }, rule: 'contract', message: issue.reason, fix: { id: 'stub', title: 'Apply suggested fix', action: 'stub' } } as any);
      } catch (e) {
        // ignore applier errors for MC1
        console.debug('[ContractOverlay] applyQuickFix failed', e);
      }
      showToast(`Applied '${(issue as any)?.fix?.title ?? 'suggested fix'}' (stub)`);
    } catch (e) {
      console.error('[ContractOverlay] failed to apply fix', e);
      showToast('Applied (stub)');
    }
  };

  const onDismiss = (id: string) => {
    setDismissed((prev) => {
      const n = new Set(prev);
      n.add(id);
      return n;
    });
  };

  if (visibleIssues.length === 0) return null;

  return (
    <div
      role="dialog"
      aria-label="Contract issues"
      className="pointer-events-auto absolute top-2 left-2 z-50 rounded-lg border bg-white/90 dark:bg-gray-900/80 backdrop-blur shadow-sm w-[320px] text-xs"
      style={{ maxHeight: 260, overflow: 'hidden' }}
    >
      {/* ephemeral toast/banner */}
      {toast && (
        <div data-testid="contract-overlay-toast" className="px-2 py-1 border-b text-[12px] text-emerald-700 bg-emerald-50">
          {toast}
        </div>
      )}

      <div className="h-8 border-b flex items-center justify-between px-2">
        <div className="font-medium">Contract Checks</div>
        <div
          className={[
            'px-1.5 py-0.5 rounded-full border',
            allIssues.some((i) => i.kind === 'error')
              ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-900/40'
              : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900/40',
          ].join(' ')}
          title={`${allIssues.length} issues`}
        >
          {allIssues.length}
        </div>
      </div>

      <div className="max-h-[220px] overflow-auto">
        <ul className="divide-y">
          {visibleIssues.map((i) => (
            <li
              key={i.id}
              className="px-2 py-2 relative"
              onMouseEnter={() => setHovered(i.id)}
              onMouseLeave={() => setHovered((h) => (h === i.id ? null : h))}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={[
                        'inline-flex px-1.5 py-0.5 rounded border',
                        i.kind === 'error'
                          ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-900/40'
                          : i.kind === 'warning'
                          ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900/40'
                          : 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/40 dark:text-gray-300 dark:border-gray-800',
                      ].join(' ')}
                    >
                      {i.kind}
                    </span>
                    <span className="text-gray-500 truncate">{i.edgeId}</span>
                  </div>
                  <div className="mt-1 text-gray-600 dark:text-gray-300 truncate">
                    {i.from} → {i.to}
                  </div>
                  <div className="mt-1 text-gray-500">{i.reason}</div>
                </div>

                {/* action area */}
                <div className="shrink-0 flex flex-col items-end">
                  {/* Quick-fix hint (show if available via linter shape) */}
                  <div className="mb-1">
                    {/* Render a small hint pill if a quick-fix is suggested */}
                    {/* We attempt to surface issue.fix.title if present (may be undefined for our computed issues) */}
                    <div className="text-[11px] text-gray-500">{(i as any).fix?.title ?? ''}</div>
                  </div>

                  <div className="flex gap-1">
                    <button
                      className="h-6 px-2 text-[11px] rounded border bg-white hover:bg-gray-50"
                      onClick={() => onApplyFix(i)}
                      title="Apply quick fix (stub)"
                    >
                      Apply fix
                    </button>
                    <button
                      className="h-6 px-2 text-[11px] rounded border bg-white hover:bg-gray-50"
                      onClick={() => onDismiss(i.id)}
                      title="Dismiss issue"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>

              {/* Hover tooltip/popover */}
              {hovered === i.id && (
                <div
                  role="dialog"
                  aria-modal="false"
                  tabIndex={0}
                  className="absolute right-0 top-0 z-60 w-[300px] rounded border bg-white p-3 shadow-md text-xs"
                  style={{ transform: 'translateX(100%)', marginLeft: 8 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setHovered(null);
                    }
                  }}
                >
                  <div className="font-medium mb-1">{i.reason ?? 'Contract mismatch'}</div>
                  <div className="text-gray-600 mb-2 text-[12px]">
                    Source: {i.from} <br />
                    Target: {i.to}
                  </div>
                  <div className="mb-2">
                    <div className="text-[12px] font-medium">Suggested fix</div>
                    <div className="text-gray-600">{(i as any).fix?.title ?? 'Try adapting types or open helper'}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm"
                      onClick={() => {
                        onApplyFix(i);
                        setHovered(null);
                      }}
                    >
                      Apply fix
                    </button>
                    <button
                      className="px-2 py-1 rounded bg-white border text-sm"
                      onClick={() => {
                        onDismiss(i.id);
                        setHovered(null);
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}