import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from '../connection-manager';
import { StreamConnectionState } from '@/types/streaming';

const { sseConnectMock } = vi.hoisted(() => ({
  sseConnectMock: vi.fn(),
}));

vi.mock('@/services/api/streaming/orchestratorSSE', () => ({
  OrchestratorSSE: class {
    connect = sseConnectMock;
    close = vi.fn();
  },
}));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // Simulate a backend-down handshake failure after handlers are registered.
    queueMicrotask(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.triggerError();
      }
    });
  }

  send = vi.fn();

  close = vi.fn((code?: number, reason?: string) => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({
      code: code ?? 1000,
      reason: reason ?? '',
      wasClean: true,
    } as CloseEvent);
  });

  triggerError(): void {
    this.onerror?.(new Event('error'));
  }
}

function reconnectDelays(setTimeoutSpy: ReturnType<typeof vi.spyOn>): number[] {
  return setTimeoutSpy.mock.calls
    .map((call) => call[1])
    .filter((delay): delay is number => typeof delay === 'number' && delay >= 1000);
}

describe('ConnectionManager reconnect loop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    MockWebSocket.instances = [];
    sseConnectMock.mockReset();
    sseConnectMock.mockRejectedValue(new Error('SSE unavailable'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps reconnecting with exponential backoff when reconnect attempts fail', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const manager = new ConnectionManager({
      timeout: 100,
      autoReconnect: true,
      initialBackoffMs: 1000,
      maxBackoffMs: 30_000,
      maxReconnectAttempts: 3,
      onMessage: vi.fn(),
    });

    const firstConnect = manager.connect('run-1');
    expect(MockWebSocket.instances).toHaveLength(1);
    await Promise.resolve();
    await firstConnect;

    expect(manager.getState().status).toBe(StreamConnectionState.RECONNECTING);
    expect(reconnectDelays(setTimeoutSpy)).toEqual([1000]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(manager.getState().reconnectAttempts).toBe(1);
    expect(MockWebSocket.instances).toHaveLength(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.getState().status).toBe(StreamConnectionState.RECONNECTING);
    expect(reconnectDelays(setTimeoutSpy)).toEqual([1000, 2000]);
  });

  it('stops reconnecting after max reconnect attempts are exhausted', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const manager = new ConnectionManager({
      timeout: 100,
      autoReconnect: true,
      initialBackoffMs: 1000,
      maxBackoffMs: 30_000,
      maxReconnectAttempts: 1,
      onMessage: vi.fn(),
    });

    const firstConnect = manager.connect('run-1');
    expect(MockWebSocket.instances).toHaveLength(1);
    await Promise.resolve();
    await firstConnect;

    expect(reconnectDelays(setTimeoutSpy)).toEqual([1000]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(MockWebSocket.instances).toHaveLength(2);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.getState().status).toBe(StreamConnectionState.ERROR);
    expect(reconnectDelays(setTimeoutSpy)).toEqual([1000]);
  });
});
