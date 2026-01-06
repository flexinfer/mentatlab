/**
 * Connection Manager - Unified transport with automatic fallback
 *
 * Provides a single interface for connecting to streaming endpoints with
 * automatic fallback between transport types:
 *   1. WebSocket (preferred for bidirectional, low latency)
 *   2. SSE (fallback for environments where WS is blocked)
 *   3. Simulation (development fallback when no backend)
 *
 * Usage:
 *   const manager = new ConnectionManager({
 *     wsUrl: 'ws://localhost:8080/ws',
 *     sseUrl: 'http://localhost:7070/runs/{runId}/events',
 *     onMessage: (msg) => pipeline.push(msg),
 *     onStateChange: (state) => store.setConnectionStatus(state),
 *   });
 *
 *   await manager.connect('run-123');
 *   manager.send({ type: 'ping' });
 *   manager.disconnect();
 */

import { StreamConnectionState } from '@/types/streaming';
import { OrchestratorSSE, type OrchestratorSSEHandlers } from '@/services/api/streaming/orchestratorSSE';
import { getOrchestratorBaseUrl, getGatewayBaseUrl } from '@/config/orchestrator';
import { isSimFallbackEnabled } from '@/config/features';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TransportType = 'websocket' | 'sse' | 'simulation' | 'none';

/** Generic event shape for transport-level messages (looser than StreamingMessage) */
export interface TransportEvent {
  id?: string;
  type: string;
  timestamp?: string;
  agent_id?: string;
  [key: string]: unknown;
}

export interface ConnectionManagerConfig {
  /** WebSocket URL template (use {runId} placeholder) */
  wsUrl?: string;
  /** SSE URL (base URL, runId appended) */
  sseUrl?: string;
  /** Connection timeout in ms (default: 5000) */
  timeout?: number;
  /** Enable auto-reconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnect attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Reconnect delay sequence in ms */
  reconnectDelays?: number[];
  /** Callback for incoming messages */
  onMessage: (message: TransportEvent) => void;
  /** Callback for connection state changes */
  onStateChange?: (state: StreamConnectionState, transport: TransportType) => void;
  /** Callback for errors */
  onError?: (error: Error, transport: TransportType) => void;
  /** Enable debug logging */
  debug?: boolean;
}

export interface ConnectionState {
  status: StreamConnectionState;
  transport: TransportType;
  runId: string | null;
  connectedAt: number | null;
  reconnectAttempts: number;
  lastError: Error | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection Manager
// ─────────────────────────────────────────────────────────────────────────────

export class ConnectionManager {
  private config: Required<Omit<ConnectionManagerConfig, 'onStateChange' | 'onError'>> &
    Pick<ConnectionManagerConfig, 'onStateChange' | 'onError'>;

  private state: ConnectionState = {
    status: StreamConnectionState.DISCONNECTED,
    transport: 'none',
    runId: null,
    connectedAt: null,
    reconnectAttempts: 0,
    lastError: null,
  };

  // Transport instances
  private ws: WebSocket | null = null;
  private sse: OrchestratorSSE | null = null;
  private simIntervalId: ReturnType<typeof setInterval> | null = null;

  // Reconnection
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isManualDisconnect = false;

  constructor(config: ConnectionManagerConfig) {
    this.config = {
      wsUrl: config.wsUrl ?? `${getGatewayBaseUrl().replace(/^http/, 'ws')}/ws`,
      sseUrl: config.sseUrl ?? getOrchestratorBaseUrl(),
      timeout: config.timeout ?? 5000,
      autoReconnect: config.autoReconnect ?? true,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      reconnectDelays: config.reconnectDelays ?? [1000, 2000, 5000, 10000, 30000],
      onMessage: config.onMessage,
      onStateChange: config.onStateChange,
      onError: config.onError,
      debug: config.debug ?? false,
    };
  }

  /**
   * Connect to a run's event stream
   */
  async connect(runId: string): Promise<void> {
    if (this.state.status === StreamConnectionState.CONNECTED && this.state.runId === runId) {
      this.log('Already connected to this run');
      return;
    }

    // Disconnect existing connection
    this.disconnect();

    this.state.runId = runId;
    this.state.reconnectAttempts = 0;
    this.isManualDisconnect = false;

    this.setStatus(StreamConnectionState.CONNECTING, 'none');

    // Try transports in order: WS → SSE → Simulation
    try {
      await this.tryWebSocket(runId);
      return;
    } catch (wsError) {
      this.log('WebSocket failed, trying SSE:', wsError);
    }

    try {
      await this.trySSE(runId);
      return;
    } catch (sseError) {
      this.log('SSE failed:', sseError);
    }

    // Fallback to simulation if enabled
    if (isSimFallbackEnabled()) {
      this.startSimulation(runId);
      return;
    }

    // All transports failed
    this.setStatus(StreamConnectionState.ERROR, 'none');
    this.state.lastError = new Error('All transports failed');
    this.config.onError?.(this.state.lastError, 'none');
  }

  /**
   * Disconnect from current stream
   */
  disconnect(): void {
    this.isManualDisconnect = true;
    this.clearReconnectTimeout();

    // Close WebSocket
    if (this.ws) {
      try {
        this.ws.close(1000, 'Client disconnect');
      } catch {
        // Ignore
      }
      this.ws = null;
    }

    // Close SSE
    if (this.sse) {
      try {
        this.sse.close();
      } catch {
        // Ignore
      }
      this.sse = null;
    }

    // Stop simulation
    if (this.simIntervalId) {
      clearInterval(this.simIntervalId);
      this.simIntervalId = null;
    }

    this.setStatus(StreamConnectionState.DISCONNECTED, 'none');
    this.state.runId = null;
    this.state.connectedAt = null;
  }

  /**
   * Send a message (WebSocket only)
   */
  send(message: TransportEvent): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('Cannot send: WebSocket not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.log('Send error:', error);
      return false;
    }
  }

  /**
   * Get current connection state
   */
  getState(): Readonly<ConnectionState> {
    return { ...this.state };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state.status === StreamConnectionState.CONNECTED;
  }

  /**
   * Get current transport type
   */
  getTransport(): TransportType {
    return this.state.transport;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: WebSocket
  // ─────────────────────────────────────────────────────────────────────────

  private tryWebSocket(runId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.config.wsUrl.replace('{runId}', runId);
      this.log('Connecting WebSocket:', url);

      const timeoutId = setTimeout(() => {
        if (this.ws?.readyState === WebSocket.CONNECTING) {
          this.ws.close();
          reject(new Error('WebSocket connection timeout'));
        }
      }, this.config.timeout);

      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          clearTimeout(timeoutId);
          this.setStatus(StreamConnectionState.CONNECTED, 'websocket');
          this.state.connectedAt = Date.now();
          this.log('WebSocket connected');

          // Send initial heartbeat/subscription message
          const subscribeMsg: TransportEvent = {
            id: crypto.randomUUID(),
            type: 'heartbeat',
            timestamp: new Date().toISOString(),
            agent_id: 'webui',
          };
          this.send(subscribeMsg);

          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as TransportEvent;
            this.config.onMessage(data);
          } catch (error) {
            this.log('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onerror = () => {
          clearTimeout(timeoutId);
          const error = new Error('WebSocket error');
          this.state.lastError = error;
          this.config.onError?.(error, 'websocket');
          reject(error);
        };

        this.ws.onclose = (event) => {
          clearTimeout(timeoutId);
          this.log('WebSocket closed:', event.code, event.reason);

          if (this.state.transport === 'websocket') {
            this.setStatus(StreamConnectionState.DISCONNECTED, 'none');

            if (!this.isManualDisconnect && this.config.autoReconnect) {
              this.scheduleReconnect();
            }
          }
        };
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: SSE
  // ─────────────────────────────────────────────────────────────────────────

  private trySSE(runId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log('Connecting SSE for run:', runId);

      const timeoutId = setTimeout(() => {
        reject(new Error('SSE connection timeout'));
      }, this.config.timeout);

      this.sse = new OrchestratorSSE({
        baseUrl: this.config.sseUrl,
        debug: this.config.debug,
      });

      const handlers: OrchestratorSSEHandlers = {
        onOpen: () => {
          clearTimeout(timeoutId);
          this.setStatus(StreamConnectionState.CONNECTED, 'sse');
          this.state.connectedAt = Date.now();
          this.log('SSE connected');
          resolve();
        },
        onRaw: (event) => {
          // Convert orchestrator event to transport event format
          const transportEvent: TransportEvent = {
            id: crypto.randomUUID(),
            type: event.type,
            timestamp: new Date().toISOString(),
            agent_id: 'orchestrator',
            data: event.data,
          };
          this.config.onMessage(transportEvent);
        },
        onError: (err) => {
          clearTimeout(timeoutId);
          const error = err instanceof Error ? err : new Error('SSE error');
          this.state.lastError = error;
          this.config.onError?.(error, 'sse');

          if (this.state.transport === 'sse') {
            this.setStatus(StreamConnectionState.ERROR, 'sse');

            if (!this.isManualDisconnect && this.config.autoReconnect) {
              this.scheduleReconnect();
            }
          }

          reject(error);
        },
      };

      this.sse.connect(runId, handlers).catch(reject);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Simulation
  // ─────────────────────────────────────────────────────────────────────────

  private startSimulation(runId: string): void {
    this.log('Starting simulation mode for run:', runId);
    this.setStatus(StreamConnectionState.CONNECTED, 'simulation');
    this.state.connectedAt = Date.now();

    let eventIndex = 0;
    const simulatedEvents: TransportEvent[] = [
      { type: 'hello', runId, server_time: new Date().toISOString() },
      { type: 'status', runId, status: 'running' },
      { type: 'log', run_id: runId, level: 'info', message: 'Simulation started' },
      { type: 'node_status', run_id: runId, node_id: 'node-1', state: 'running' },
      { type: 'progress', run_id: runId, current: 1, total: 3 },
      { type: 'log', run_id: runId, level: 'info', message: 'Processing node-1...' },
      { type: 'node_status', run_id: runId, node_id: 'node-1', state: 'succeeded' },
      { type: 'progress', run_id: runId, current: 2, total: 3 },
      { type: 'node_status', run_id: runId, node_id: 'node-2', state: 'running' },
      { type: 'log', run_id: runId, level: 'info', message: 'Processing node-2...' },
      { type: 'node_status', run_id: runId, node_id: 'node-2', state: 'succeeded' },
      { type: 'progress', run_id: runId, current: 3, total: 3 },
      { type: 'status', runId, status: 'succeeded' },
    ];

    this.simIntervalId = setInterval(() => {
      if (eventIndex < simulatedEvents.length) {
        const event = simulatedEvents[eventIndex];
        if (event) {
          const transportEvent: TransportEvent = {
            ...event,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            agent_id: 'simulation',
          };
          this.config.onMessage(transportEvent);
        }
        eventIndex++;
      } else {
        // Stop simulation when done
        if (this.simIntervalId) {
          clearInterval(this.simIntervalId);
          this.simIntervalId = null;
        }
      }
    }, 500);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Reconnection
  // ─────────────────────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.state.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.log('Max reconnect attempts reached');
      this.setStatus(StreamConnectionState.ERROR, 'none');
      return;
    }

    const delay = this.config.reconnectDelays[
      Math.min(this.state.reconnectAttempts, this.config.reconnectDelays.length - 1)
    ] ?? 30000;

    this.log(`Scheduling reconnect in ${delay}ms (attempt ${this.state.reconnectAttempts + 1})`);
    this.setStatus(StreamConnectionState.RECONNECTING, this.state.transport);

    this.reconnectTimeoutId = setTimeout(() => {
      this.state.reconnectAttempts++;
      if (this.state.runId) {
        this.connect(this.state.runId);
      }
    }, delay);
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private setStatus(status: StreamConnectionState, transport: TransportType): void {
    const changed = this.state.status !== status || this.state.transport !== transport;
    this.state.status = status;
    this.state.transport = transport;

    if (changed) {
      this.config.onStateChange?.(status, transport);
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.debug('[ConnectionManager]', ...args);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createConnectionManager(config: ConnectionManagerConfig): ConnectionManager {
  return new ConnectionManager(config);
}

export default ConnectionManager;
