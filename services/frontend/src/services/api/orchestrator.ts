import { getOrchestratorBaseUrl } from '@/config/orchestrator';
import { flightRecorder } from '../mission-control/services';

// Types aligned with FastAPI orchestrator minimal models
export type PlanNode = {
  id: string;
  agent?: string;        // optional for simulated executor
  params?: Record<string, unknown>;
};

export type PlanEdge = {
  from: string;          // "nodeId[.pin]"
  to: string;            // "nodeId[.pin]"
};

export type RunPlan = {
  nodes: PlanNode[];
  edges: PlanEdge[];
  metadata?: Record<string, unknown>;
};

export type CreateRunRequest = {
  plan: RunPlan;
  options?: {
    dryRun?: boolean;
  };
};

export type RunSnapshot = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  created_at: string;
  started_at?: string;
  finished_at?: string;
  summary?: Record<string, unknown>;
};

type OrchestratorEvent =
  | { event: 'hello'; id: number; data: { run_id: string; server_time?: string } }
  | { event: 'status'; id: number; data: { run_id: string; status: RunSnapshot['status'] } }
  | { event: 'node_status'; id: number; data: { run_id: string; node_id: string; state: string } }
  | { event: 'log'; id: number; data: { run_id: string; level: string; message: string; node_id?: string; ts?: string } }
  | { event: 'checkpoint'; id: number; data: { run_id: string; label: string; data?: Record<string, unknown> } }
  | { event: 'artifact'; id: number; data: Record<string, unknown> }
  | { event: string; id: number; data: any }; // tolerant fallback

function base(): string {
  return getOrchestratorBaseUrl().replace(/\/+$/, '');
}

export async function createRun(req: CreateRunRequest): Promise<{ run_id: string }> {
  const url = `${base()}/api/v1/runs`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    credentials: 'same-origin',
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`createRun failed: HTTP ${resp.status} ${resp.statusText}${txt ? ' - ' + txt.slice(0, 300) : ''}`);
  }
  const out = await resp.json().catch(() => ({}));
  // backend may return {run_id} or a richer body; normalize
  const run_id = out.run_id || out.id || out.runId;
  if (!run_id) {
    throw new Error('createRun: response missing run_id');
  }
  return { run_id };
}

export async function getRun(runId: string): Promise<RunSnapshot> {
  const url = `${base()}/api/v1/runs/${encodeURIComponent(runId)}`;
  const resp = await fetch(url, { credentials: 'same-origin' });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`getRun failed: HTTP ${resp.status} ${resp.statusText}${txt ? ' - ' + txt.slice(0, 300) : ''}`);
  }
  return await resp.json();
}

/**
 * Subscribe to SSE events for a run and mirror them into the Mission Control flightRecorder.
 * Returns a handle with the EventSource and a stop() cleaner.
 */
export function streamRunEvents(runId: string, lastEventId?: string | number): {
  es: EventSource;
  stop: () => void;
} {
  const url = new URL(`${base()}/api/v1/runs/${encodeURIComponent(runId)}/events`);
  if (lastEventId !== undefined && lastEventId !== null) {
    // Server supports Last-Event-ID resume via header; URL param is also accepted by many implementations.
    url.searchParams.set('lastEventId', String(lastEventId));
  }

  const esInit: EventSourceInit = {};
  const es = new EventSource(url.toString(), esInit);

  let recorderStarted = false;

  const startRecorderIfNeeded = () => {
    if (!recorderStarted) {
      try {
        flightRecorder.startRun(runId, 'orchestrator-run');
        recorderStarted = true;
      } catch {
        // ignore
      }
    }
  };

  const endRecorder = (status: 'completed' | 'failed' | 'canceled') => {
    try {
      flightRecorder.endRun(runId, status);
    } catch {
      // ignore
    }
  };

  const onAny = (evtType: string) => (ev: MessageEvent) => {
    try {
      const payload: OrchestratorEvent = {
        event: evtType,
        id: Number((ev as any).lastEventId ?? NaN) || NaN,
        data: safeJson(ev.data),
      } as any;

      // Mirror into flightRecorder timeline
      startRecorderIfNeeded();

      switch (payload.event) {
        case 'hello': {
          // Already started; add a checkpoint
          safeCheckpoint(runId, 'connection:open', { transport: 'sse', server_time: (payload as any).data?.server_time });
          break;
        }
        case 'status': {
          const st = (payload as any).data?.status as RunSnapshot['status'];
          safeCheckpoint(runId, 'run:status', { status: st });
          if (st === 'succeeded') endRecorder('completed');
          else if (st === 'failed') endRecorder('failed');
          else if (st === 'cancelled') endRecorder('canceled');
          break;
        }
        case 'node_status': {
          const d = (payload as any).data || {};
          const node = d.node_id || d.node || d.id;
          const state = String(d.state || '');
          // Emit semantic checkpoints that NetworkPanel understands
          if (state.toLowerCase() === 'running') {
            safeCheckpoint(runId, 'node:exec', { node });
          } else {
            safeCheckpoint(runId, 'node:status', { node, state });
          }
          break;
        }
        case 'log': {
          const d = (payload as any).data || {};
          safeCheckpoint(runId, 'log', {
            level: d.level,
            node: d.node_id || d.node,
            message: d.message,
          });
          break;
        }
        case 'checkpoint': {
          const d = (payload as any).data || {};
          // Forward label/data directly so Network panel can render 'node:exec', 'edge:transmit', 'tool:call'
          safeCheckpoint(runId, String(d.label || 'checkpoint'), d.data || {});
          break;
        }
        default: {
          // Tolerant: record unknowns for debugging without breaking UI
          safeCheckpoint(runId, `evt:${payload.event}`, (payload as any).data || {});
          break;
        }
      }
    } catch {
      // tolerate malformed frames
    }
  };

  // Register listeners for named SSE events the backend emits
  es.addEventListener('hello', onAny('hello'));
  es.addEventListener('status', onAny('status'));
  es.addEventListener('node_status', onAny('node_status'));
  es.addEventListener('log', onAny('log'));
  es.addEventListener('checkpoint', onAny('checkpoint'));
  es.addEventListener('artifact', onAny('artifact'));
  // Also handle default "message" in case server sends unnamed events
  es.onmessage = onAny('message');

  es.onerror = (_err) => {
    // Record connection error as a checkpoint
    startRecorderIfNeeded();
    safeCheckpoint(runId, 'connection:error');
    // EventSource will auto-retry; we keep it open
  };

  return {
    es,
    stop: () => {
      try {
        es.close();
        if (recorderStarted) {
          safeCheckpoint(runId, 'connection:close', { transport: 'sse' });
        }
      } catch {
        // ignore
      }
    },
  };
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

function safeCheckpoint(runId: string, label: string, data?: Record<string, unknown>) {
  try {
    flightRecorder.addCheckpoint({ runId, label, data });
  } catch {
    // ignore
  }
}

// Convenience: one-shot helper to create and stream a demo plan
export async function startDemoRunAndStream(): Promise<{ runId: string; stop: () => void }> {
  const plan: RunPlan = {
    nodes: [
      { id: 'Perception' },
      { id: 'Ego' },
      { id: 'Planning' },
      { id: 'Memory' },
      { id: 'Actuator' },
    ],
    edges: [
      { from: 'Perception.out', to: 'Ego.in' },
      { from: 'Ego.out', to: 'Planning.in' },
      { from: 'Planning.out', to: 'Memory.in' },
      { from: 'Planning.out', to: 'Actuator.in' },
    ],
    metadata: { kind: 'demo' },
  };
  const { run_id } = await createRun({ plan });
  const { stop } = streamRunEvents(run_id);
  return { runId: run_id, stop };
}