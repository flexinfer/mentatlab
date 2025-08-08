// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OrchestratorSSE from '../orchestratorSSE';

// Mock base URL helper
vi.mock('../../../../config/orchestrator', () => ({
  getOrchestratorBaseUrl: () => 'http://orch.test'
}));

// Simple EventSource mock that allows tests to simulate open/error/message/named events.
// Instances are recorded on globalThis.__EventSourceInstances for inspection.
class MockEventSource {
  url: string;
  readyState: number = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  private listeners: Record<string, ((ev: any) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    this.readyState = 0;
    (globalThis as any).__EventSourceInstances = (globalThis as any).__EventSourceInstances || [];
    (globalThis as any).__EventSourceInstances.push(this);
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
    const connectPromise = client.connect('run-xyz', handlers);

    // There should be one EventSource created
    const instances = (globalThis as any).__EventSourceInstances as MockEventSource[];
    expect(instances.length).toBe(1);
    const inst = instances[0];

    // URL should start with base and include replay (default configured by class is 10)
    expect(inst.url.startsWith('http://orch.test')).toBeTruthy();
    expect(inst.url).toContain('/runs/run-xyz/events');
    // default replay is 10
    expect(inst.url).toContain('replay=10');

    // Simulate open to resolve connect()
    inst.simulateOpen();
    await connectPromise;

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

    await client.connect('run-1', handlers);

    const instances = (globalThis as any).__EventSourceInstances as MockEventSource[];
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
    let instances = (globalThis as any).__EventSourceInstances as MockEventSource[];
    expect(instances.length).toBe(1);
    const inst1 = instances[0];

    // Simulate an error that triggers scheduleReconnect
    inst1.simulateError({ code: 'E' });

    // The reconnect schedule uses backoff of 1000ms for first attempt.
    // Advance timers to trigger reconnect.
    vi.advanceTimersByTime(1000);

    // A new EventSource should have been created
    instances = (globalThis as any).__EventSourceInstances as MockEventSource[];
    expect(instances.length).toBeGreaterThanOrEqual(2);
    const inst2 = instances[instances.length - 1];

    // Simulate open on the new instance
    inst2.simulateOpen();

    // onOpen handler should have been called again (second connection)
    expect(handlers.onOpen).toHaveBeenCalled();
  });

  it('heartbeat stall triggers reconnect after 45s (HEARTBEAT_TIMEOUT_MS) and only schedules one reconnect', async () => {
    const handlers = {
      onOpen: vi.fn()
    };

    const client = new OrchestratorSSE({ debug: false });

    await client.connect('run-stall', handlers);
    let instances = (globalThis as any).__EventSourceInstances as MockEventSource[];
    expect(instances.length).toBe(1);
    const inst1 = instances[0];

    // The onopen sets lastEventAt. If we advance time beyond HEARTBEAT_TIMEOUT_MS (45s),
    // the watchdog should schedule a reconnect.
    // Advance timers by slightly more than 45s to allow the interval check to run.
    vi.advanceTimersByTime(46_000);

    // After watchdog triggers, a reconnect is scheduled -> new EventSource created after backoff.
    // Advance by first backoff (1000ms)
    vi.advanceTimersByTime(1_000);

    instances = (globalThis as any).__EventSourceInstances as MockEventSource[];
    expect(instances.length).toBeGreaterThanOrEqual(2);

    // Ensure only one reconnect timer was scheduled (idempotency): simulate a second heartbeat callback
    // by advancing another 5s and ensure instances do not explode (should not create duplicates immediately)
    const before = instances.length;
    vi.advanceTimersByTime(5_000);
    instances = (globalThis as any).__EventSourceInstances as MockEventSource[];
    expect(instances.length).toBe(before);
  });

  it('close() closes EventSource and prevents further reconnects', async () => {
    const handlers = {
      onOpen: vi.fn()
    };

    const client = new OrchestratorSSE({ debug: false });

    await client.connect('run-close', handlers);
    let instances = (globalThis as any).__EventSourceInstances as MockEventSource[];
    expect(instances.length).toBe(1);

    client.close();

    // advance a long time to ensure any pending timers would fire if present
    vi.advanceTimersByTime(120_000);

    instances = (globalThis as any).__EventSourceInstances as MockEventSource[];
    // No new instances should be created after close
    expect(instances.length).toBe(1);
  });
});