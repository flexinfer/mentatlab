/**
 * Mission Control service stubs (MVP scaffolding)
 * - FlightRecorderService: capture timeline checkpoints per run
 * - LineageService: compute/track provenance graphs for pins/artifacts
 * - VariantService: A/B & canary variant routing helpers
 * - PolicyService: safety/compliance checks on edges (ingress/egress)
 * - FlowLinterService: static analysis with quick-fix suggestions
 * - ReportService: post-run narrative summaries (engineer/executive)
 * - CostSimulator: preflight cost/latency estimations
 *
 * These are framework-agnostic and UI-agnostic; wire to Zustand/TanStack Query later.
 */

import type { Flow } from '../../types/graph';
import type { MediaReference } from '../../types/media';

//
// Types
//

export type RunId = string;
export type CheckpointId = string;

export interface RecorderCheckpoint {
  id: CheckpointId;
  runId: RunId;
  /** UTC timestamp (ISO-8601) */
  at: string;
  /** Phase or label, e.g. "tool:call", "node:exec", "edge:transmit" */
  label: string;
  /** Arbitrary structured payload (small; large blobs should be references) */
  data?: Record<string, unknown>;
  /** Optional media references captured at this point */
  media?: MediaReference[];
}

// Lightweight console entry shape used by appendConsole
export type RecorderConsoleEntry = {
  level?: 'info' | 'warn' | 'error' | 'debug';
  message?: string;
} & Record<string, unknown>;

export interface RecorderRunSummary {
  runId: RunId;
  flowId?: string;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'canceled';
  /** Derived metrics for quick glance */
  metrics?: {
    durationMs?: number;
    avgStepTimeMs?: number;
    errorCount?: number;
  };
}

export interface LineageEdge {
  from: string; // node.pin
  to: string;   // node.pin
  /** content hash or unique reference id for provenance */
  artifactId?: string;
  /** timing and size metadata for provenance */
  meta?: {
    bytes?: number;
    createdAt?: string;
  };
}

export interface LintIssue {
  id: string;
  kind: 'error' | 'warning' | 'info';
  /** node id or edge id reference */
  target: { type: 'node' | 'edge'; id: string };
  /** rule identifier */
  rule: string;
  /** human-readable detail */
  message: string;
  /** optional quick-fix descriptor (MC1) */
  fix?: {
    id: string;
    title: string;
    preview?: string;
    action: string;
    params?: Record<string, unknown>;
  };
}

export interface ReportParams {
  mode: 'engineer' | 'executive';
  includeArtifacts?: boolean;
}

export interface ReportResult {
  runId: RunId;
  mode: ReportParams['mode'];
  /** markdown body */
  markdown: string;
  /** optional attachments (paths or signed URLs) */
  attachments?: string[];
}

export interface CostEstimate {
  tokens?: number;
  tokenCostUsd?: number;
  storageBytes?: number;
  storageCostUsd?: number;
  egressBytes?: number;
  egressCostUsd?: number;
  wallTimeMs?: number;
  /** roll-up cost */
  totalUsd?: number;
}

//
// FlightRecorderService
//

export class FlightRecorderService {
  // Capacity caps (in-memory)
  private readonly MAX_RUNS = 20;
  private readonly MAX_CHECKPOINTS_PER_RUN = 1000;

  private runs = new Map<RunId, RecorderRunSummary>();
  private checkpoints = new Map<RunId, RecorderCheckpoint[]>();
  private listeners = new Map<RunId, Set<(c: RecorderCheckpoint) => void>>();

  // Selection channel for UI (timeline -> console)
  private currentSelection: { runId: RunId; checkpointId: CheckpointId } | null = null;
  private selectionListeners = new Set<(payload: { runId: RunId; checkpointId: CheckpointId }) => void>();

  startRun(runId: RunId, flowId?: string): RecorderRunSummary {
    // Enforce run capacity before creating a new run (evict oldest if necessary)
    this.ensureRunCapacity();

    const startedAt = new Date().toISOString();
    const summary: RecorderRunSummary = {
      runId,
      flowId,
      startedAt,
      status: 'running',
    };
    this.runs.set(runId, summary);
    this.checkpoints.set(runId, []);
    return summary;
  }

  addCheckpoint(cp: Omit<RecorderCheckpoint, 'id' | 'at'> & { id?: string; at?: string }): RecorderCheckpoint {
    const id = cp.id ?? cryptoRandomId();
    const at = cp.at ?? new Date().toISOString();
    const checkpoint: RecorderCheckpoint = { ...cp, id, at } as RecorderCheckpoint;
    const list = this.checkpoints.get(checkpoint.runId);

    if (!list) {
      // If run doesn't exist, create an implicit run to remain backwards-compatible
      this.startRun(checkpoint.runId);
      this.checkpoints.set(checkpoint.runId, [checkpoint]);
    } else {
      list.push(checkpoint);
      // Enforce per-run checkpoint cap (FIFO eviction of oldest)
      if (list.length > this.MAX_CHECKPOINTS_PER_RUN) {
        while (list.length > this.MAX_CHECKPOINTS_PER_RUN) {
          list.shift();
        }
      }
    }

    // notify listeners for this run
    const subs = this.listeners.get(checkpoint.runId);
    subs?.forEach((fn) => {
      try { fn(checkpoint); } catch { /* ignore listener errors */ }
    });

    return checkpoint;
  }

  /**
   * Append a console-style entry for a run. Creates a checkpoint with
   * label "console:entry" and data containing the provided entry.
   */
  appendConsole(runId: RunId, entry: RecorderConsoleEntry): RecorderCheckpoint {
    try {
      if (!this.runs.has(runId)) {
        this.startRun(runId);
      }
      const cp: Omit<RecorderCheckpoint, 'id' | 'at'> = {
        runId,
        label: 'console:entry',
        data: entry,
      };
      return this.addCheckpoint(cp);
    } catch {
      // Fail-safe: create a minimal checkpoint object if addCheckpoint throws (should be rare)
      const fallback: RecorderCheckpoint = {
        id: cryptoRandomId(),
        runId,
        at: new Date().toISOString(),
        label: 'console:entry',
        data: entry,
      };
      const list = this.checkpoints.get(runId) ?? [];
      list.push(fallback);
      this.checkpoints.set(runId, list);
      return fallback;
    }
  }

  endRun(runId: RunId, status: RecorderRunSummary['status'] = 'completed'): void {
    const s = this.runs.get(runId);
    if (!s) return;
    s.endedAt = new Date().toISOString();
    s.status = status;
    if (s.startedAt && s.endedAt) {
      s.metrics = { ...s.metrics, durationMs: Date.parse(s.endedAt) - Date.parse(s.startedAt) };
    }
    this.runs.set(runId, s);
  }

  getRun(runId: RunId): RecorderRunSummary | undefined {
    return this.runs.get(runId);
  }

  listRuns(): RecorderRunSummary[] {
    return Array.from(this.runs.values()).sort((a, b) => (b.startedAt.localeCompare(a.startedAt)));
  }

  listCheckpoints(runId: RunId): RecorderCheckpoint[] {
    return this.checkpoints.get(runId) ?? [];
  }

  subscribe(runId: RunId, cb: (c: RecorderCheckpoint) => void): () => void {
    const set = this.listeners.get(runId) ?? new Set<typeof cb>();
    set.add(cb);
    this.listeners.set(runId, set);
    return () => { set.delete(cb); };
  }

  clear(): void {
    this.runs.clear();
    this.checkpoints.clear();
    this.listeners.clear();
    this.selectionListeners.clear();
    this.currentSelection = null;
  }

  // Selection API: set selection (from timeline UI) and notify subscribers
  selectCheckpoint(runId: RunId, checkpointId: CheckpointId): void {
    const cps = this.checkpoints.get(runId);
    if (!cps) return;
    const found = cps.find((c) => c.id === checkpointId);
    if (!found) return;

    this.currentSelection = { runId, checkpointId };
    this.selectionListeners.forEach((fn) => {
      try { fn({ runId, checkpointId }); } catch { /* ignore */ }
    });
  }

  onSelect(listener: (payload: { runId: RunId; checkpointId: CheckpointId }) => void): () => void {
    this.selectionListeners.add(listener);
    return () => { this.selectionListeners.delete(listener); };
  }

  // Ensure run capacity (evict oldest runs FIFO) to stay within memory caps
  private ensureRunCapacity(): void {
    try {
      if (this.runs.size < this.MAX_RUNS) return;
      const sorted = Array.from(this.runs.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      while (this.runs.size >= this.MAX_RUNS && sorted.length) {
        const oldest = sorted.shift();
        if (!oldest) break;
        this.runs.delete(oldest.runId);
        this.checkpoints.delete(oldest.runId);
        this.listeners.delete(oldest.runId);
      }
    } catch {
      // noop on errors
    }
  }
}

//
// LineageService
//

export interface ArtifactNode {
  id: string; // artifactId
  type: 'input' | 'output' | 'intermediate';
  nodePin: string; // e.g., "node1.output1"
  meta?: {
    bytes?: number;
    createdAt?: string;
    mimeType?: string;
  };
}

export interface LineageGraph {
  nodes: ArtifactNode[];
  edges: LineageEdge[];
  roots: string[]; // artifact IDs with no parents
  leaves: string[]; // artifact IDs with no children
}

export class LineageService {
  private edges = new Map<RunId, LineageEdge[]>();
  private artifacts = new Map<RunId, Map<string, ArtifactNode>>();

  record(runId: RunId, edge: LineageEdge): void {
    const list = this.edges.get(runId) ?? [];
    list.push(edge);
    this.edges.set(runId, list);
  }

  recordArtifact(runId: RunId, artifact: ArtifactNode): void {
    const artifacts = this.artifacts.get(runId) ?? new Map();
    artifacts.set(artifact.id, artifact);
    this.artifacts.set(runId, artifacts);
  }

  graph(runId: RunId): LineageEdge[] {
    return this.edges.get(runId) ?? [];
  }

  /**
   * Build a complete lineage graph for a run
   */
  buildGraph(runId: RunId): LineageGraph {
    const edges = this.edges.get(runId) ?? [];
    const artifactMap = this.artifacts.get(runId) ?? new Map();

    // Build nodes from edges and artifacts
    const nodeSet = new Set<string>();
    const nodes: ArtifactNode[] = [];

    // Add known artifacts
    artifactMap.forEach((artifact) => {
      nodes.push(artifact);
      nodeSet.add(artifact.id);
    });

    // Add inferred nodes from edges
    edges.forEach((edge) => {
      if (edge.artifactId && !nodeSet.has(edge.artifactId)) {
        nodes.push({
          id: edge.artifactId,
          type: 'intermediate',
          nodePin: edge.from,
          meta: edge.meta,
        });
        nodeSet.add(edge.artifactId);
      }
    });

    // Find roots (no incoming edges) and leaves (no outgoing edges)
    const hasIncoming = new Set<string>();
    const hasOutgoing = new Set<string>();

    edges.forEach((edge) => {
      if (edge.artifactId) {
        hasOutgoing.add(edge.from);
        hasIncoming.add(edge.to);
      }
    });

    const roots = nodes
      .filter((n) => !hasIncoming.has(n.nodePin))
      .map((n) => n.id);

    const leaves = nodes
      .filter((n) => !hasOutgoing.has(n.nodePin))
      .map((n) => n.id);

    return { nodes, edges, roots, leaves };
  }

  /**
   * Get ancestors (parent artifacts) of a given artifact
   */
  getAncestors(runId: RunId, artifactId: string): ArtifactNode[] {
    const edges = this.edges.get(runId) ?? [];
    const artifacts = this.artifacts.get(runId) ?? new Map();

    const visited = new Set<string>();
    const ancestors: ArtifactNode[] = [];

    const traverse = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      // Find edges that produce this artifact
      const parentEdges = edges.filter((e) => e.to.includes(id) || e.artifactId === id);

      parentEdges.forEach((edge) => {
        // Extract parent artifact from edge
        const parentId = edge.artifactId;
        if (parentId && parentId !== id) {
          const artifact = artifacts.get(parentId);
          if (artifact) {
            ancestors.push(artifact);
            traverse(parentId);
          }
        }
      });
    };

    traverse(artifactId);
    return ancestors;
  }

  /**
   * Get descendants (child artifacts) of a given artifact
   */
  getDescendants(runId: RunId, artifactId: string): ArtifactNode[] {
    const edges = this.edges.get(runId) ?? [];
    const artifacts = this.artifacts.get(runId) ?? new Map();

    const visited = new Set<string>();
    const descendants: ArtifactNode[] = [];

    const traverse = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      // Find edges that consume this artifact
      const childEdges = edges.filter((e) => e.from.includes(id) || e.artifactId === id);

      childEdges.forEach((edge) => {
        // Extract child artifact from edge
        const childId = edge.artifactId;
        if (childId && childId !== id) {
          const artifact = artifacts.get(childId);
          if (artifact) {
            descendants.push(artifact);
            traverse(childId);
          }
        }
      });
    };

    traverse(artifactId);
    return descendants;
  }

  /**
   * Get the full provenance chain for an artifact
   */
  getProvenance(runId: RunId, artifactId: string): {
    ancestors: ArtifactNode[];
    descendants: ArtifactNode[];
    artifact?: ArtifactNode;
  } {
    const artifacts = this.artifacts.get(runId) ?? new Map();
    const artifact = artifacts.get(artifactId);

    return {
      artifact,
      ancestors: this.getAncestors(runId, artifactId),
      descendants: this.getDescendants(runId, artifactId),
    };
  }

  clear(runId?: RunId): void {
    if (runId) {
      this.edges.delete(runId);
      this.artifacts.delete(runId);
    } else {
      this.edges.clear();
      this.artifacts.clear();
    }
  }
}

//
// VariantService (A/B & canary)
//

export type VariantKey = string;

export class VariantService {
  private assignments = new Map<RunId, VariantKey>();

  assign(runId: RunId, variants: VariantKey[], strategy: 'random' | 'weighted' = 'random', weights?: number[]): VariantKey {
    const v = pickVariant(variants, strategy, weights);
    this.assignments.set(runId, v);
    return v;
  }

  get(runId: RunId): VariantKey | undefined {
    return this.assignments.get(runId);
  }

  clear(): void {
    this.assignments.clear();
  }
}

//
// PolicyService (safety/compliance)
//

export interface PolicyContext {
  edgeId: string;
  fromNode: string;
  toNode: string;
  payloadMeta?: { bytes?: number; mime?: string; pii?: boolean; unsafe?: boolean };
}

export interface PolicyResult {
  allow: boolean;
  reasons?: string[];
  actions?: ('scrub' | 'redact' | 'block' | 'warn')[];
}

export interface BudgetEnvelope {
  id: string;
  name: string;
  maxCost: number; // USD
  maxTokens?: number;
  maxDuration?: number; // seconds
  maxCalls?: number;
}

export interface PolicyViolation {
  id: string;
  timestamp: string;
  runId: string;
  nodeId: string;
  type: 'cost_exceeded' | 'pii_detected' | 'unsafe_content' | 'rate_limit' | 'duration_exceeded';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  action: 'allow' | 'warn' | 'block';
  metadata?: any;
}

export class PolicyService {
  private budgets = new Map<string, BudgetEnvelope>();
  private violations = new Map<RunId, PolicyViolation[]>();
  private costs = new Map<RunId, number>(); // Running cost per run

  setBudget(budget: BudgetEnvelope): void {
    this.budgets.set(budget.id, budget);
  }

  getBudget(id: string): BudgetEnvelope | undefined {
    return this.budgets.get(id);
  }

  evaluateEdge(ctx: PolicyContext): PolicyResult {
    const reasons: string[] = [];
    const actions: PolicyResult['actions'] = [];

    if (ctx.payloadMeta?.pii) {
      reasons.push('PII detected');
      actions.push('redact');
    }
    if (ctx.payloadMeta?.unsafe) {
      reasons.push('Content safety violation');
      actions.push('block');
    }

    const allow = actions.includes('block') ? false : true;
    return { allow, reasons, actions };
  }

  recordViolation(runId: RunId, violation: Omit<PolicyViolation, 'id' | 'timestamp'>): PolicyViolation {
    const fullViolation: PolicyViolation = {
      ...violation,
      id: cryptoRandomId(),
      timestamp: new Date().toISOString(),
    };

    const violations = this.violations.get(runId) ?? [];
    violations.push(fullViolation);
    this.violations.set(runId, violations);

    return fullViolation;
  }

  getViolations(runId: RunId): PolicyViolation[] {
    return this.violations.get(runId) ?? [];
  }

  recordCost(runId: RunId, cost: number): void {
    const current = this.costs.get(runId) ?? 0;
    this.costs.set(runId, current + cost);
  }

  getCost(runId: RunId): number {
    return this.costs.get(runId) ?? 0;
  }

  checkBudget(runId: RunId, budgetId: string): { exceeded: boolean; usage: number; limit: number } {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      return { exceeded: false, usage: 0, limit: 0 };
    }

    const usage = this.getCost(runId);
    const exceeded = usage > budget.maxCost;

    return { exceeded, usage, limit: budget.maxCost };
  }

  clearRun(runId: RunId): void {
    this.violations.delete(runId);
    this.costs.delete(runId);
  }

  clear(): void {
    this.violations.clear();
    this.costs.clear();
  }
}

//
// FlowLinterService
//

export class FlowLinterService {
  analyze(flow: Flow): LintIssue[] {
    const issues: LintIssue[] = [];
    const graph = (flow as any)?.graph ?? {};
    const nodes: any[] = Array.isArray(graph.nodes) ? graph.nodes : [];
    const edges: any[] = Array.isArray(graph.edges) ? graph.edges : [];

    // Build quick lookups
    const degree = new Map<string, { in: number; out: number }>();
    nodes.forEach((n) => degree.set(n.id, { in: 0, out: 0 }));
    edges.forEach((e) => {
      const fromId = typeof e.from === 'string' ? (e.from.split?.('.')?.[0] ?? e.from) : e.from;
      const toId = typeof e.to === 'string' ? (e.to.split?.('.')?.[0] ?? e.to) : e.to;
      if (fromId && degree.has(fromId)) degree.get(fromId)!.out++;
      if (toId && degree.has(toId)) degree.get(toId)!.in++;
    });

    // Helper to push issues
    const push = (i: LintIssue) => issues.push(i);

    // 1) no-edges (existing)
    if ((edges?.length ?? 0) === 0) {
      push({
        id: cryptoRandomId(),
        kind: 'warning',
        target: { type: 'node', id: flow.meta.id },
        rule: 'no-edges',
        message: 'Flow has no edges; outputs will not propagate.',
        fix: { id: 'open-edge-helper', title: 'Open canvas helper', action: 'open-edge-helper' },
      });
    }

    // 2) isolated-node (no incoming and no outgoing)
    nodes.forEach((n) => {
      const d = degree.get(n.id) ?? { in: 0, out: 0 };
      if ((d.in + d.out) === 0) {
        push({
          id: cryptoRandomId(),
          kind: 'warning',
          target: { type: 'node', id: n.id },
          rule: 'isolated-node',
          message: 'Node is not connected; it will neither receive nor send data.',
          fix: { id: 'open-connector-helper', title: 'Open connector helper', action: 'open-edge-helper', params: { nodeId: n.id } },
        });
      }
    });

    // 3) missing-timeout (suggest timeouts for reliability)
    nodes.forEach((n) => {
      const timeoutMs = (n as any)?.params?.timeoutMs;
      if (timeoutMs === undefined) {
        push({
          id: cryptoRandomId(),
          kind: 'info',
          target: { type: 'node', id: n.id },
          rule: 'no-timeout',
          message: 'No timeout configured for this node (params.timeoutMs). Consider adding one.',
          fix: { id: 'suggest-set-timeout', title: 'Set 30s timeout', action: 'suggest-set-timeout', params: { nodeId: n.id, timeoutMs: 30000 } },
        });
      }
    });

    // 4) untyped-pin (inputs/outputs present but missing pin types)
    nodes.forEach((n) => {
      const inputs = (n as any)?.inputs;
      const outputs = (n as any)?.outputs;
      const pinList = [
        ...Object.values(inputs ?? {}),
        ...Object.values(outputs ?? {}),
      ] as any[];
      const hasUntyped = pinList.some((p) => p && typeof p.type === 'undefined');
      if (hasUntyped) {
        push({
          id: cryptoRandomId(),
          kind: 'info',
          target: { type: 'node', id: n.id },
          rule: 'untyped-pin',
          message: 'Some pins are missing types; contract checking and adapters may be limited.',
          fix: { id: 'open-pin-schema', title: 'Open pin schema', action: 'open-pin-schema', params: { nodeId: n.id } },
        });
      }
    });

    // 5) fanout-high (many outgoing edges from one node)
    nodes.forEach((n) => {
      const d = degree.get(n.id) ?? { in: 0, out: 0 };
      if (d.out >= 6) {
        push({
          id: cryptoRandomId(),
          kind: 'warning',
          target: { type: 'node', id: n.id },
          rule: 'fanout-high',
          message: `Node has high fan-out (${d.out}). Consider batching or a broker to reduce N+1 effects.`,
          fix: { id: 'open-edge-helper', title: 'Open edge helper', action: 'open-edge-helper', params: { nodeId: n.id } },
        });
      }
    });

    return issues;
  }

  /**
   * Apply a quick-fix to the flow, returning a new flow with the fix applied.
   * Returns the original flow unchanged if the fix cannot be auto-applied.
   */
  applyQuickFix(flow: Flow, issue: LintIssue): Flow {
    if (!issue?.fix) {
      console.debug('[FlowLinterService] applyQuickFix: no fix descriptor', { issueId: issue?.id });
      return flow;
    }

    const { action, params } = issue.fix;
    console.debug('[FlowLinterService] applyQuickFix', {
      issueId: issue.id,
      fixId: issue.fix.id,
      action,
      params,
    });

    const graph = (flow as any)?.graph ?? {};
    const nodes: any[] = Array.isArray(graph.nodes) ? graph.nodes : [];

    switch (action) {
      case 'suggest-set-timeout': {
        // Auto-apply: Set timeout on the target node
        const nodeId = params?.nodeId as string;
        const timeoutMs = (params?.timeoutMs as number) ?? 30000;
        if (!nodeId) return flow;

        const updatedNodes = nodes.map((n) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            params: {
              ...(n.params ?? {}),
              timeoutMs,
            },
          };
        });

        return {
          ...flow,
          graph: {
            ...graph,
            nodes: updatedNodes,
          },
        };
      }

      case 'remove-circular-edge': {
        // Auto-apply: Remove an edge that creates a cycle
        const edgeId = params?.edgeId as string;
        if (!edgeId) return flow;

        const edges: any[] = Array.isArray(graph.edges) ? graph.edges : [];
        const updatedEdges = edges.filter((e) => e.id !== edgeId);

        return {
          ...flow,
          graph: {
            ...graph,
            edges: updatedEdges,
          },
        };
      }

      case 'set-pin-type': {
        // Auto-apply: Set a pin type on a node
        const nodeId = params?.nodeId as string;
        const pinId = params?.pinId as string;
        const pinType = params?.type as string;
        const pinLocation = (params?.location as 'inputs' | 'outputs') ?? 'inputs';
        if (!nodeId || !pinId || !pinType) return flow;

        const updatedNodes = nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const pins = n[pinLocation] ?? {};
          return {
            ...n,
            [pinLocation]: {
              ...pins,
              [pinId]: {
                ...(pins[pinId] ?? {}),
                type: pinType,
              },
            },
          };
        });

        return {
          ...flow,
          graph: {
            ...graph,
            nodes: updatedNodes,
          },
        };
      }

      case 'add-edge': {
        // Auto-apply: Add an edge between two nodes
        const fromNode = params?.fromNode as string;
        const toNode = params?.toNode as string;
        const fromPin = params?.fromPin as string;
        const toPin = params?.toPin as string;
        if (!fromNode || !toNode) return flow;

        const edges: any[] = Array.isArray(graph.edges) ? graph.edges : [];
        const newEdge = {
          id: `edge-${cryptoRandomId()}`,
          from: fromPin ? `${fromNode}.${fromPin}` : fromNode,
          to: toPin ? `${toNode}.${toPin}` : toNode,
        };

        return {
          ...flow,
          graph: {
            ...graph,
            edges: [...edges, newEdge],
          },
        };
      }

      // UI-only actions that cannot be auto-applied - return flow unchanged
      // The UI should handle these by showing appropriate helpers/dialogs
      case 'open-edge-helper':
      case 'open-connector-helper':
      case 'open-pin-schema':
        console.debug('[FlowLinterService] UI-only action, not auto-applied:', action);
        return flow;

      default:
        console.warn('[FlowLinterService] Unknown quick-fix action:', action);
        return flow;
    }
  }

  /**
   * Check if a quick-fix can be automatically applied (vs requiring UI interaction)
   */
  canAutoApply(issue: LintIssue): boolean {
    const autoApplyActions = ['suggest-set-timeout', 'remove-circular-edge', 'set-pin-type', 'add-edge'];
    return autoApplyActions.includes(issue?.fix?.action ?? '');
  }

  applyFix(flow: Flow, issue: LintIssue): Flow {
    // Backwards-compatible alias
    return this.applyQuickFix(flow, issue);
  }
}

//
// ReportService
//

export class ReportService {
  generate(runId: RunId, params: ReportParams, recorder: FlightRecorderService): ReportResult {
    const summary = recorder.getRun(runId);
    const checkpoints = recorder.listCheckpoints(runId);
    const mode = params.mode;

    const header = `# Run ${runId} — ${mode === 'executive' ? 'Summary' : 'Technical Report'}`;
    const status = summary ? `Status: ${summary.status}\nStarted: ${summary.startedAt}${summary.endedAt ? `\nEnded: ${summary.endedAt}` : ''}` : 'Status: unknown';
    const steps = checkpoints.map((c) => `- [${new Date(c.at).toLocaleTimeString()}] ${c.label}`).join('\n');

    const markdown = [
      header,
      '',
      status,
      '',
      '## Timeline',
      steps || '_No checkpoints recorded._',
    ].join('\n');

    return { runId, mode, markdown };
  }
}

//
// CostSimulator
//

/**
 * Cost profiles for different node categories.
 * Based on industry-standard pricing (2024):
 * - OpenAI GPT-4: ~$30/1M input tokens, ~$60/1M output tokens
 * - Claude: ~$15/1M input tokens, ~$75/1M output tokens
 * - S3 storage: ~$0.023/GB/month
 * - S3 egress: ~$0.09/GB
 * - Compute: ~$0.05/vCPU-hour
 */
interface NodeCostProfile {
  /** Estimated tokens for LLM calls (input + output) */
  tokens: number;
  /** Estimated storage in bytes */
  storageBytes: number;
  /** Estimated egress in bytes */
  egressBytes: number;
  /** Estimated execution time in ms */
  wallTimeMs: number;
}

const COST_PROFILES: Record<string, NodeCostProfile> = {
  // AI nodes - expensive (LLM tokens)
  ai: { tokens: 4000, storageBytes: 10_000, egressBytes: 5_000, wallTimeMs: 3000 },
  'ai:chat': { tokens: 8000, storageBytes: 20_000, egressBytes: 10_000, wallTimeMs: 5000 },
  'ai:completion': { tokens: 2000, storageBytes: 5_000, egressBytes: 2_500, wallTimeMs: 2000 },
  'ai:embedding': { tokens: 500, storageBytes: 4_000, egressBytes: 4_000, wallTimeMs: 500 },
  'ai:vision': { tokens: 10000, storageBytes: 500_000, egressBytes: 50_000, wallTimeMs: 8000 },
  'ai:transcription': { tokens: 0, storageBytes: 100_000, egressBytes: 20_000, wallTimeMs: 10000 },

  // Media nodes - storage/egress heavy
  media: { tokens: 0, storageBytes: 1_000_000, egressBytes: 500_000, wallTimeMs: 2000 },
  'media:upload': { tokens: 0, storageBytes: 5_000_000, egressBytes: 0, wallTimeMs: 1000 },
  'media:download': { tokens: 0, storageBytes: 0, egressBytes: 5_000_000, wallTimeMs: 1000 },
  'media:image:resize': { tokens: 0, storageBytes: 500_000, egressBytes: 250_000, wallTimeMs: 500 },
  'media:image:filter': { tokens: 0, storageBytes: 500_000, egressBytes: 250_000, wallTimeMs: 300 },
  'media:video:transcode': { tokens: 0, storageBytes: 50_000_000, egressBytes: 25_000_000, wallTimeMs: 60000 },
  'media:audio:transcode': { tokens: 0, storageBytes: 5_000_000, egressBytes: 2_500_000, wallTimeMs: 5000 },

  // Processing nodes - compute only
  processing: { tokens: 0, storageBytes: 1_000, egressBytes: 500, wallTimeMs: 100 },
  transform: { tokens: 0, storageBytes: 2_000, egressBytes: 1_000, wallTimeMs: 50 },
  filter: { tokens: 0, storageBytes: 500, egressBytes: 250, wallTimeMs: 25 },
  aggregate: { tokens: 0, storageBytes: 5_000, egressBytes: 2_500, wallTimeMs: 150 },

  // Logic nodes - minimal cost
  logic: { tokens: 0, storageBytes: 100, egressBytes: 50, wallTimeMs: 10 },
  branch: { tokens: 0, storageBytes: 100, egressBytes: 50, wallTimeMs: 5 },
  merge: { tokens: 0, storageBytes: 200, egressBytes: 100, wallTimeMs: 10 },
  loop: { tokens: 0, storageBytes: 100, egressBytes: 50, wallTimeMs: 5 },

  // Integration nodes - network I/O
  integration: { tokens: 0, storageBytes: 10_000, egressBytes: 10_000, wallTimeMs: 500 },
  'http:request': { tokens: 0, storageBytes: 5_000, egressBytes: 10_000, wallTimeMs: 300 },
  webhook: { tokens: 0, storageBytes: 2_000, egressBytes: 5_000, wallTimeMs: 200 },
  database: { tokens: 0, storageBytes: 10_000, egressBytes: 5_000, wallTimeMs: 100 },

  // Input/Output nodes
  input: { tokens: 0, storageBytes: 1_000, egressBytes: 0, wallTimeMs: 10 },
  output: { tokens: 0, storageBytes: 0, egressBytes: 1_000, wallTimeMs: 10 },

  // Default fallback
  default: { tokens: 100, storageBytes: 1_000, egressBytes: 500, wallTimeMs: 100 },
};

// Pricing constants (USD)
const PRICING = {
  tokenInputPer1M: 15.0,   // ~Claude pricing
  tokenOutputPer1M: 75.0,  // ~Claude pricing
  storagePerGBMonth: 0.023, // S3 standard
  egressPerGB: 0.09,       // S3 egress
};

export class CostSimulator {
  /**
   * Get cost profile for a node based on its type and category.
   */
  private getNodeProfile(node: { type: string; category?: string }): NodeCostProfile {
    // Try exact type match first
    if (COST_PROFILES[node.type]) {
      return COST_PROFILES[node.type];
    }

    // Try type prefix (e.g., "ai:chat:gpt4" → "ai:chat" → "ai")
    const typeParts = node.type.split(':');
    for (let i = typeParts.length - 1; i >= 1; i--) {
      const prefix = typeParts.slice(0, i).join(':');
      if (COST_PROFILES[prefix]) {
        return COST_PROFILES[prefix];
      }
    }

    // Fall back to category
    if (node.category && COST_PROFILES[node.category]) {
      return COST_PROFILES[node.category];
    }

    // Default profile
    return COST_PROFILES.default;
  }

  /**
   * Estimate costs for a flow execution.
   */
  estimateFlow(flow: Flow): CostEstimate {
    const nodes = flow.graph?.nodes ?? [];

    if (nodes.length === 0) {
      return {
        tokens: 0,
        tokenCostUsd: 0,
        storageBytes: 0,
        storageCostUsd: 0,
        egressBytes: 0,
        egressCostUsd: 0,
        wallTimeMs: 0,
        totalUsd: 0,
      };
    }

    // Aggregate costs from all nodes
    let totalTokens = 0;
    let totalStorageBytes = 0;
    let totalEgressBytes = 0;
    let maxWallTimeMs = 0; // Assume parallel execution, take max path
    let sequentialTimeMs = 0; // Also track sequential for comparison

    for (const node of nodes) {
      const profile = this.getNodeProfile(node);
      totalTokens += profile.tokens;
      totalStorageBytes += profile.storageBytes;
      totalEgressBytes += profile.egressBytes;
      sequentialTimeMs += profile.wallTimeMs;
      maxWallTimeMs = Math.max(maxWallTimeMs, profile.wallTimeMs);
    }

    // Estimate wall time based on graph structure
    // Use a heuristic: sqrt(sequential) * max gives a reasonable parallel estimate
    const estimatedWallTimeMs = Math.ceil(
      Math.sqrt(sequentialTimeMs / maxWallTimeMs) * maxWallTimeMs
    );

    // Calculate costs
    // Assume 40% input tokens, 60% output tokens (typical for agents)
    const inputTokens = Math.floor(totalTokens * 0.4);
    const outputTokens = totalTokens - inputTokens;
    const tokenCostUsd =
      (inputTokens / 1_000_000) * PRICING.tokenInputPer1M +
      (outputTokens / 1_000_000) * PRICING.tokenOutputPer1M;

    // Storage: assume 1 month retention
    const storageCostUsd = (totalStorageBytes / 1_000_000_000) * PRICING.storagePerGBMonth;

    // Egress
    const egressCostUsd = (totalEgressBytes / 1_000_000_000) * PRICING.egressPerGB;

    const totalUsd = tokenCostUsd + storageCostUsd + egressCostUsd;

    return {
      tokens: totalTokens,
      tokenCostUsd: Math.round(tokenCostUsd * 1000000) / 1000000, // 6 decimal places
      storageBytes: totalStorageBytes,
      storageCostUsd: Math.round(storageCostUsd * 1000000) / 1000000,
      egressBytes: totalEgressBytes,
      egressCostUsd: Math.round(egressCostUsd * 1000000) / 1000000,
      wallTimeMs: estimatedWallTimeMs,
      totalUsd: Math.round(totalUsd * 1000000) / 1000000,
    };
  }

  /**
   * Get a breakdown of costs by category.
   */
  estimateByCategory(flow: Flow): Record<string, CostEstimate> {
    const nodes = flow.graph?.nodes ?? [];
    const byCategory: Record<string, CostEstimate> = {};

    for (const node of nodes) {
      const category = node.category || 'other';
      const profile = this.getNodeProfile(node);

      if (!byCategory[category]) {
        byCategory[category] = {
          tokens: 0,
          tokenCostUsd: 0,
          storageBytes: 0,
          storageCostUsd: 0,
          egressBytes: 0,
          egressCostUsd: 0,
          wallTimeMs: 0,
          totalUsd: 0,
        };
      }

      const cat = byCategory[category];
      cat.tokens = (cat.tokens ?? 0) + profile.tokens;
      cat.storageBytes = (cat.storageBytes ?? 0) + profile.storageBytes;
      cat.egressBytes = (cat.egressBytes ?? 0) + profile.egressBytes;
      cat.wallTimeMs = (cat.wallTimeMs ?? 0) + profile.wallTimeMs;
    }

    // Calculate costs for each category
    for (const category of Object.keys(byCategory)) {
      const cat = byCategory[category];
      const inputTokens = Math.floor((cat.tokens ?? 0) * 0.4);
      const outputTokens = (cat.tokens ?? 0) - inputTokens;

      cat.tokenCostUsd =
        (inputTokens / 1_000_000) * PRICING.tokenInputPer1M +
        (outputTokens / 1_000_000) * PRICING.tokenOutputPer1M;
      cat.storageCostUsd = ((cat.storageBytes ?? 0) / 1_000_000_000) * PRICING.storagePerGBMonth;
      cat.egressCostUsd = ((cat.egressBytes ?? 0) / 1_000_000_000) * PRICING.egressPerGB;
      cat.totalUsd = (cat.tokenCostUsd ?? 0) + (cat.storageCostUsd ?? 0) + (cat.egressCostUsd ?? 0);
    }

    return byCategory;
  }
}

//
// Utilities
//

function cryptoRandomId(): string {
  try {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

function pickVariant(variants: VariantKey[], strategy: 'random' | 'weighted', weights?: number[]): VariantKey {
  if (strategy === 'weighted' && weights && weights.length === variants.length) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < variants.length; i++) {
      if ((r -= weights[i]) <= 0) return variants[i];
    }
  }
  return variants[Math.floor(Math.random() * variants.length)];
}

//
// Singletons (optional)
//

export const flightRecorder = new FlightRecorderService();
export const lineage = new LineageService();
export const variants = new VariantService();
export const policies = new PolicyService();
export const linter = new FlowLinterService();
export const reports = new ReportService();
export const simulator = new CostSimulator();