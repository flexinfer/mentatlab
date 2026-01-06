/**
 * useStreamingTransport - Hook to connect transport layer to streaming store
 *
 * This hook provides a clean interface for components to manage streaming connections.
 * It handles:
 * - Transport initialization with store callbacks
 * - Event batching (via transport layer)
 * - Connection state synchronization
 * - Type conversion from TransportEvent to StreamingMessage
 *
 * Usage:
 *   const { connect, disconnect, isConnected, connectionStatus, transportType } = useStreamingTransport();
 *
 *   // Connect to a run
 *   await connect('run-123');
 *
 *   // Check status
 *   if (isConnected) {
 *     console.log(`Connected via ${transportType}`);
 *   }
 *
 *   // Disconnect
 *   disconnect();
 */

import { useCallback, useEffect, useRef, useMemo } from 'react';
import { useStreamingStore } from '@/stores';
import {
  initializeTransport,
  destroyTransport,
  getTransport,
  type TransportEvent,
  type TransportType,
} from '@/transport';
import type { StreamingMessage, StreamConnectionState } from '@/types/streaming';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface UseStreamingTransportOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Auto-connect on mount */
  autoConnect?: string | null;
  /** Batch interval override (default: 50ms) */
  batchInterval?: number;
}

export interface UseStreamingTransportReturn {
  /** Connect to a run's event stream */
  connect: (runId: string) => Promise<void>;
  /** Disconnect from current stream */
  disconnect: () => void;
  /** Send a message (WebSocket only) */
  send: (message: TransportEvent) => boolean;
  /** Current connection status */
  connectionStatus: StreamConnectionState;
  /** Whether currently connected */
  isConnected: boolean;
  /** Current transport type */
  transportType: TransportType;
  /** Pipeline statistics */
  stats: {
    totalReceived: number;
    totalFlushed: number;
    averageBatchSize: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a TransportEvent to a StreamingMessage
 * TransportEvent is loose, StreamingMessage has stricter requirements
 */
function toStreamingMessage(event: TransportEvent): StreamingMessage | null {
  // Ensure required base fields exist
  if (!event.type) {
    return null;
  }

  // Build a StreamingMessage with safe defaults
  // The actual message type depends on event.type
  const baseMessage = {
    id: event.id ?? crypto.randomUUID(),
    type: event.type,
    timestamp: event.timestamp ?? new Date().toISOString(),
    agent_id: event.agent_id ?? 'unknown',
    stream_id: (event.stream_id as string) ?? (event.run_id as string) ?? 'default',
  };

  // Pass through the full event with required fields merged
  return {
    ...event,
    ...baseMessage,
  } as StreamingMessage;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useStreamingTransport(
  options: UseStreamingTransportOptions = {}
): UseStreamingTransportReturn {
  const { debug = false, autoConnect = null, batchInterval = 50 } = options;

  // Store actions
  const {
    createSession,
    closeSession,
    addSessionMessage,
    setConnectionStatus,
  } = useStreamingStore();

  // Store selectors
  const connectionStatus = useStreamingStore((state) => state.connectionStatus);
  const activeSessionId = useStreamingStore((state) => state.activeSessionId);

  // Track initialization
  const initializedRef = useRef(false);
  const currentRunIdRef = useRef<string | null>(null);

  // Initialize transport on mount
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    if (debug) {
      console.debug('[useStreamingTransport] Initializing transport');
    }

    initializeTransport({
      batchInterval,
      debug,
      onEvents: (events: TransportEvent[]) => {
        if (debug) {
          console.debug(`[useStreamingTransport] Received ${events.length} events`);
        }

        // Convert and dispatch each event
        const runId = currentRunIdRef.current;
        if (!runId) return;

        for (const event of events) {
          const message = toStreamingMessage(event);
          if (message) {
            addSessionMessage(runId, message);
          }
        }
      },
      onStateChange: (state: StreamConnectionState, transport: TransportType) => {
        if (debug) {
          console.debug(`[useStreamingTransport] State change: ${state} (${transport})`);
        }
        setConnectionStatus(state);
      },
      onError: (error: Error, transport: TransportType) => {
        console.error(`[useStreamingTransport] Error (${transport}):`, error);
      },
    });

    // Cleanup on unmount
    return () => {
      if (debug) {
        console.debug('[useStreamingTransport] Destroying transport');
      }
      destroyTransport();
      initializedRef.current = false;
    };
  }, [debug, batchInterval, addSessionMessage, setConnectionStatus]);

  // Auto-connect
  useEffect(() => {
    if (autoConnect && initializedRef.current) {
      connect(autoConnect);
    }
  }, [autoConnect]);

  // Connect to a run
  const connect = useCallback(async (runId: string): Promise<void> => {
    if (debug) {
      console.debug(`[useStreamingTransport] Connecting to run: ${runId}`);
    }

    // Create session in store
    createSession(runId, runId);
    currentRunIdRef.current = runId;

    // Connect transport
    try {
      const transport = getTransport();
      await transport.connect(runId);
    } catch (error) {
      console.error('[useStreamingTransport] Connect failed:', error);
      closeSession(runId);
      currentRunIdRef.current = null;
      throw error;
    }
  }, [debug, createSession, closeSession]);

  // Disconnect
  const disconnect = useCallback((): void => {
    if (debug) {
      console.debug('[useStreamingTransport] Disconnecting');
    }

    try {
      const transport = getTransport();
      transport.disconnect();
    } catch {
      // Transport may not be initialized
    }

    if (currentRunIdRef.current) {
      closeSession(currentRunIdRef.current);
      currentRunIdRef.current = null;
    }
  }, [debug, closeSession]);

  // Send message
  const send = useCallback((message: TransportEvent): boolean => {
    try {
      const transport = getTransport();
      return transport.send(message);
    } catch {
      return false;
    }
  }, []);

  // Derived state
  const isConnected = connectionStatus === 'connected';

  // Get transport info
  const transportInfo = useMemo(() => {
    try {
      const transport = getTransport();
      return {
        type: transport.getTransport(),
        stats: transport.getPipelineStats(),
      };
    } catch {
      return {
        type: 'none' as TransportType,
        stats: {
          totalReceived: 0,
          totalFlushed: 0,
          flushCount: 0,
          bufferSize: 0,
          lastFlushAt: null,
          averageBatchSize: 0,
        },
      };
    }
  }, [connectionStatus]); // Re-compute when connection changes

  return {
    connect,
    disconnect,
    send,
    connectionStatus,
    isConnected,
    transportType: transportInfo.type,
    stats: {
      totalReceived: transportInfo.stats.totalReceived,
      totalFlushed: transportInfo.stats.totalFlushed,
      averageBatchSize: transportInfo.stats.averageBatchSize,
    },
  };
}

export default useStreamingTransport;
