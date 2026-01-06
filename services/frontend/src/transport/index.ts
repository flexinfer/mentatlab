/**
 * Transport Layer - Unified streaming transport with event batching
 *
 * This module provides the main entry point for connecting to streaming endpoints.
 * It combines the ConnectionManager (transport fallback) with the EventPipeline
 * (batched processing) to provide a clean, high-performance streaming interface.
 *
 * Architecture:
 *   Transport → EventPipeline → Store
 *   (WS/SSE)    (50ms batch)    (single update)
 *
 * Usage:
 *   import { createTransport, Transport } from '@/transport';
 *
 *   const transport = createTransport({
 *     onEvents: (events) => store.batchAddEvents(events),
 *     onStateChange: (state) => store.setConnectionStatus(state),
 *   });
 *
 *   await transport.connect('run-123');
 *   transport.send({ type: 'ping' });
 *   transport.disconnect();
 */

import { ConnectionManager, type ConnectionManagerConfig, type TransportType, type TransportEvent } from './connection-manager';
import { EventPipeline, type EventPipelineConfig, type EventPipelineStats } from './event-pipeline';
import type { StreamConnectionState } from '@/types/streaming';

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports
// ─────────────────────────────────────────────────────────────────────────────

export { EventPipeline, createEventPipeline } from './event-pipeline';
export type { EventPipelineConfig, EventPipelineStats } from './event-pipeline';

export { ConnectionManager, createConnectionManager } from './connection-manager';
export type { ConnectionManagerConfig, TransportType, TransportEvent } from './connection-manager';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TransportConfig {
  /** WebSocket URL template (use {runId} placeholder) */
  wsUrl?: string;
  /** SSE base URL */
  sseUrl?: string;
  /** Batch flush interval in ms (default: 50) */
  batchInterval?: number;
  /** Connection timeout in ms (default: 5000) */
  timeout?: number;
  /** Enable auto-reconnect (default: true) */
  autoReconnect?: boolean;
  /** Callback for batched events (use this for store updates) */
  onEvents: (events: TransportEvent[]) => void;
  /** Callback for individual events (optional, for logging) */
  onEvent?: (event: TransportEvent) => void;
  /** Callback for connection state changes */
  onStateChange?: (state: StreamConnectionState, transport: TransportType) => void;
  /** Callback for errors */
  onError?: (error: Error, transport: TransportType) => void;
  /** Enable debug logging */
  debug?: boolean;
}

export interface TransportState {
  status: StreamConnectionState;
  transport: TransportType;
  runId: string | null;
  connectedAt: number | null;
  pipelineStats: EventPipelineStats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport Class
// ─────────────────────────────────────────────────────────────────────────────

export class Transport {
  private config: TransportConfig;
  private pipeline: EventPipeline;
  private connection: ConnectionManager;

  constructor(config: TransportConfig) {
    this.config = config;

    // Create event pipeline
    this.pipeline = new EventPipeline({
      flushInterval: config.batchInterval ?? 50,
      onFlush: config.onEvents,
      onError: (error) => config.onError?.(error, 'none'),
      debug: config.debug,
    });

    // Create connection manager
    this.connection = new ConnectionManager({
      wsUrl: config.wsUrl,
      sseUrl: config.sseUrl,
      timeout: config.timeout,
      autoReconnect: config.autoReconnect,
      onMessage: (msg) => {
        // Optionally notify individual events
        config.onEvent?.(msg);
        // Push to pipeline for batching
        this.pipeline.push(msg);
      },
      onStateChange: config.onStateChange,
      onError: config.onError,
      debug: config.debug,
    });
  }

  /**
   * Connect to a run's event stream
   */
  async connect(runId: string): Promise<void> {
    return this.connection.connect(runId);
  }

  /**
   * Disconnect from current stream
   */
  disconnect(): void {
    // Flush any pending events before disconnecting
    this.pipeline.flush();
    this.connection.disconnect();
  }

  /**
   * Send a message (WebSocket only)
   */
  send(message: TransportEvent): boolean {
    return this.connection.send(message);
  }

  /**
   * Force flush pending events
   */
  flush(): void {
    this.pipeline.flush();
  }

  /**
   * Get current state
   */
  getState(): TransportState {
    const connState = this.connection.getState();
    return {
      status: connState.status,
      transport: connState.transport,
      runId: connState.runId,
      connectedAt: connState.connectedAt,
      pipelineStats: this.pipeline.getStats(),
    };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection.isConnected();
  }

  /**
   * Get current transport type
   */
  getTransport(): TransportType {
    return this.connection.getTransport();
  }

  /**
   * Get pipeline statistics
   */
  getPipelineStats(): EventPipelineStats {
    return this.pipeline.getStats();
  }

  /**
   * Reset pipeline statistics
   */
  resetStats(): void {
    this.pipeline.resetStats();
  }

  /**
   * Destroy transport and release resources
   */
  destroy(): void {
    this.disconnect();
    this.pipeline.destroy();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createTransport(config: TransportConfig): Transport {
  return new Transport(config);
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton for app-wide usage
// ─────────────────────────────────────────────────────────────────────────────

let globalTransport: Transport | null = null;

/**
 * Get or create the global transport instance
 */
export function getTransport(config?: TransportConfig): Transport {
  if (!globalTransport && config) {
    globalTransport = createTransport(config);
  }
  if (!globalTransport) {
    throw new Error('Transport not initialized. Call getTransport(config) first.');
  }
  return globalTransport;
}

/**
 * Initialize global transport with store integration
 */
export function initializeTransport(config: TransportConfig): Transport {
  if (globalTransport) {
    globalTransport.destroy();
  }
  globalTransport = createTransport(config);
  return globalTransport;
}

/**
 * Destroy global transport
 */
export function destroyTransport(): void {
  if (globalTransport) {
    globalTransport.destroy();
    globalTransport = null;
  }
}

export default Transport;
