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

  applyQuickFix(flow: Flow, issue: LintIssue): Flow {
    // MC1: stubbed quick-fix applier — do not mutate the flow.
    // Log the invocation for telemetry/debugging and return the input flow unchanged.
    try {
      console.debug('[FlowLinterService] applyQuickFix', {
        issueId: issue?.id,
        fixId: issue?.fix?.id,
        action: issue?.fix?.action,
        params: issue?.fix?.params,
      });
    } catch {
      // ignore logging failures
    }
    return flow;
  }

  applyFix(flow: Flow, issue: LintIssue): Flow {
    // Backwards-compatible alias that delegates to applyQuickFix (no graph mutation for MC1)
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

export class CostSimulator {
  estimateFlow(flow: Flow): CostEstimate {
    // Heuristic placeholder: count nodes; assume per-node budget
    const nodeCount = flow.graph.nodes.length;
    const tokens = nodeCount * 500; // fake
    const tokenCostUsd = tokens * 0.000002; // fake $/token
    const storageBytes = nodeCount * 50_000; // fake
    const storageCostUsd = storageBytes / 1_000_000 * 0.02; // fake $/MB
    const egressBytes = nodeCount * 25_000; // fake
    const egressCostUsd = egressBytes / 1_000_000 * 0.08; // fake $/MB
    const wallTimeMs = nodeCount * 250; // fake

    const totalUsd = (tokenCostUsd ?? 0) + (storageCostUsd ?? 0) + (egressCostUsd ?? 0);
    return { tokens, tokenCostUsd, storageBytes, storageCostUsd, egressBytes, egressCostUsd, wallTimeMs, totalUsd };
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