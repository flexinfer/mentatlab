// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OrchestratorSSE from '../orchestratorSSE';

// Mock base URL helper
vi.mock('../../../../config/orchestrator', () => ({
  getOrchestratorBaseUrl: () => 'http://orch.test',
  getApiBaseUrl: () => 'http://orch.test',
}));

// Simple EventSource mock that allows tests to simulate open/error/message/named events.
// Instances are recorded on globalThis.__EventSourceInstances for inspection.
// Auto-fires 'open' on next microtask so connect() promises resolve.
class MockEventSource {
  url: string;
  readyState: number = 0;
  withCredentials: boolean;
  onopen: (() => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  private listeners: Record<string, ((ev: any) => void)[]> = {};

  constructor(url: string, opts?: { withCredentials?: boolean }) {
    this.url = url;
    this.readyState = 0;
    this.withCredentials = opts?.withCredentials ?? false;
    (globalThis as any).__EventSourceInstances = (globalThis as any).__EventSourceInstances || [];
    (globalThis as any).__EventSourceInstances.push(this);

    // Auto-fire open on next microtask so connect() resolves without manual simulateOpen()
    Promise.resolve().then(() => {
      if (this.readyState === 0) {
        this.simulateOpen();
      }
    });
  }

  addEventListener(type: string, handler: (ev: any) => void) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(handler);
  }

  removeEventListener(type: string, handler: (ev: any) => void) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((h) => h !== handler);
  }

  close() {
    this.readyState = 2;
  }

  // Helpers for tests
  simulateOpen() {
    this.readyState = 1;
    if (this.onopen) this.onopen();
    const handlers = this.listeners['open'] || [];
    handlers.forEach((h) => h({}));
  }

  simulateError(payload: any = {}) {
    if (this.onerror) this.onerror(payload);
    const handlers = this.listeners['error'] || [];
    handlers.forEach((h) => h(payload));
  }

  simulateMessage(data: unknown) {
    if (this.onmessage) this.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) });
    const handlers = this.listeners['message'] || [];
    handlers.forEach((h) => h({ data: typeof data === 'string' ? data : JSON.stringify(data) }));
  }

  simulateEvent(type: string, data: unknown) {
    const ev = { data: typeof data === 'string' ? data : JSON.stringify(data) };
    const handlers = this.listeners[type] || [];
    handlers.forEach((h) => h(ev));
  }
}

/** Helper: get all MockEventSource instances created so far */
function getInstances(): MockEventSource[] {
  return (globalThis as any).__EventSourceInstances || [];
}

describe('OrchestratorSSE (unit)', () => {
  beforeEach(() => {
    // Replace global EventSource with our mock and reset instances
    (globalThis as any).EventSource = MockEventSource as any;
    (globalThis as any).__EventSourceInstances = [];
    vi.useFakeTimers();
    vi.clearAllTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // cleanup any global mutation
    delete (globalThis as any).EventSource;
    delete (globalThis as any).__EventSourceInstances;
    vi.restoreAllMocks();
  });

  it('connect() constructs expected URL and opens (default replay)', async () => {
    const handlers = {
      onOpen: vi.fn(),
      onHello: vi.fn(),
      onStatus: vi.fn(),
      onCheckpoint: vi.fn(),
      onRaw: vi.fn(),
      onError: vi.fn()
    };

    const client = new OrchestratorSSE({ debug: false });

    // connect() returns a promise; the MockEventSource auto-fires open on microtask
    await client.connect('run-xyz', handlers);

    // There should be one EventSource created
    const instances = getInstances();
    expect(instances.length).toBe(1);
    const inst = instances[0];

    // URL should include /api/v1 prefix and replay param
    expect(inst.url).toContain('http://orch.test');
    expect(inst.url).toContain('/api/v1/runs/run-xyz/events');
    // default replay is 10
    expect(inst.url).toContain('replay=10');

    expect(handlers.onOpen).toHaveBeenCalled();
  });

  it('dispatches named events (hello, status, checkpoint) and onRaw', async () => {
    const handlers = {
      onOpen: vi.fn(),
      onHello: vi.fn(),
      onStatus: vi.fn(),
      onCheckpoint: vi.fn(),
      onRaw: vi.fn(),
      onError: vi.fn()
    };

    const client = new OrchestratorSSE({ debug: false });
    const cp = { id: 'cp1', runId: 'run-1', ts: new Date().toISOString(), type: 'progress', data: { n: 1 } };

    // Auto-open fires via microtask
    await client.connect('run-1', handlers);

    const instances = getInstances();
    const inst = instances[0];

    // Simulate named events
    inst.simulateEvent('hello', { runId: 'run-1' });
    inst.simulateEvent('status', { runId: 'run-1', status: 'running' });
    inst.simulateEvent('checkpoint', cp);

    expect(handlers.onHello).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(handlers.onStatus).toHaveBeenCalledWith({ runId: 'run-1', status: 'running' });
    expect(handlers.onCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ id: 'cp1' }));

    // onRaw should be called for each named event as well
    expect(handlers.onRaw).toHaveBeenCalled();
  });

  it('schedules reconnect on error and respects backoff -> new EventSource created', async () => {
    const handlers = {
      onOpen: vi.fn(),
      onError: vi.fn()
    };

    const client = new OrchestratorSSE({ debug: false });

    await client.connect('run-reconnect', handlers);
    let instances = getInstances();
    expect(instances.length).toBe(1);
    const inst1 = instances[0];

    // Simulate an error that triggers scheduleReconnect
    inst1.simulateError({ code: 'E' });

    // The reconnect schedule uses backoff of 1000ms for first attempt.
    // Advance timers to trigger reconnect.
    vi.advanceTimersByTime(1000);

    // The reconnect timer fires and calls connect() which creates a new EventSource.
    // But the new EventSource's auto-open fires via Promise.resolve().then(),
    // which needs a microtask flush. Use advanceTimersByTime(0) won't help,
    // we need to await a microtask.
    await vi.advanceTimersByTimeAsync(0);

    // A new EventSource should have been created
    instances = getInstances();
    expect(instances.length).toBeGreaterThanOrEqual(2);

    // onOpen handler should have been called again (second connection)
    expect(handlers.onOpen).toHaveBeenCalledTimes(2);
  });

  it('heartbeat stall triggers reconnect after 45s and only schedules one reconnect', async () => {
    const handlers = {
      onOpen: vi.fn()
    };

    const client = new OrchestratorSSE({ debug: false });

    await client.connect('run-stall', handlers);
    let instances = getInstances();
    expect(instances.length).toBe(1);

    // Advance time beyond HEARTBEAT_TIMEOUT_MS (45s) to trigger the watchdog.
    // The watchdog checks every 5s, so at 45s+ it fires scheduleReconnect.
    vi.advanceTimersByTime(46_000);

    // After watchdog triggers, reconnect is scheduled with first backoff (1000ms)
    vi.advanceTimersByTime(1_000);

    // Flush microtask for auto-open of new EventSource
    await vi.advanceTimersByTimeAsync(0);

    instances = getInstances();
    expect(instances.length).toBeGreaterThanOrEqual(2);

    // Ensure only one reconnect timer was scheduled (idempotency):
    // advancing more should not create duplicate instances
    const before = instances.length;
    vi.advanceTimersByTime(5_000);
    await vi.advanceTimersByTimeAsync(0);
    instances = getInstances();
    expect(instances.length).toBe(before);
  });

  it('close() closes EventSource and prevents further reconnects', async () => {
    const handlers = {
      onOpen: vi.fn()
    };

    const client = new OrchestratorSSE({ debug: false });

    await client.connect('run-close', handlers);
    let instances = getInstances();
    expect(instances.length).toBe(1);

    client.close();

    // advance a long time to ensure any pending timers would fire if present
    vi.advanceTimersByTime(120_000);
    await vi.advanceTimersByTimeAsync(0);

    instances = getInstances();
    // No new instances should be created after close
    expect(instances.length).toBe(1);
  });
});
