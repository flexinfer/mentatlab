import React from "react";
import { type Edge, type Node as RFNode, MarkerType } from "reactflow";
import { orchestratorService } from "@/services/api/orchestratorService";
import type {
  Run as ApiRun,
  PlanEdge as ApiPlanEdge,
  PlanNode as ApiPlanNode,
} from "@/types/orchestrator";
import { streamRegistry } from "@/services/streaming/streamRegistry";
import {
  parseRunEvent,
  type NormalizedRunEvent,
} from "@/services/streaming/parse";
import type { NodeCardData, NodeStatus } from "./NodeCard";
import type { ConditionalNodeData } from "@/nodes/ConditionalNode";
import type { ForEachNodeData } from "@/nodes/ForEachNode";

/**
 * RunStatus for graph display - matches backend canonical values.
 * Use asRunStatus() to normalize any incoming status string.
 */
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

// Union type for all node data types in the graph
export type AnyNodeData = NodeCardData | ConditionalNodeData | ForEachNodeData;

export type UseRunGraphState = {
  nodes: RFNode<AnyNodeData>[];
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

/**
 * Normalize any status string to canonical RunStatus values.
 * Handles legacy values and common variants from backend/API transitions.
 *
 * Mappings:
 *   - "pending", "queued", empty → "queued"
 *   - "running", "run*" → "running"
 *   - "succeeded", "completed", "success", "ok", "succ*" → "succeeded"
 *   - "failed", "error", "fail*" → "failed"
 *   - "cancelled", "canceled" → "cancelled"
 */
function asRunStatus(s: string | undefined | null): RunStatus {
  const v = String(s || "").toLowerCase();
  if (!v) return "queued";
  if (["queued", "pending"].includes(v)) return "queued";
  if (v.startsWith("run")) return "running";
  if (v.startsWith("succ") || v === "completed" || v === "ok") return "succeeded";
  if (v === "cancelled" || v === "canceled") return "cancelled";
  if (v.startsWith("fail") || v === "error") return "failed";
  // Fallback: return as-is if unrecognized (TypeScript will flag if not in union)
  return "queued";
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
  const [nodes, setNodes] = React.useState<RFNode<AnyNodeData>[]>([]);
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
        const rfNodes: RFNode<any>[] = (plan.nodes || []).map((pn: ApiPlanNode) => {
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

          // Determine node type based on control flow config
          const basePosition = {
            x: Math.random() * 300 - 150,
            y: Math.random() * 200 - 100,
          };

          // Conditional node (if/switch branching)
          if (pn.conditional) {
            return {
              id: nodeId,
              type: "conditional",
              position: basePosition,
              data: {
                id: nodeId,
                label: pn.label || pn.id,
                type: pn.conditional.type || "if",
                expression: pn.conditional.expression || "",
                branches: pn.conditional.branches || {},
                default: pn.conditional.default,
                status: m.status,
              } as ConditionalNodeData,
            } as RFNode<ConditionalNodeData>;
          }

          // For-each loop node
          if (pn.for_each) {
            return {
              id: nodeId,
              type: "forEach",
              position: basePosition,
              data: {
                id: nodeId,
                label: pn.label || pn.id,
                collection: pn.for_each.collection || "",
                itemVar: pn.for_each.item_var || "item",
                indexVar: pn.for_each.index_var,
                maxParallel: pn.for_each.max_parallel || 1,
                body: pn.for_each.body || [],
                status: m.status,
              } as ForEachNodeData,
            } as RFNode<ForEachNodeData>;
          }

          // Standard agent/task node
          return {
            id: nodeId,
            type: "nodeCard",
            position: basePosition,
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
        // Control flow: condition evaluated
        else if (typeLc === "condition_evaluated") {
          const nxId =
            ev.nodeId || ev.data?.node_id || ev.data?.id || ev.data?.node;
          if (!nxId) return;
          const selectedBranch = ev.data?.selected_branch || ev.data?.branch;
          setNodes((prev) =>
            prev.map((n) =>
              n.id === nxId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      selectedBranch,
                      status: "succeeded",
                    },
                  }
                : n
            )
          );
        }
        // Control flow: branch skipped
        else if (typeLc === "branch_skipped") {
          const nxId =
            ev.nodeId || ev.data?.node_id || ev.data?.id || ev.data?.node;
          if (!nxId) return;
          // Mark the node as skipped
          setNodes((prev) =>
            prev.map((n) =>
              n.id === nxId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "skipped",
                    },
                  }
                : n
            )
          );
        }
        // Control flow: loop started
        else if (typeLc === "loop_started") {
          const nxId =
            ev.nodeId || ev.data?.node_id || ev.data?.id || ev.data?.node;
          if (!nxId) return;
          const itemCount = ev.data?.item_count;
          setNodes((prev) =>
            prev.map((n) =>
              n.id === nxId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "running",
                      totalIterations: itemCount,
                      currentIteration: 0,
                    },
                  }
                : n
            )
          );
        }
        // Control flow: loop iteration
        else if (typeLc === "loop_iteration") {
          const nxId =
            ev.nodeId || ev.data?.node_id || ev.data?.id || ev.data?.node;
          if (!nxId) return;
          const index = ev.data?.index;
          const total = ev.data?.total;
          setNodes((prev) =>
            prev.map((n) => {
              if (n.id !== nxId || n.type !== "forEach") return n;
              const forEachData = n.data as ForEachNodeData;
              return {
                ...n,
                data: {
                  ...forEachData,
                  currentIteration: typeof index === "number" ? index + 1 : forEachData.currentIteration,
                  totalIterations: total ?? forEachData.totalIterations,
                },
              };
            })
          );
        }
        // Control flow: loop complete
        else if (typeLc === "loop_complete") {
          const nxId =
            ev.nodeId || ev.data?.node_id || ev.data?.id || ev.data?.node;
          if (!nxId) return;
          const hasError = ev.data?.error;
          setNodes((prev) =>
            prev.map((n) =>
              n.id === nxId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: hasError ? "failed" : "succeeded",
                    },
                  }
                : n
            )
          );
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
