import { v4 as uuidv4 } from 'uuid';
import {
  StreamingMessage,
  StreamingConfig,
  DEFAULT_STREAMING_CONFIG,
  StreamEventType,
  StreamControlMessage,
  StreamNegotiationMessage,
  StreamStatusMessage,
  MediaStreamInitMessage,
  MediaChunkMessage,
  MediaStreamCompleteMessage,
  TextStreamMessage,
  AudioStreamMessage,
  VideoStreamMessage,
  ProgressMessage,
  ErrorMessage,
  AckMessage,
  HeartbeatMessage,
  QualityAdaptationMessage,
  StreamStatsMessage,
  StreamMetadataMessage,
  StreamSyncMessage,
  MediaTransformMessage,
  isMediaStreamMessage,
  isControlMessage,
  isErrorMessage,
  StreamingCapabilities,
  StreamConnectionState // Added StreamConnectionState import
} from '../types/streaming';
import { MediaType, MediaChunk, MediaReference } from '../types/media';
import { useStreamingStore, StreamingState } from '../store'; // Import useStreamingStore and StreamingState
 
import { StreamMessageHandler, ConnectionStateHandler } from '../types/streaming'; // Import from types/streaming

interface ReconnectionConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

const DEFAULT_RECONNECTION_CONFIG: ReconnectionConfig = {
  maxAttempts: 5,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 1.5
};

/**
 * Enhanced Stream class with multimodal support and connection resilience
 */
class EnhancedStream {
  private ws: WebSocket | null = null;
  private sse: EventSource | null = null;
  private messageHandlers: Set<StreamMessageHandler> = new Set();
  private stateHandlers: Set<ConnectionStateHandler> = new Set();
  private connectionState: StreamConnectionState = StreamConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimeoutId: number | null = null;
  private heartbeatIntervalId: number | null = null;
  private pendingAcks = new Map<string, { message: StreamingMessage; timestamp: number }>();
  private messageBuffer: StreamingMessage[] = [];
  private isManuallyDisconnected = false;
  private lastSequenceNumber = 0;
  private stats = {
    messagesReceived: 0,
    messagesSent: 0,
    bytesReceived: 0,
    bytesSent: 0,
    connectTime: 0,
    lastError: null as Error | null
  };

  constructor(
    public readonly streamId: string,
    private wsUrl: string,
    private sseUrl: string,
    private config: StreamingConfig = DEFAULT_STREAMING_CONFIG,
    private reconnectionConfig: ReconnectionConfig = DEFAULT_RECONNECTION_CONFIG
  ) {}

  /**
   * Connect to the stream using WebSocket with SSE fallback
   */
  async connect(): Promise<void> {
    if (this.connectionState === StreamConnectionState.CONNECTED) {
      return;
    }

    this.isManuallyDisconnected = false;
    this.setConnectionState(StreamConnectionState.CONNECTING);
    (useStreamingStore.getState() as StreamingState).registerStream(this.streamId, { wsUrl: this.wsUrl, sseUrl: this.sseUrl, config: this.config });

    try {
      await this.connectWebSocket();
    } catch (error) {
      console.warn('[EnhancedStream] WebSocket connection failed, falling back to SSE:', error);
      try {
        await this.connectSSE();
      } catch (sseError) {
        console.error('[EnhancedStream] SSE connection also failed:', sseError);
        this.setConnectionState(StreamConnectionState.ERROR);
        throw sseError;
      }
    }
  }

  /**
   * Connect via WebSocket
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);
        this.ws.binaryType = 'arraybuffer';

        const connectTimeout = setTimeout(() => {
          if (this.ws?.readyState === WebSocket.CONNECTING) {
            this.ws.close();
            reject(new Error('WebSocket connection timeout'));
          }
        }, this.config.timeout);

        this.ws.onopen = () => {
          clearTimeout(connectTimeout);
          console.log('[EnhancedStream] WebSocket connected successfully');
          this.stats.connectTime = Date.now();
          this.reconnectAttempts = 0;
          this.setConnectionState(StreamConnectionState.CONNECTED);
          this.startHeartbeat();
          this.sendNegotiation();
          this.flushMessageBuffer();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.stats.messagesReceived++;
          this.stats.bytesReceived += event.data.byteLength || event.data.length;
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          clearTimeout(connectTimeout);
          console.log('[EnhancedStream] WebSocket closed:', event.code, event.reason);
          this.stopHeartbeat();
          
          if (!this.isManuallyDisconnected && event.code !== 1000) {
            this.handleReconnection();
          } else {
            this.setConnectionState(StreamConnectionState.DISCONNECTED);
          }
        };

        this.ws.onerror = (errorEvent: Event) => { // Cast error to Event
          const errorMessage: ErrorMessage = {
            id: uuidv4(),
            type: 'error',
            timestamp: new Date().toISOString(),
            agent_id: 'webui',
            stream_id: this.streamId,
            code: 'WS_CONNECTION_ERROR',
            message: `WebSocket connection failed: ${errorEvent.type}`,
            context: { event: errorEvent },
            recoverable: true,
          };
          console.error('[EnhancedStream] WebSocket error:', errorMessage.message, errorMessage.context);
          this.stats.lastError = new Error(errorMessage.message);
          (useStreamingStore.getState() as StreamingState).addStreamError(this.streamId, errorMessage);
          reject(errorEvent);
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Connect via Server-Sent Events (SSE) as fallback
   */
  private async connectSSE(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.sse = new EventSource(this.sseUrl);

        this.sse.onopen = () => {
          console.log('[EnhancedStream] SSE connected successfully');
          this.stats.connectTime = Date.now();
          this.reconnectAttempts = 0;
          this.setConnectionState(StreamConnectionState.CONNECTED);
          resolve();
        };

        this.sse.onmessage = (event) => {
          this.stats.messagesReceived++;
          this.stats.bytesReceived += event.data.length;
          this.handleMessage(event.data);
        };

        this.sse.onerror = (errorEvent: Event) => { // Cast error to Event
          const errorMessage: ErrorMessage = {
            id: uuidv4(),
            type: 'error',
            timestamp: new Date().toISOString(),
            agent_id: 'webui',
            stream_id: this.streamId,
            code: 'SSE_CONNECTION_ERROR',
            message: `SSE connection failed: ${errorEvent.type}`,
            context: { event: errorEvent },
            recoverable: true,
          };
          console.error('[EnhancedStream] SSE error:', errorMessage.message, errorMessage.context);
          this.stats.lastError = new Error(errorMessage.message);
          (useStreamingStore.getState() as StreamingState).addStreamError(this.streamId, errorMessage);
          if (this.sse?.readyState === EventSource.CLOSED) {
            this.sse = null;
            if (!this.isManuallyDisconnected) {
              this.handleReconnection();
            }
          }
          reject(errorEvent);
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(data: string | ArrayBuffer): void {
    try {
      let message: StreamingMessage;
      
      if (typeof data === 'string') {
        message = JSON.parse(data);
      } else {
        // Handle binary data for media streaming
        const decoder = new TextDecoder();
        const text = decoder.decode(data);
        message = JSON.parse(text);
      }

      // Update sequence tracking
      if (message.sequence !== undefined) {
        if (message.sequence > this.lastSequenceNumber + 1) {
          console.warn('[EnhancedStream] Message sequence gap detected:', 
            this.lastSequenceNumber, '->', message.sequence);
        }
        this.lastSequenceNumber = message.sequence;
      }

      // Handle acknowledgment if required
      if (message.id && this.shouldAcknowledge(message)) {
        this.sendAcknowledgment(message);
      }

      // Process message
      this.processMessage(message);
      (useStreamingStore.getState() as StreamingState).addStreamMessage(this.streamId, message);

    } catch (error) {
      console.error('[EnhancedStream] Failed to parse message:', error);
    }
  }

  /**
   * Process different message types
   */
  private processMessage(message: StreamingMessage): void {
    // Handle control messages internally
    if (isControlMessage(message)) {
      this.handleControlMessage(message);
      return;
    }

    // Handle error messages
    if (isErrorMessage(message)) {
      this.handleErrorMessage(message);
    }

    // Handle heartbeat
    if (message.type === 'heartbeat') {
      this.handleHeartbeat(message as HeartbeatMessage); // Cast to HeartbeatMessage
      return;
    }

    // Handle acknowledgments
    if (message.type === 'ack') {
      this.handleAcknowledgment(message as AckMessage); // Cast to AckMessage
      return;
    }

    // Handle quality adaptation
    if (message.type === 'stream:quality') {
      this.handleQualityAdaptation(message as QualityAdaptationMessage); // Cast to QualityAdaptationMessage
    }

    // Notify all handlers
    this.messageHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error('[EnhancedStream] Error in message handler:', error);
      }
    });
  }

  /**
   * Handle control messages
   */
  private handleControlMessage(message: StreamControlMessage): void {
    console.log('[EnhancedStream] Control message:', message.action);
    // Control messages might need special handling but should also be forwarded
    this.messageHandlers.forEach(handler => handler(message));
  }

  /**
   * Handle error messages
   */
  private handleErrorMessage(message: ErrorMessage): void {
    console.error('[EnhancedStream] Error message:', message.code, message.message);
    this.stats.lastError = new Error(`${message.code}: ${message.message}`);
    (useStreamingStore.getState() as StreamingState).addStreamError(this.streamId, message);
    
    if (!message.recoverable) {
      this.setConnectionState(StreamConnectionState.ERROR);
    }
  }

  /**
   * Handle heartbeat messages
   */
  private handleHeartbeat(message: HeartbeatMessage): void {
    // Respond with heartbeat
    this.send({
      id: uuidv4(),
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
      agent_id: 'webui',
      stream_id: this.streamId,
      from: 'client',
      health: {
        // Removed performance.memory?.usedJSHeapSize as it's non-standard
        activeStreams: 1
      }
    } as HeartbeatMessage);
  }

  /**
   * Handle acknowledgment messages
   */
  private handleAcknowledgment(message: AckMessage): void {
    const pending = this.pendingAcks.get(message.ackId);
    if (pending) {
      this.pendingAcks.delete(message.ackId);
      if (!message.success && message.error) {
        console.error('[EnhancedStream] Message not acknowledged:', message.error);
      }
    }
  }

  /**
   * Handle quality adaptation messages
   */
  private handleQualityAdaptation(message: QualityAdaptationMessage): void {
    console.log('[EnhancedStream] Quality adaptation:', message.currentQuality, 
      'reason:', message.reason);
  }

  /**
   * Send a message through the stream
   */
  send(message: StreamingMessage): boolean {
    // Add message metadata
    if (!message.id) {
      message.id = uuidv4();
    }
    if (!message.timestamp) {
      message.timestamp = new Date().toISOString();
    }
    if (!message.stream_id) {
      message.stream_id = this.streamId;
    }

    const data = JSON.stringify(message);

    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(data);
        this.stats.messagesSent++;
        this.stats.bytesSent += data.length;
        
        // Track messages that need acknowledgment
        if (this.shouldTrackAck(message)) {
          this.pendingAcks.set(message.id!, { message, timestamp: Date.now() });
        }
        
        return true;
      } catch (error) {
        console.error('[EnhancedStream] Failed to send message:', error);
        this.messageBuffer.push(message);
        return false;
      }
    } else if (this.sse?.readyState === EventSource.OPEN) {
      // SSE is read-only, buffer message
      console.warn('[EnhancedStream] SSE connection is read-only. Message buffered:', message);
      this.messageBuffer.push(message);
      return false;
    } else {
      console.warn('[EnhancedStream] Connection not open. Message buffered:', message);
      this.messageBuffer.push(message);
      return false;
    }
  }

  /**
   * Disconnect from the stream
   */
  disconnect(): void {
    this.isManuallyDisconnected = true;
    if (this.ws) {
      this.ws.close(1000, 'Client disconnected');
      this.ws = null;
    }
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    this.stopHeartbeat();
    this.clearReconnection();
    this.setConnectionState(StreamConnectionState.DISCONNECTED);
    console.log('[EnhancedStream] Disconnected from stream.');
  }

  /**
   * Register a message handler
   */
  onMessage(handler: StreamMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Register a connection state handler
   */
  onConnectionStateChange(handler: ConnectionStateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  /**
   * Set connection state and notify handlers
   */
  private setConnectionState(newState: StreamConnectionState): void {
    if (this.connectionState === newState) {
      return;
    }
    this.connectionState = newState;
    // Update Zustand store
    (useStreamingStore.getState() as StreamingState).setConnectionStatus(newState);
    (useStreamingStore.getState() as StreamingState).updateStreamStatus(this.streamId, newState);
    this.stateHandlers.forEach(handler => {
      try {
        handler(newState);
      } catch (error) {
        console.error('[EnhancedStream] Error in state handler:', error);
      }
    });
  }

  /**
   * Start sending heartbeats to keep the connection alive
   */
  private startHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      this.stopHeartbeat();
    }
    this.heartbeatIntervalId = window.setInterval(() => {
      this.send({
        id: uuidv4(),
        type: 'heartbeat',
        timestamp: new Date().toISOString(),
        agent_id: 'webui',
        stream_id: this.streamId,
        from: 'client',
        health: {
          // Removed performance.memory?.usedJSHeapSize as it's non-standard
          activeStreams: 1
        }
      } as HeartbeatMessage);
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop sending heartbeats
   */
  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      window.clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  /**
   * Handle reconnection logic with exponential backoff
   */
  private handleReconnection(): void {
    this.clearReconnection();
    if (this.reconnectAttempts < this.reconnectionConfig.maxAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(
        this.reconnectionConfig.initialDelay * Math.pow(this.reconnectionConfig.backoffMultiplier, this.reconnectAttempts - 1),
        this.reconnectionConfig.maxDelay
      );
      console.log(`[EnhancedStream] Attempting to reconnect in ${delay / 1000} seconds (attempt ${this.reconnectAttempts}/${this.reconnectionConfig.maxAttempts})...`);
      this.setConnectionState(StreamConnectionState.RECONNECTING);
      this.reconnectTimeoutId = window.setTimeout(async () => {
        try {
          await this.connect();
          console.log('[EnhancedStream] Reconnection successful.');
          this.clearReconnection();
        } catch (error) {
          console.warn('[EnhancedStream] Reconnection attempt failed:', error);
          this.handleReconnection(); // Try again
        }
      }, delay);
    } else {
      console.error('[EnhancedStream] Max reconnection attempts reached. Stream disconnected.');
      this.setConnectionState(StreamConnectionState.ERROR);
    }
  }

  /**
   * Clear any pending reconnection timeouts
   */
  private clearReconnection(): void {
    if (this.reconnectTimeoutId) {
      window.clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  /**
   * Send a negotiation message upon successful connection
   */
  private sendNegotiation(): void {
    const negotiationMessage: StreamNegotiationMessage = {
      id: uuidv4(),
      type: 'stream:negotiate',
      timestamp: new Date().toISOString(),
      agent_id: 'webui', // Added agent_id
      stream_id: this.streamId,
      offer: {
        protocols: ['websocket', 'sse'], // Example protocols
        mediaTypes: [MediaType.AUDIO, MediaType.IMAGE, MediaType.VIDEO],
        codecs: {
          audio: ['aac', 'opus'],
          video: ['h264', 'vp8'],
          image: ['jpeg', 'png']
        },
        maxChunkSize: 1024 * 1024, // 1MB
        ackMechanism: true,
        compression: ['gzip', 'deflate'],
        protocolVersion: '1.0'
      }
    };
    this.send(negotiationMessage);
  }

  /**
   * Send an acknowledgment for a received message
   */
  private sendAcknowledgment(originalMessage: StreamingMessage): void {
    const ackMessage: AckMessage = {
      id: uuidv4(),
      type: 'ack',
      timestamp: new Date().toISOString(),
      stream_id: this.streamId,
      agent_id: 'webui', // Added agent_id
      // Removed 'from: client' as it's not part of AckMessage
      ackId: originalMessage.id!,
      success: true
    };
    this.send(ackMessage);
  }

  /**
   * Determine if a message requires an acknowledgment
   */
  private shouldAcknowledge(message: StreamingMessage): boolean {
    // Acknowledge all non-heartbeat, non-ack messages for reliability
    return message.type !== 'heartbeat' && message.type !== 'ack' && message.id !== undefined;
  }

  /**
   * Determine if a sent message should be tracked for acknowledgment
   */
  private shouldTrackAck(message: StreamingMessage): boolean {
    // Track control messages and negotiation messages for their acknowledgment
    return isControlMessage(message) || message.type === 'stream:negotiate';
  }

  /**
   * Flush any buffered messages (e.g., after reconnection)
   */
  private flushMessageBuffer(): void {
    if (this.messageBuffer.length > 0 && this.connectionState === StreamConnectionState.CONNECTED) {
      console.log(`[EnhancedStream] Flushing ${this.messageBuffer.length} buffered messages.`);
      const messagesToSend = [...this.messageBuffer];
      this.messageBuffer = [];
      messagesToSend.forEach(msg => this.send(msg));
    }
  }

  /**
   * Get current connection state
   */
  getConnectionState(): StreamConnectionState {
    return this.connectionState;
  }

  /**
   * Get streaming statistics
   */
  getStats() {
    return { ...this.stats, uptime: this.stats.connectTime ? Date.now() - this.stats.connectTime : 0 };
  }
}

export { EnhancedStream };