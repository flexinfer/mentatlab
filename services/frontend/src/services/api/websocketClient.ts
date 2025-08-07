/**
 * Enhanced WebSocket client with automatic reconnection and SSE fallback
 * Supports multimodal streaming with <100ms latency
 */

import { FeatureFlags } from '../../config/features';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface WebSocketConfig {
  url: string;
  protocols?: string[];
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  enableSSEFallback?: boolean;
  sseUrl?: string;
  debug?: boolean;
}

export interface StreamMessage {
  id: string;
  type: string;
  data: any;
  timestamp: string;
  sequence?: number;
}

export type MessageHandler = (message: StreamMessage) => void;
export type StatusHandler = (status: ConnectionStatus) => void;
export type ErrorHandler = (error: Error) => void;

export class WebSocketClient {
  public config: Required<WebSocketConfig>;
  private ws: WebSocket | null = null;
  private sse: EventSource | null = null;
  private status: ConnectionStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private messageHandlers = new Set<MessageHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private errorHandlers = new Set<ErrorHandler>();
  private messageQueue: any[] = [];
  private isManualClose = false;
  private lastSequence = 0;
  private useSSE = false;

  constructor(config: WebSocketConfig) {
    this.config = {
      protocols: [],
      reconnect: true,
      reconnectInterval: 1000,
      maxReconnectAttempts: 5,
      heartbeatInterval: 30000,
      enableSSEFallback: true,
      sseUrl: config.url.replace('ws://', 'http://').replace('wss://', 'https://') + '/sse',
      debug: false,
      ...config,
    };
  }

  /**
   * Connect to WebSocket or SSE
   */
  async connect(): Promise<void> {
    if (this.status === 'connected' || this.status === 'connecting') {
      return;
    }

    this.isManualClose = false;
    this.setStatus('connecting');

    try {
      if (!this.useSSE) {
        await this.connectWebSocket();
      } else {
        await this.connectSSE();
      }
    } catch (error) {
      console.error('Connection failed:', error);
      
      // Try SSE fallback if WebSocket fails
      if (!this.useSSE && this.config.enableSSEFallback) {
        console.log('Falling back to SSE...');
        this.useSSE = true;
        await this.connectSSE();
      } else {
        this.handleError(error as Error);
        throw error;
      }
    }
  }

  /**
   * Disconnect from WebSocket or SSE
   */
  disconnect(): void {
    this.isManualClose = true;
    this.cleanup();
    this.setStatus('disconnected');
  }

  /**
   * Send message (WebSocket only)
   */
  send(data: any): boolean {
    if (this.useSSE) {
      console.warn('Cannot send messages over SSE connection');
      return false;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(data));
        return true;
      } catch (error) {
        this.handleError(error as Error);
        return false;
      }
    }

    // Queue message if not connected
    if (this.config.reconnect) {
      this.messageQueue.push(data);
      return true;
    }

    return false;
  }

  /**
   * Add message handler
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Add status handler
   */
  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    handler(this.status); // Send current status immediately
    return () => this.statusHandlers.delete(handler);
  }

  /**
   * Add error handler
   */
  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Get connection latency (WebSocket only)
   */
  async getLatency(): Promise<number | null> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return null;
    }

    const start = performance.now();
    
    return new Promise((resolve) => {
      const pingId = Math.random().toString(36);
      const timeout = setTimeout(() => resolve(null), 5000);
      
      const handler = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'pong' && message.id === pingId) {
            clearTimeout(timeout);
            resolve(performance.now() - start);
          }
        } catch {}
      };
      
      this.ws!.addEventListener('message', handler, { once: true });
      this.send({ type: 'ping', id: pingId });
    });
  }

  /**
   * Connect via WebSocket
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url, this.config.protocols);
        
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
          this.ws?.close();
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          if (this.config.debug) console.log('WebSocket connected');
          this.setStatus('connected');
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.flushMessageQueue();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleWebSocketMessage(event);
        };

        this.ws.onerror = (event) => {
          clearTimeout(timeout);
          const error = new Error('WebSocket error');
          this.handleError(error);
          reject(error);
        };

        this.ws.onclose = (event) => {
          if (this.config.debug) console.log('WebSocket closed:', event.code, event.reason);
          this.cleanup();
          
          if (!this.isManualClose && this.config.reconnect) {
            this.scheduleReconnect();
          } else {
            this.setStatus('disconnected');
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Connect via SSE
   */
  private async connectSSE(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.sse = new EventSource(this.config.sseUrl!);
        
        const timeout = setTimeout(() => {
          reject(new Error('SSE connection timeout'));
          this.sse?.close();
        }, 10000);

        this.sse.onopen = () => {
          clearTimeout(timeout);
          if (this.config.debug) console.log('SSE connected');
          this.setStatus('connected');
          this.reconnectAttempts = 0;
          resolve();
        };

        this.sse.onmessage = (event) => {
          this.handleSSEMessage(event);
        };

        this.sse.onerror = (event) => {
          clearTimeout(timeout);
          const error = new Error('SSE error');
          this.handleError(error);
          
          if (this.sse?.readyState === EventSource.CLOSED) {
            this.cleanup();
            
            if (!this.isManualClose && this.config.reconnect) {
              this.scheduleReconnect();
            } else {
              this.setStatus('disconnected');
            }
          }
          
          reject(error);
        };

        // Listen for specific event types
        this.sse.addEventListener('stream', (event) => {
          this.handleSSEMessage(event);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle WebSocket message
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      this.processMessage(message);
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
      this.handleError(error as Error);
    }
  }

  /**
   * Handle SSE message
   */
  private handleSSEMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data);
      this.processMessage(message);
    } catch (error) {
      console.error('Failed to parse SSE message:', error);
      this.handleError(error as Error);
    }
  }

  /**
   * Process incoming message
   */
  private processMessage(data: any): void {
    // Check for heartbeat/ping messages
    if (data.type === 'ping') {
      if (this.ws) {
        this.send({ type: 'pong', id: data.id });
      }
      return;
    }

    // Create stream message
    const message: StreamMessage = {
      id: data.id || Math.random().toString(36),
      type: data.type || 'data',
      data: data.data || data,
      timestamp: data.timestamp || new Date().toISOString(),
      sequence: data.sequence || ++this.lastSequence,
    };

    // Notify handlers
    this.messageHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    });
  }

  /**
   * Set connection status
   */
  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    
    this.status = status;
    
    this.statusHandlers.forEach(handler => {
      try {
        handler(status);
      } catch (error) {
        console.error('Error in status handler:', error);
      }
    });
  }

  /**
   * Handle errors
   */
  private handleError(error: Error): void {
    this.setStatus('error');
    
    this.errorHandlers.forEach(handler => {
      try {
        handler(error);
      } catch (err) {
        console.error('Error in error handler:', err);
      }
    });
  }

  /**
   * Schedule reconnection
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      this.setStatus('disconnected');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
    
    if (this.config.debug) {
      console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    }

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(console.error);
    }, delay);
  }

  /**
   * Start heartbeat
   */
  private startHeartbeat(): void {
    if (!this.config.heartbeatInterval) return;

    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', timestamp: Date.now() });
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Flush message queue
   */
  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
  }
}

// Export singleton instance for convenience
export const websocketClient = new WebSocketClient({
  url: import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws',
  debug: import.meta.env.DEV
});

export default websocketClient;