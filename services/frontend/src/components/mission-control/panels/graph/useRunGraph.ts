import React from "react";
import { type Edge, type Node as RFNode, MarkerType } from "reactflow";
import { orchestratorService } from "@/services/api/orchestratorService";
import type {
  Run as ApiRun,
  PlanEdge as ApiPlanEdge,
} from "@/types/orchestrator";
import { streamRegistry } from "@/services/streaming/streamRegistry";
import {
  parseRunEvent,
  type NormalizedRunEvent,
} from "@/services/streaming/parse";
import type { NodeCardData, NodeStatus } from "./NodeCard";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | string;

export type UseRunGraphState = {
  nodes: RFNode<NodeCardData>[];
  edges: Edge[];
  runStatus: RunStatus;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  onCancelRun: () => Promise<void>;
  fitViewNonce: number;
};

type NodeRuntimeMeta = {
  attempts: number;
  lastExitCode: number | null;
  progress: number | null;
  status: NodeStatus;
  lastSeq: number; // idempotence for node-specific updates
};

function asNodeStatus(s: string | undefined | null): NodeStatus {
  const v = String(s || "").toLowerCase();
  if (v.startsWith("run") || v === "pending" || v === "queued" || v === "idle")
    return "queued";
  if (v.startsWith("succ") || v === "completed" || v === "ok")
    return "succeeded";
  if (v.startsWith("fail") || v.startsWith("err")) return "failed";
  if (v.startsWith("run")) return "running";
  // default queued
  return "queued";
}

function asRunStatus(s: string | undefined | null): RunStatus {
  const v = String(s || "").toLowerCase();
  if (!v) return "queued";
  if (["queued", "pending"].includes(v)) return "queued";
  if (v.startsWith("run")) return "running";
  if (v.startsWith("succ") || v === "completed") return "succeeded";
  if (
    v.startsWith("fail") ||
    v === "failed" ||
    v === "error" ||
    v === "canceled"
  )
    return "failed";
  return v;
}

/**
 * Map API plan edges (from,to) to RF edges with ids and animation flags.
 */
function mapPlanEdgesToRF(
  planEdges: ApiPlanEdge[] | undefined,
  nodeStatusMap: Map<string, NodeRuntimeMeta>
): Edge[] {
  const edges: Edge[] = [];
  if (!planEdges || !Array.isArray(planEdges)) return edges;
  for (const e of planEdges) {
    const id = `${e.from}->${e.to}`;
    const from = e.from;
    const to = e.to;
    const srcMeta = nodeStatusMap.get(from);
    const animated = srcMeta?.status === "running";
    edges.push({
      id,
      source: from,
      target: to,
      animated,
      className: animated ? "edge--active" : undefined,
      style: animated ? { strokeWidth: 1.5 } : { strokeWidth: 1.2 },
      label: e.label,
      markerEnd: { type: MarkerType.ArrowClosed },
    } as Edge);
  }
  return edges;
}

export function useRunGraph(
  runId: string | null | undefined
): UseRunGraphState {
  const [nodes, setNodes] = React.useState<RFNode<NodeCardData>[]>([]);
  const [edges, setEdges] = React.useState<Edge[]>([]);
  const [runStatus, setRunStatus] = React.useState<RunStatus>("queued");
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(
    null
  );
  const [fitViewNonce, setFitViewNonce] = React.useState<number>(0);

  // runtime maps
  const nodeMetaRef = React.useRef<Map<string, NodeRuntimeMeta>>(new Map());
  const lastAppliedSeqRef = React.useRef<number>(0);
  const sseCloseRef = React.useRef<null | (() => void)>(null);
  const planEdgesRef = React.useRef<ApiPlanEdge[] | undefined>(undefined);

  // Initialize from GET /runs/:id
  React.useEffect(() => {
    let mounted = true;

    async function init() {
      if (!runId) {
        setNodes([]);
        setEdges([]);
        setRunStatus("queued");
        return;
      }
      try {
        const run: ApiRun = await orchestratorService.getRun(runId);
        if (!mounted) return;

        const plan = run.plan || { nodes: [], edges: [] };
        planEdgesRef.current = plan.edges || [];

        // Seed per-node runtime meta from run.nodes if present
        const meta = new Map<string, NodeRuntimeMeta>();
        const rfNodes: RFNode<NodeCardData>[] = (plan.nodes || []).map((pn) => {
          const nodeId = pn.id;
          const rs = run.nodes?.[nodeId]?.status || "queued";
          const m: NodeRuntimeMeta = {
            attempts: 0,
            lastExitCode: null,
            progress: null,
            status: asNodeStatus(rs),
            lastSeq: 0,
          };
          meta.set(nodeId, m);
          return {
            id: nodeId,
            type: "nodeCard",
            position: {
              x: Math.random() * 300 - 150,
              y: Math.random() * 200 - 100,
            }, // simple scatter; layout can be improved later
            data: {
              id: nodeId,
              title: pn.label || pn.id,
              status: m.status,
              attempts: m.attempts,
              lastExitCode: m.lastExitCode,
              progress: m.progress,
            },
          } as RFNode<NodeCardData>;
        });

        nodeMetaRef.current = meta;

        // Build edges based on current node status
        const rfEdges = mapPlanEdgesToRF(
          planEdgesRef.current,
          nodeMetaRef.current
        );

        setNodes(rfNodes);
        setEdges(rfEdges);
        setRunStatus(asRunStatus(run.status));
        // trigger initial fit
        setFitViewNonce((n) => n + 1);
      } catch (e) {
        // If GET fails, leave empty and wait for SSE to populate
        if (!mounted) return;
        console.error("[useRunGraph] getRun failed", e);
        setNodes([]);
        setEdges([]);
        setRunStatus("queued");
      }
    }

    init();

    return () => {
      mounted = false;
    };
  }, [runId]);

  // SSE subscription
  React.useEffect(() => {
    // Cleanup previous
    if (sseCloseRef.current) {
      try {
        sseCloseRef.current();
      } catch {}
      sseCloseRef.current = null;
    }
    if (!runId) return;

    const handle = orchestratorService.streamRunEvents(runId, {
      replay: 200,
      onOpen: () => {
        // no-op
      },
      onRaw: (evt: any) => {
        const ev: NormalizedRunEvent = parseRunEvent(evt);
        // Global seq idempotence: ignore if older/equal than last applied
        if (ev.seq && ev.seq <= lastAppliedSeqRef.current) return;
        lastAppliedSeqRef.current = ev.seq;

        const typeLc = String(ev.type || "").toLowerCase();

        // Node status updates
        if (
          typeLc.includes("node_status") ||
          typeLc === "node" ||
          typeLc === "node-status"
        ) {
          const nxId =
            ev.nodeId || ev.data?.node_id || ev.data?.id || ev.data?.node;
          if (!nxId) return;
          const nx = nodeMetaRef.current.get(nxId) || {
            attempts: 0,
            lastExitCode: null,
            progress: null,
            status: "queued",
            lastSeq: 0,
          };
          if (ev.seq <= (nx.lastSeq || 0)) return; // per-node idempotence
          nx.lastSeq = ev.seq;
          nx.status = asNodeStatus(ev.data?.status || ev.data?.state);
          nx.attempts = Number(ev.data?.attempts ?? nx.attempts);
          nx.lastExitCode =
            typeof ev.data?.exit_code === "number"
              ? ev.data.exit_code
              : nx.lastExitCode;
          nodeMetaRef.current.set(nxId, nx);

          // Apply to RF nodes
          setNodes((prev) =>
            prev.map((n) =>
              n.id === nxId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: nx.status,
                      attempts: nx.attempts,
                      lastExitCode: nx.lastExitCode,
                    },
                  }
                : n
            )
          );
          // Recompute edges animation based on source running
          setEdges(mapPlanEdgesToRF(planEdgesRef.current, nodeMetaRef.current));
        }
        // Checkpoints -> optional progress
        else if (typeLc.includes("checkpoint")) {
          const nxId =
            ev.nodeId || ev.data?.node_id || ev.data?.id || ev.data?.node;
          if (!nxId) return;
          const p = Number(
            ev.data?.progress ?? ev.data?.pct ?? ev.data?.percent
          );
          if (!Number.isFinite(p)) return;
          const nx = nodeMetaRef.current.get(nxId) || {
            attempts: 0,
            lastExitCode: null,
            progress: null,
            status: "queued",
            lastSeq: 0,
          };
          if (ev.seq <= (nx.lastSeq || 0)) return;
          nx.lastSeq = ev.seq;
          nx.progress = Math.max(0, Math.min(100, p));
          nodeMetaRef.current.set(nxId, nx);
          setNodes((prev) =>
            prev.map((n) =>
              n.id === nxId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      progress: nx.progress,
                    },
                  }
                : n
            )
          );
        }
        // Run-level status
        else if (
          typeLc === "status" ||
          typeLc === "run_status" ||
          typeLc === "run-status"
        ) {
          const st = ev.data?.status || ev.data?.state || ev.data;
          setRunStatus(asRunStatus(st));
        }
        // Logs ignored here (console will consume)
      },
      onError: (err: any) => {
        // Keep silent; client will auto-reconnect
        console.warn("[useRunGraph] SSE error", err);
      },
    });

    sseCloseRef.current = () => {
      try {
        handle.close();
      } catch {}
    };

    return () => {
      if (sseCloseRef.current) {
        try {
          sseCloseRef.current();
        } catch {}
        sseCloseRef.current = null;
      }
    };
  }, [runId]);

  const onCancelRun = React.useCallback(async () => {
    if (!runId) return;
    try {
      await orchestratorService.cancelRun(runId);
      // optimistic: mark run as failed (canceled)
      setRunStatus("failed");
      // Stop any active live streams so the network/graph quiets immediately
      try {
        streamRegistry.stopAll();
      } catch {}
      // Also close our SSE subscription to stop further updates
      try {
        sseCloseRef.current?.();
      } catch {}
    } catch (e) {
      console.error("[useRunGraph] cancelRun failed", e);
    }
  }, [runId]);

  // Whenever statuses change to many running/success, refresh edge animations.
  // Note: primary recalculation happens inline after node_status, but this catches any drift.
  React.useEffect(() => {
    const t = window.setInterval(() => {
      setEdges(mapPlanEdgesToRF(planEdgesRef.current, nodeMetaRef.current));
    }, 1500);
    return () => window.clearInterval(t);
  }, []);

  // Expose a way for parent toolbar to request fitView (nonce)
  const requestFitView = React.useCallback(
    () => setFitViewNonce((n) => n + 1),
    []
  );

  // Return state; attach the fitView trigger as a nonce update the component can watch
  return {
    nodes,
    edges,
    runStatus,
    selectedNodeId,
    setSelectedNodeId,
    onCancelRun,
    fitViewNonce,
  };
}
