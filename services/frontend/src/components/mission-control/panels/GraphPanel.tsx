/**
 * Mission Control - Graph Panel (React Flow)
 *
 * Curl examples (align with backend docs):
 *   Create a run:
 *     curl -X POST "$GATEWAY/api/v1/runs" \
 *       -H "Content-Type: application/json" \
 *       -d '{"plan":{"nodes":[{"id":"A"},{"id":"B"}],"edges":[{"from":"A","to":"B"}]}}'
 *
 *   Get run details:
 *     curl "$GATEWAY/api/v1/runs/<run_id>"
 *
 *   Subscribe to SSE with replay:
 *     curl -N "$GATEWAY/api/v1/runs/<run_id>/events?replay=200"
 *
 *   Cancel a run:
 *     curl -X POST "$GATEWAY/api/v1/runs/<run_id>/cancel"
 */

import React from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  type Edge,
  type Node as RFNode,
} from 'reactflow';
import 'reactflow/dist/style.css';

import NodeCard, { type NodeCardData } from './graph/NodeCard';
import { useRunGraph, type RunStatus } from './graph/useRunGraph';
import Badge from '@/components/ui/Badge';
import { PanelShell } from '@/components/ui/PanelShell';

type Props = {
  runId: string | null;
  onSelectNode?: (nodeId: string | null) => void;
};

const nodeTypes = {
  nodeCard: NodeCard,
} as any;

const MiniMapAny = MiniMap as any;
const ControlsAny = Controls as any;
const BackgroundAny = Background as any;

function statusToBadge(status: RunStatus) {
  const v = String(status || '').toLowerCase();
  if (v.startsWith('run')) return <Badge variant="warning">Run: Running</Badge>;
  if (v.startsWith('succ') || v === 'completed') return <Badge variant="success">Run: Succeeded</Badge>;
  if (v.startsWith('fail') || v === 'failed' || v === 'error' || v === 'canceled') return <Badge variant="danger">Run: Failed</Badge>;
  if (v === 'queued' || v === 'pending') return <Badge variant="info">Run: Queued</Badge>;
  return <Badge>Run: {String(status)}</Badge>;
}

export default function GraphPanel({ runId, onSelectNode }: Props) {
  const {
    nodes,
    edges,
    runStatus,
    selectedNodeId,
    setSelectedNodeId,
    onCancelRun,
    fitViewNonce,
  } = useRunGraph(runId || null);

  const reactFlowRef = React.useRef<any>(null);

  const fitView = React.useCallback(() => {
    try {
      const inst = reactFlowRef.current;
      if (inst?.fitView) inst.fitView({ padding: 0.2, includeHiddenNodes: true });
    } catch {}
  }, []);

  React.useEffect(() => {
    // request fit view on first load and any subsequent nonce bumps
    fitView();
  }, [fitViewNonce]);

  // selection bridging
  const handleSelectionChange = React.useCallback(
    (sel: { nodes: RFNode<NodeCardData>[] }) => {
      const id = sel.nodes?.[0]?.id ?? null;
      setSelectedNodeId(id);
      try {
        onSelectNode?.(id);
      } catch {}
    },
    [onSelectNode, setSelectedNodeId]
  );

  const handleRetryFailed = React.useCallback(() => {
    // Placeholder hook to integrate later server-side retry API
    const failed = nodes.filter((n) => n.data?.status === 'failed').map((n) => n.id);
    console.log('[GraphPanel] Retry requested for failed nodes:', failed);
  }, [nodes]);

  return (
    <PanelShell
      title={<span className="uppercase tracking-wide text-gray-500">Graph</span>}
      toolbar={
        <div className="px-2 h-8 border-b bg-card/60 backdrop-blur flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-2">
            <span className="uppercase tracking-wide text-gray-500">Graph</span>
            <span className="text-gray-300">|</span>
            <span className="inline-flex items-center gap-2">
              {statusToBadge(runStatus)}
              {selectedNodeId && (
                <span className="text-gray-400">• Selected: {selectedNodeId}</span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="h-6 px-2 rounded border bg-background hover:bg-muted"
              onClick={fitView}
              title="Fit view"
            >
              ⤢ Fit
            </button>
            <button
              className="h-6 px-2 rounded border bg-background hover:bg-muted"
              onClick={handleRetryFailed}
              title="Retry failed nodes (placeholder)"
            >
              ↻ Retry Failed
            </button>
            <button
              className="h-6 px-2 rounded border bg-background hover:bg-muted text-red-600 border-red-200"
              onClick={onCancelRun}
              disabled={!runId}
              title={runId ? 'Cancel this run' : 'No run selected'}
            >
              ✖ Cancel Run
            </button>
          </div>
        </div>
      }
    >
      {/* Edge animation styles */}
      <style>{`
        .react-flow__edge-path {
          stroke: hsl(var(--muted-foreground));
        }
        .react-flow__edge.animated .react-flow__edge-path,
        .react-flow__edge.edge--active .react-flow__edge-path {
          stroke-dasharray: 6 6;
          animation: dashRun 1.05s linear infinite;
        }
        @keyframes dashRun {
          to { stroke-dashoffset: -24; }
        }
      `}</style>

      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactFlowProvider>
          <ReactFlow
            nodeTypes={nodeTypes}
            nodes={nodes}
            edges={edges as Edge[]}
            onSelectionChange={handleSelectionChange as any}
            onInit={(instance: any) => {
              reactFlowRef.current = instance;
              // initial fit at first mount handled by fitViewNonce effect as well
              try { fitView(); } catch {}
            }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            defaultEdgeOptions={{ animated: true }}
          >
            <BackgroundAny gap={16} color="hsl(var(--muted))" />
            <MiniMapAny pannable zoomable className="!bg-card/70" />
            <ControlsAny position="bottom-right" />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
    </PanelShell>
  );
}