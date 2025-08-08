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
  /** optional quick-fix */
  fix?: {
    label: string;
    /** serialized action payload; UI will route to fixer */
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
  private runs = new Map<RunId, RecorderRunSummary>();
  private checkpoints = new Map<RunId, RecorderCheckpoint[]>();
  private listeners = new Map<RunId, Set<(c: RecorderCheckpoint) => void>>();

  startRun(runId: RunId, flowId?: string): RecorderRunSummary {
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
      this.checkpoints.set(checkpoint.runId, [checkpoint]);
    } else {
      list.push(checkpoint);
    }
    // notify listeners
    const subs = this.listeners.get(checkpoint.runId);
    subs?.forEach((fn) => {
      try { fn(checkpoint); } catch { /* ignore */ }
    });
    return checkpoint;
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
  }
}

//
// LineageService
//

export class LineageService {
  private edges = new Map<RunId, LineageEdge[]>();

  record(runId: RunId, edge: LineageEdge): void {
    const list = this.edges.get(runId) ?? [];
    list.push(edge);
    this.edges.set(runId, list);
  }

  graph(runId: RunId): LineageEdge[] {
    return this.edges.get(runId) ?? [];
  }

  clear(runId?: RunId): void {
    if (runId) this.edges.delete(runId);
    else this.edges.clear();
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

export class PolicyService {
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
        fix: { label: 'Open canvas helper', action: 'open-edge-helper' },
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
          fix: { label: 'Open connector helper', action: 'open-edge-helper', params: { nodeId: n.id } },
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
          fix: { label: 'Set 30s timeout', action: 'suggest-set-timeout', params: { nodeId: n.id, timeoutMs: 30000 } },
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
          fix: { label: 'Open pin schema', action: 'open-pin-schema', params: { nodeId: n.id } },
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
          fix: { label: 'Open edge helper', action: 'open-edge-helper', params: { nodeId: n.id } },
        });
      }
    });

    return issues;
  }

  applyFix(flow: Flow, _issue: LintIssue): Flow {
    // Pure function placeholder; mutate a cloned flow with requested fix
    // For MVP we just return the original flow.
    return flow;
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