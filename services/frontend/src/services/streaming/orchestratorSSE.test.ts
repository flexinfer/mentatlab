import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeRunEvents } from './orchestratorSSE';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  readyState = 1;
  onopen: ((e?: any) => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
}

describe('subscribeRunEvents (native EventSource)', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource as any);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const opts = (extra: any = {}) => ({
    baseUrl: 'http://gw.test',
    transport: 'native' as const,
    onEvent: vi.fn(),
    ...extra,
  });

  it('opens an EventSource at the run events URL', () => {
    subscribeRunEvents('run1', opts());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain('/api/v1/runs/run1/events');
    expect(MockEventSource.instances[0].url).toContain('gw.test');
  });

  it('delivers parsed events to onEvent and calls onOpen', () => {
    const onEvent = vi.fn();
    const onOpen = vi.fn();
    subscribeRunEvents('run1', opts({ onEvent, onOpen }));
    const es = MockEventSource.instances[0];

    es.onopen?.();
    expect(onOpen).toHaveBeenCalledOnce();

    es.onmessage?.({ data: JSON.stringify({ type: 'log', m: 1 }), lastEventId: '5' });
    expect(onEvent).toHaveBeenCalledOnce();
    const [, parsed] = onEvent.mock.calls[0];
    expect(parsed).toEqual({ type: 'log', m: 1 });
  });

  it('reconnects with backoff after an error, resuming from lastEventId', () => {
    const onError = vi.fn();
    subscribeRunEvents('run1', opts({ onError }));
    const first = MockEventSource.instances[0];

    // see an event so the client records a lastEventId to resume from
    first.onmessage?.({ data: '{}', lastEventId: '7' });
    first.onerror?.(new Error('drop'));
    expect(onError).toHaveBeenCalled();
    expect(first.closed).toBe(true);

    // first backoff is 1000ms; before that, no new connection
    expect(MockEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1000);

    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].url).toContain('fromId=7');
  });

  it('close() stops reconnection and closes the connection', () => {
    const handle = subscribeRunEvents('run1', opts());
    const first = MockEventSource.instances[0];

    handle.close();
    expect(first.closed).toBe(true);

    // an error after close must not schedule a reconnect
    first.onerror?.(new Error('late'));
    vi.advanceTimersByTime(60_000);
    expect(MockEventSource.instances).toHaveLength(1);
  });
});
