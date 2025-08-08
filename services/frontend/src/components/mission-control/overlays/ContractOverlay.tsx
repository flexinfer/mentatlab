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

  const nodeById = React.useMemo(() => {
    const m = new Map<string, any>();
    nodes.forEach((n: any) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const issues = React.useMemo<Issue[]>(() => {
    const out: Issue[] = [];
    edges.forEach((e: any) => {
      const id = e.id ?? `e-${e.source}-${e.target}`;
      // Parse endpoints; FlowCanvas constructs sourceHandle/targetHandle for RF, but our graph edges are "node.handle"
      const sourceNode = nodeById.get(e.source);
      const targetNode = nodeById.get(e.target);

      // Prefer explicit RF handle ids; fall back to parsing if not present
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
  }, [edges, nodeById]);

  if (issues.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-auto absolute top-2 left-2 z-50 rounded-lg border bg-white/90 dark:bg-gray-900/80 backdrop-blur shadow-sm w-[320px] text-xs"
      style={{ maxHeight: 260, overflow: 'hidden' }}
    >
      <div className="h-8 border-b flex items-center justify-between px-2">
        <div className="font-medium">Contract Checks</div>
        <div
          className={[
            'px-1.5 py-0.5 rounded-full border',
            issues.some((i) => i.kind === 'error')
              ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-900/40'
              : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-900/40',
          ].join(' ')}
          title={`${issues.length} issues`}
        >
          {issues.length}
        </div>
      </div>
      <div className="max-h-[220px] overflow-auto">
        <ul className="divide-y">
          {issues.map((i) => (
            <li key={i.id} className="px-2 py-2">
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
                    <span className="text-gray-500">{i.edgeId}</span>
                  </div>
                  <div className="mt-1 text-gray-600 dark:text-gray-300">
                    {i.from} → {i.to}
                  </div>
                  <div className="mt-1 text-gray-500">{i.reason}</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}