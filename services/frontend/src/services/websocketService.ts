/**
 * @deprecated This WebSocket service is deprecated. Use streamingService from
 * './streamingService.ts' for real-time communication instead.
 * This service will be removed in a future version.
 *
 * Migration Guide:
 * - Replace getWebSocketService() with streamingService for real-time communication
 * - Use StreamingCanvas, StreamingConsole, and StreamingControls for UI components
 * - The new streaming service provides better performance and more reliable connections
 */

import { CursorPosition, WorkflowChange, CollaborationEvent } from '../types/collaboration';

export interface WebSocketMessage {
  event_type: string;
  payload: {
    node_id: string;
    [key: string]: any;
  };
  timestamp: string;
}

export interface WebSocketConfig {
  url: string;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
  heartbeatInterval?: number;
}

export type WebSocketEventHandler = (message: WebSocketMessage) => void;
export type ConnectionStateHandler = (state: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
export type CursorUpdateHandler = (position: CursorPosition) => void;
export type WorkflowStateChangeHandler = (changes: WorkflowChange[]) => void;

/**
 * @deprecated Use streamingService instead for real-time communication
 */
export class WebSocketService {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private reconnectAttempts = 0;
  private reconnectTimeoutId: number | null = null;
  private heartbeatIntervalId: number | null = null;
  private messageHandlers: Set<WebSocketEventHandler> = new Set();
  private stateHandlers: Set<ConnectionStateHandler> = new Set();
  private cursorUpdateHandlers: Set<CursorUpdateHandler> = new Set();
  private workflowStateChangeHandlers: Set<WorkflowStateChangeHandler> = new Set();
  private isManuallyDisconnected = false;

  constructor(config: WebSocketConfig) {
    this.config = {
      maxReconnectAttempts: 5,
      reconnectInterval: 3000,
      heartbeatInterval: 30000,
      ...config,
    };
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.isManuallyDisconnected = false;
      this.setState('connecting');

      try {
        this.ws = new WebSocket(this.config.url);
        
        this.ws.onopen = () => {
          console.log('WebSocket connected successfully');
          this.reconnectAttempts = 0;
          this.setState('connected');
          this.startHeartbeat();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket connection closed:', event.code, event.reason);
          this.stopHeartbeat();
          
          if (!this.isManuallyDisconnected) {
            this.setState('disconnected');
            this.handleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.setState('error');
          
          // If this is the initial connection attempt, reject the promise
          if (this.reconnectAttempts === 0) {
            reject(new Error('Failed to establish WebSocket connection'));
          }
        };

      } catch (error) {
        console.error('Failed to create WebSocket:', error);
        this.setState('error');
        reject(error);
      }
    });
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    this.isManuallyDisconnected = true;
    this.clearReconnectTimeout();
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
    }

    this.setState('disconnected');
  }

  /**
   * Send message to server
   */
  send(message: any): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch (error) {
        console.error('Failed to send WebSocket message:', error);
        return false;
      }
    }
    return false;
  }

  /**
   * Add message handler
   */
  onMessage(handler: WebSocketEventHandler): () => void {
    this.messageHandlers.add(handler);
    
    // Return cleanup function
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Add connection state handler
   */
  onStateChange(handler: ConnectionStateHandler): () => void {
    this.stateHandlers.add(handler);
    
    // Return cleanup function
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  /**
   * Get current connection state
   */
  getState(): 'connecting' | 'connected' | 'disconnected' | 'error' {
    if (!this.ws) return 'disconnected';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
        return 'disconnected';
      default:
        return 'error';
    }
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const parsedData: any = JSON.parse(event.data);
      
      // Check if it's a collaboration event
      if (parsedData.type && parsedData.payload) {
        const collaborationMessage: CollaborationEvent = parsedData;
        if (collaborationMessage.type === 'user_cursor_updated') {
          this.cursorUpdateHandlers.forEach(handler => {
            try {
              handler(collaborationMessage.payload as CursorPosition);
            } catch (error) {
              console.error('Error in cursor update handler:', error);
            }
          });
        } else if (collaborationMessage.type === 'workflow_state_changed') {
          this.workflowStateChangeHandlers.forEach(handler => {
            try {
              handler(collaborationMessage.payload as WorkflowChange[]);
            } catch (error) {
              console.error('Error in workflow state change handler:', error);
            }
          });
        }
      }

      // Also notify general message handlers for all messages (including collaboration ones if needed elsewhere)
      // Or, if WebSocketMessage is only for non-collaboration events, filter here.
      // For now, assuming general handlers might also process these, or they are distinct.
      // If the original WebSocketMessage structure is still used for other events,
      // we need to ensure it's handled correctly.
      // For simplicity, let's assume if 'type' exists, it's a collaboration event,
      // otherwise, it's an old-style WebSocketMessage.
      if (parsedData.event_type && parsedData.payload) {
        const message: WebSocketMessage = parsedData;
        this.messageHandlers.forEach(handler => {
          try {
            handler(message);
          } catch (error) {
            console.error('Error in WebSocket message handler:', error);
          }
        });
      } else if (!parsedData.type) { // If it's neither a new collaboration event nor an old WebSocketMessage
        console.warn('Unknown WebSocket message format:', parsedData);
      }

    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Handle reconnection logic
   */
  private handleReconnect(): void {
    if (this.isManuallyDisconnected || this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.log('Max reconnection attempts reached or manually disconnected');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectInterval * Math.pow(1.5, this.reconnectAttempts - 1); // Exponential backoff

    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.config.maxReconnectAttempts}) in ${delay}ms`);
    
    this.reconnectTimeoutId = window.setTimeout(() => {
      this.connect().catch(error => {
        console.error('Reconnection attempt failed:', error);
      });
    }, delay);
  }

  /**
   * Clear reconnection timeout
   */
  private clearReconnectTimeout(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatIntervalId = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', timestamp: new Date().toISOString() });
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  /**
   * Notify state change handlers
   */
  private setState(state: 'connecting' | 'connected' | 'disconnected' | 'error'): void {
    this.stateHandlers.forEach(handler => {
      try {
        handler(state);
      } catch (error) {
        console.error('Error in WebSocket state handler:', error);
      }
    });
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.disconnect();
    this.messageHandlers.clear();
    this.stateHandlers.clear();
    this.cursorUpdateHandlers.clear();
    this.workflowStateChangeHandlers.clear();
  }

  /**
   * Send cursor position to server
   */
  sendCursorPosition(position: CursorPosition): boolean {
    return this.send({
      type: 'cursor_position_update',
      payload: position,
    });
  }

  /**
   * Send workflow changes to server
   */
  sendWorkflowChanges(changes: WorkflowChange[]): boolean {
    return this.send({
      type: 'workflow_changes',
      payload: changes,
    });
  }

  /**
   * Add handler for incoming cursor updates
   */
  onCursorUpdate(handler: CursorUpdateHandler): () => void {
    this.cursorUpdateHandlers.add(handler);
    return () => {
      this.cursorUpdateHandlers.delete(handler);
    };
  }

  /**
   * Add handler for incoming workflow state changes
   */
  onWorkflowStateChange(handler: WorkflowStateChangeHandler): () => void {
    this.workflowStateChangeHandlers.add(handler);
    return () => {
      this.workflowStateChangeHandlers.delete(handler);
    };
  }
}

// Singleton instance for global use
let globalWebSocketService: WebSocketService | null = null;

/**
 * @deprecated Use streamingService instead for real-time communication
 */
export const getWebSocketService = (): WebSocketService => {
  if (!globalWebSocketService) {
    globalWebSocketService = new WebSocketService({
      url: 'ws://localhost:8000/ws/orchestrator-events',
    });
  }
  
  // Add deprecation warning
  console.warn(
    'getWebSocketService is deprecated. Use streamingService from ./streamingService.ts instead. ' +
    'This service will be removed in a future version.'
  );
  
  return globalWebSocketService;
};

export const destroyWebSocketService = (): void => {
  if (globalWebSocketService) {
    globalWebSocketService.destroy();
    globalWebSocketService = null;
  }
};