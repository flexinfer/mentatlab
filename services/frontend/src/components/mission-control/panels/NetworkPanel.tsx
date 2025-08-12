import React from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { ReactFlowProvider } from 'reactflow';

import { useStreamingStore } from '../../../store/index';
import { StreamConnectionState } from '../../../types/streaming';
import { flightRecorder } from '../../../services/mission-control/services';
import { FeatureFlags } from '../../../config/features';
import { getOrchestratorBaseUrl } from '@/config/orchestrator';
import CanvasUnderlay, { PixiUnderlayHandle } from './network/CanvasUnderlay';

// Cast RF externals to any to avoid strict prop incompatibilities (mirrors FlowCanvas pattern)
const MiniMapAny = MiniMap as any;
const ControlsAny = Controls as any;
const BackgroundAny = Background as any;

type Props = {
  runId: string | null;
};

type AgentNodeData = {
  id: string;
  label: string;
  status?: 'idle' | 'active';
  execs?: number;
  lastToolTokens?: number | null;
  lastToolAt?: number | null;
  lastActiveAt?: number | null;
};

// Custom Agent Node renderer for badges and glow
function AgentNode({ data, selected }: { data: AgentNodeData; selected?: boolean }) {
  const isHot = !!data.lastActiveAt && Date.now() - (data.lastActiveAt || 0) <= 600;
  const toolBadgeVisible = !!data.lastToolAt && Date.now() - (data.lastToolAt || 0) <= 3000;
  return (
    <div
      className={[
        'px-2 py-1 rounded-md border text-[11px] shadow-sm relative transition-transform',
        'bg-card/90 dark:bg-slate-900/70 border-slate-200 dark:border-slate-800 text-foreground',
        isHot ? 'ring-2 ring-indigo-400/70 scale-[1.02]' : 'ring-0',
        selected ? 'outline outline-1 outline-indigo-400' : '',
      ].join(' ')}
      style={{ minWidth: 120 }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{data.label}</span>
        {toolBadgeVisible && (
          <span
            className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full border text-[10px]
                       bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-900/50"
            title="Last tool call tokens"
          >
            {data.lastToolTokens ?? 0}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">execs: {data.execs ?? 0}</div>

      {/* Handles (placeholder dots for symmetry/future connections) */}
      <div
        className="absolute -left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-slate-400/30"
        data-handle="target"
        aria-hidden
      />
      <div
        className="absolute -right-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-slate-400/30"
        data-handle="source"
        aria-hidden
      />
    </div>
  );
}

const nodeTypes = { agent: AgentNode } as any; // relax typing like FlowCanvas

// Add a concrete RF node alias for clarity
type RFNode = Node<AgentNodeData>;

// Utility: normalize an agent/name to an id
const norm = (s: string) => String(s || '').trim();
// base node id from "node.pin"
const baseOf = (s: string) => {
  const t = String(s || '').trim();
  const dot = t.indexOf('.');
  return dot >= 0 ? t.slice(0, dot) : t;
};

// simple circular layout
function layoutCircular(ids: string[], center = { x: 0, y: 0 }, radius = 200) {
  const n = Math.max(ids.length, 1);
  return ids.map((id, i) => {
    const theta = (i / n) * Math.PI * 2;
    return { id, x: center.x + radius * Math.cos(theta), y: center.y + radius * Math.sin(theta) };
  });
}

function useThroughputMeter(windowMs = 5000) {
  const bucket = React.useRef<number[]>([]);
  const mark = React.useCallback(() => {
    const now = Date.now();
    bucket.current.push(now);
    const min = now - windowMs;
    while (bucket.current.length && bucket.current[0] < min) bucket.current.shift();
  }, [windowMs]);

  const perSec = React.useMemo(() => {
    const now = Date.now();
    const min = now - windowMs;
    const recent = bucket.current.filter((t) => t >= min).length;
    return Math.round(recent / (windowMs / 1000));
  }, [windowMs, bucket.current.length]);

  return { mark, perSec, getCount: () => bucket.current.length };
}

export default function NetworkPanel({ runId }: Props) {
  // Streaming connection status
  const connectionStatus = useStreamingStore((s) => s.connectionStatus);
  const cs = String(connectionStatus);
  const liveDisabled = cs === 'connecting' || cs === 'reconnecting' || cs === 'connected';

  // Nodes/Edges state (generic is the data type, not Node<>)
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNodeData>([] as RFNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const underlayRef = React.useRef<PixiUnderlayHandle | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = React.useState<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const [canvasSize, setCanvasSize] = React.useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Lookup maps
  const nameToIdRef = React.useRef<Map<string, string>>(new Map());

  // Mini metrics
  const [activeNodes, setActiveNodes] = React.useState(0);
  const { mark: markMsg, perSec } = useThroughputMeter(5000);

  // Status message — use normalized string
  const statusBadge = React.useMemo(() => {
    switch (cs) {
      case 'disconnected':
        return { color: 'bg-gray-400', text: 'Disconnected' };
      case 'connecting':
        return { color: 'bg-amber-500', text: 'Connecting' };
      case 'connected':
        return { color: 'bg-emerald-500', text: 'Connected' };
      case 'reconnecting':
        return { color: 'bg-blue-500', text: 'Reconnecting' };
      case 'error':
        return { color: 'bg-red-500', text: 'Error' };
      default:
        return { color: 'bg-gray-400', text: String(connectionStatus) };
    }
  }, [cs, connectionStatus]);

  // Fetch agents once on mount (resilient)
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [loadedFrom, setLoadedFrom] = React.useState<'api' | 'fallback' | null>(null);

  React.useEffect(() => {
    let mounted = true;
    const endpoint = '/api/v1/agents';

    const parseAgents = (rawText: string): any[] | null => {
      try {
        const parsed = JSON.parse(rawText);
        return Array.isArray(parsed)
          ? parsed
          : parsed && Array.isArray(parsed.agents)
          ? parsed.agents
          : null;
      } catch {
        return null;
      }
    };

    const toGraph = (agents: any[]): { nodes: RFNode[]; edges: Edge[] } => {
      const ids: string[] = [];
      const map = new Map<string, string>(); // name -> id
      const unique = new Set<string>();

      // collect nodes
      for (const a of agents) {
        const id = norm(a?.id || a?.name);
        if (!id || unique.has(id)) continue;
        unique.add(id);
        ids.push(id);
        map.set(norm(a?.name || a?.id || id), id);
      }

      // If too few agents, merge in canonical subconscious nodes to "make the point"
      const origCount = ids.length;
      const canonical = ['Ego', 'Perception', 'Memory', 'Planning', 'Actuator'];
      if (ids.length < 3) {
        for (const cid of canonical) {
          if (!unique.has(cid)) {
            unique.add(cid);
            ids.push(cid);
            map.set(cid, cid);
          }
        }
      }
      if (ids.length === 0) return { nodes: [], edges: [] };

      const pts = layoutCircular(ids, { x: 0, y: 0 }, 220);
      const nn: RFNode[] = pts.map((p) => ({
        id: p.id,
        type: 'agent',
        position: { x: p.x, y: p.y },
        data: {
          id: p.id,
          label: p.id,
          execs: 0,
          lastToolTokens: null,
          lastToolAt: null,
          lastActiveAt: null,
          status: 'idle',
        },
      }));

      const ee: Edge[] = [];
      for (const a of agents) {
        const srcId = norm(a?.id || a?.name);
        if (!srcId) continue;
        const outputs = a?.outputs && typeof a.outputs === 'object' ? Object.keys(a.outputs) : [];
        for (const out of outputs) {
          for (const b of agents) {
            if (b === a) continue;
            const tgtId = norm(b?.id || b?.name);
            const inputs = b?.inputs && typeof b.inputs === 'object' ? Object.keys(b.inputs) : [];
            if (inputs.includes(out)) {
              const eid = `${srcId}->${tgtId}`;
              if (!ee.find((e) => e.id === eid)) {
                ee.push({
                  id: eid,
                  source: srcId,
                  target: tgtId,
                  animated: true,
                  markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--muted-foreground))' },
                  style: { strokeWidth: 1.5 },
                });
              }
            }
          }
        }
      }
      // If we augmented with canonical nodes (origCount < 3), add default subconscious edges
      if (origCount < 3) {
        const ensureEdge = (s: string, t: string) => {
          const id = `${s}->${t}`;
          if (!ee.find((e) => e.id === id)) {
            ee.push({
              id,
              source: s,
              target: t,
              animated: true,
              markerEnd: { type: MarkerType.ArrowClosed, color: 'hsl(var(--muted-foreground))' },
              style: { strokeWidth: 1.5 },
            });
          }
        };
        ensureEdge('Perception', 'Ego');
        ensureEdge('Ego', 'Planning');
        ensureEdge('Planning', 'Memory');
        ensureEdge('Planning', 'Actuator');
      }

      nameToIdRef.current = map;
      return { nodes: nn, edges: ee };
    };

    const makeFallbackGraph = (): { nodes: RFNode[]; edges: Edge[] } => {
      const ids = ['Ego', 'Perception', 'Memory', 'Planning', 'Actuator'];
      const pts = layoutCircular(ids, { x: 0, y: 0 }, 240);
      const nn: RFNode[] = pts.map((p) => ({
        id: p.id,
        type: 'agent',
        position: { x: p.x, y: p.y },
        data: {
          id: p.id,
          label: p.id,
          execs: 0,
          lastToolTokens: null,
          lastToolAt: null,
          lastActiveAt: null,
          status: 'idle',
        },
      }));
      const ee: Edge[] = [
        { id: 'Perception->Ego', source: 'Perception', target: 'Ego', animated: true, markerEnd: { type: MarkerType.ArrowClosed } },
        { id: 'Ego->Planning', source: 'Ego', target: 'Planning', animated: true, markerEnd: { type: MarkerType.ArrowClosed } },
        { id: 'Planning->Memory', source: 'Planning', target: 'Memory', animated: true, markerEnd: { type: MarkerType.ArrowClosed } },
        { id: 'Planning->Actuator', source: 'Planning', target: 'Actuator', animated: true, markerEnd: { type: MarkerType.ArrowClosed } },
      ];
      const map = new Map<string, string>();
      ids.forEach((id) => map.set(id, id));
      nameToIdRef.current = map;
      return { nodes: nn, edges: ee };
    };

    (async () => {
      try {
        // 1) Try same-origin (proxied) endpoint
        const trySameOrigin = async () => {
          let res = await fetch(endpoint, { credentials: 'same-origin' });
          let raw = await res.text().catch(() => '');
          return { res, raw };
        };
        // 2) Try orchestrator base URL directly
        const tryBackend = async () => {
          const base = getOrchestratorBaseUrl().replace(/\/+$/, '');
          let res = await fetch(`${base}${endpoint}`, { credentials: 'same-origin' });
          let raw = await res.text().catch(() => '');
          return { res, raw };
        };

        let { res, raw } = await trySameOrigin();
        // If server returned HTML or non-200, fallback to backend base URL
        if (!res.ok || (raw || '').trim().startsWith('<')) {
          ({ res, raw } = await tryBackend());
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
        }
        const arr = parseAgents(raw);
        if (arr && arr.length) {
          const { nodes: nn, edges: ee } = toGraph(arr);
          if (mounted) {
            setNodes(nn);
            setEdges(ee);
            setLoadedFrom(res.url.includes('http') ? 'api' : 'api');
          }
          return;
        }
        // No agents -> fallback graph
        const fb = makeFallbackGraph();
        if (mounted) {
          setNodes(fb.nodes);
          setEdges(fb.edges);
          setLoadedFrom('fallback');
        }
      } catch (err) {
        console.error('[NetworkPanel] agents fetch failed', err);
        const fb = makeFallbackGraph();
        if (mounted) {
          setNodes(fb.nodes);
          setEdges(fb.edges);
          setFetchError('Failed to load agents; using fallback graph');
          setLoadedFrom('fallback');
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [setNodes, setEdges]);

  // Subscribe to checkpoints for the provided runId; also follow newest run when runId is null
  const subsRef = React.useRef<Array<() => void>>([]);
  React.useEffect(() => {
    // cleanup any prior subscriptions
    subsRef.current.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
    subsRef.current = [];

    const attach = (rid: string) => {
      try {
        const unsub = flightRecorder.subscribe(rid, (c) => {
          const lbl = String(c?.label ?? '');
          // node:exec
          if (lbl === 'node:exec') {
            const nodeName = norm((c.data as any)?.node || (c.data as any)?.id || '');
            if (!nodeName) return;
            const id = nameToIdRef.current.get(nodeName) || nameToIdRef.current.get(baseOf(nodeName)) || nodeName;

            // FIX: update node data with proper typing
            setNodes((prev) =>
              prev.map((n) =>
                n.id === id
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        execs: (n.data?.execs ?? 0) + 1,
                        lastActiveAt: Date.now(),
                        status: 'active',
                      },
                    }
                  : n
              )
            );

            // recompute active count based on recent activity (handled by interval below too)
            setActiveNodes((_) => {
              const now = Date.now();
              const count = nodes.reduce((acc, n) => {
                const la = n.data?.lastActiveAt;
                return acc + (la && now - la <= 1500 ? 1 : 0);
              }, 0);
              return count;
            });

            // clear 'active' style soon
            window.setTimeout(() => {
              setNodes((prev) =>
                prev.map((n) =>
                  n.id === id
                    ? { ...n, data: { ...n.data, status: 'idle' } }
                    : n
                )
              );
            }, 600);
            try { underlayRef.current?.pulseNode(id); } catch {}
          }
          // edge:transmit
          else if (lbl === 'edge:transmit') {
            const fromRaw = baseOf((c.data as any)?.from || '');
            const toRaw = baseOf((c.data as any)?.to || '');
            if (!fromRaw || !toRaw) return;
            const from = nameToIdRef.current.get(fromRaw) || fromRaw;
            const to = nameToIdRef.current.get(toRaw) || toRaw;
            const size = Number((c.data as any)?.size ?? 0);

            // ensure nodes exist even if not present yet
            setNodes((prev) => {
              const haveFrom = prev.find((n) => n.id === from);
              const haveTo = prev.find((n) => n.id === to);
              const add: RFNode[] = [];
              if (!haveFrom) {
                add.push({
                  id: from,
                  type: 'agent',
                  position: { x: Math.random() * 200 - 100, y: Math.random() * 200 - 100 },
                  data: { id: from, label: from, execs: 0, lastToolTokens: null, lastToolAt: null, lastActiveAt: null, status: 'idle' },
                });
              }
              if (!haveTo) {
                add.push({
                  id: to,
                  type: 'agent',
                  position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
                  data: { id: to, label: to, execs: 0, lastToolTokens: null, lastToolAt: null, lastActiveAt: null, status: 'idle' },
                });
              }
              return add.length ? (prev as RFNode[]).concat(add) : prev;
            });

            setEdges((prev) => {
              const id = `${from}->${to}`;
              const e = prev.find((x) => x.id === id);
              const width = Math.min(1.5 + (isFinite(size) ? size / 1024 : 0), 4);
              if (e) {
                return prev.map((x) => (x.id === id ? { ...x, animated: true, style: { ...(x.style || {}), strokeWidth: width } } : x));
              } else {
                return prev.concat([
                  {
                    id,
                    source: from,
                    target: to,
                    animated: true,
                    markerEnd: { type: MarkerType.ArrowClosed },
                    style: { strokeWidth: width },
                  },
                ]);
              }
            });

            // mark throughput
            markMsg();
            try { underlayRef.current?.emitTransmit(from, to, size); } catch {}
          }
          // tool:call
          else if (lbl === 'tool:call') {
            const nodeName = baseOf((c.data as any)?.node || '');
            if (!nodeName) return;
            const id = nameToIdRef.current.get(nodeName) || nodeName;
            const tokens = Number((c.data as any)?.tokens ?? 0);
            setNodes((prev) =>
              prev.map((n) =>
                n.id === id
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        lastToolTokens: tokens,
                        lastToolAt: Date.now(),
                      },
                    }
                  : n
              )
            );
          }
        });
        subsRef.current.push(unsub);
      } catch {
        // ignore
      }
    };

    if (runId) {
      attach(runId);
    } else {
      // follow newest run (poll for now)
      const t = window.setInterval(() => {
        try {
          const runs = flightRecorder.listRuns();
          if (!runs.length) return;
          const newest = runs[0]?.runId;
          if (!newest) return;
          if (!subsRef.current.length) {
            attach(newest);
          }
        } catch {
          // ignore
        }
      }, 1000);
      subsRef.current.push(() => window.clearInterval(t));
    }

    return () => {
      subsRef.current.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
      subsRef.current = [];
    };
  }, [runId, setNodes, setEdges, markMsg, nodes]);

  // Recompute active nodes metric periodically
  React.useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();
      setActiveNodes(
        nodes.reduce((acc, n) => {
          const la = n.data?.lastActiveAt;
          return acc + (la && now - la <= 1500 ? 1 : 0);
        }, 0)
      );
    }, 500);
    return () => window.clearInterval(t);
  }, [nodes]);

  const onConnect = React.useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, eds)),
    [setEdges]
  );

  const connectLive = React.useCallback(async () => {
    try {
      // Mirrors MissionControlLayout dynamic import convention
      const mod = await import('../../../services/api/streamingService');
      await (mod as any).default.connect();
    } catch (e) {
      console.error('[NetworkPanel] Live connect failed', e);
    }
  }, []);

  const empty = nodes.length === 0;

  // Auto-attempt live connection on mount (will fall back to simulation if WS/SSE unavailable)
  React.useEffect(() => {
    (async () => {
      try { await connectLive(); } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      setCanvasSize({ width: w, height: h });
      try { underlayRef.current?.setSize(w, h); } catch {}
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    try { underlayRef.current?.setViewport(viewport); } catch {}
  }, [viewport.x, viewport.y, viewport.zoom]);

  const onMove = React.useCallback((_: any, vp: { x: number; y: number; zoom: number }) => {
    setViewport(vp);
    try { underlayRef.current?.setViewport(vp); } catch {}
  }, []);

  const underlayNodes = React.useMemo(() => nodes.map(n => ({ id: n.id, position: n.position })), [nodes]);

  return (
    <div className="h-full w-full flex flex-col">
      {/* Inline CSS for subtle edge pulse */}
      <style>{`
        .react-flow__edge-path {
          stroke: hsl(var(--muted-foreground));
        }
        .react-flow__edge.animated .react-flow__edge-path {
          stroke-dasharray: 6 6;
          animation: dashOffset 1.1s linear infinite;
        }
        @keyframes dashOffset {
          to { stroke-dashoffset: -24; }
        }
      `}</style>

      <div className="px-2 h-8 border-b bg-card/60 backdrop-blur flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">
          <span className="uppercase tracking-wide text-gray-500">Network</span>
          <span className="text-gray-300">|</span>
          <span className="text-gray-600 dark:text-gray-300">
            Active Nodes: <strong>{activeNodes}</strong>
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-gray-600 dark:text-gray-300">
            Msgs/s: <strong>{perSec}</strong>
          </span>
          <span className="text-gray-300">|</span>
          <span className="inline-flex items-center gap-1">
            <span className={['w-1.5 h-1.5 rounded-full', statusBadge.color].join(' ')} /> {statusBadge.text}
          </span>
          {loadedFrom && (
            <span className="ml-2 text-gray-400">• {loadedFrom === 'api' ? 'Agents API' : 'Fallback graph'}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {cs !== 'connected' && FeatureFlags.CONNECT_WS && (
            <button
              className="h-6 px-2 rounded border bg-background hover:bg-muted text-[11px] disabled:opacity-60"
              onClick={connectLive}
              disabled={liveDisabled}
              title={liveDisabled ? 'Already connected/connecting' : 'Connect live stream'}
            >
              {cs === 'connecting' || cs === 'reconnecting' ? '🔄 Connecting…' : '🔌 Connect Live'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 relative">
        {/* Underlay is always mounted so the background renders immediately */}
        <div ref={containerRef} className="absolute inset-0">
          <CanvasUnderlay
            ref={underlayRef}
            className="absolute inset-0 pointer-events-none"
            nodes={underlayNodes as any}
            viewport={viewport}
            width={canvasSize.width}
            height={canvasSize.height}
            throughput={perSec}
          />
        </div>

        {/* ReactFlow graph on top */}
        <ReactFlowProvider>
          <ReactFlow
            nodeTypes={nodeTypes}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            // Initialize underlay viewport on first mount
            onInit={(instance: any) => {
              try {
                const vp = instance?.getViewport?.() || { x: 0, y: 0, zoom: 1 };
                setViewport(vp);
                underlayRef.current?.setViewport(vp);
              } catch {}
            }}
            // keep underlay in sync with pan/zoom
            onMove={onMove}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            defaultEdgeOptions={{ animated: true, markerEnd: { type: MarkerType.ArrowClosed } }}
          >
            <BackgroundAny gap={16} color="hsl(var(--muted))" />
            <MiniMapAny pannable zoomable className="!bg-card/70" />
            <ControlsAny position="bottom-right" />
          </ReactFlow>
        </ReactFlowProvider>

        {/* Empty overlay messaging (does not remove the underlay/graph) */}
        {empty && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-500 p-3 text-center pointer-events-none">
            <div className="pointer-events-auto">
              {fetchError ? (
                <div>
                  <div className="mb-1">Failed to load agents:</div>
                  <pre className="text-[10px] bg-muted/50 dark:bg-muted/20 border rounded p-2 max-w-[520px] max-h-32 overflow-auto">
                    {String(fetchError).slice(0, 200)}
                  </pre>
                  <div className="mt-2">
                    <button
                      className="h-6 px-2 rounded border bg-background hover:bg-muted text-[11px]"
                      onClick={() => window.location.reload()}
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ) : (
                <div>Connecting… if no backend is available, a local simulation will start automatically.</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}