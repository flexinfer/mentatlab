import { useStreamingStore } from '../store/streamingStore';

export class StreamingService {
  private ws: WebSocket | null = null;
  private streamId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: any = null;

  constructor() {
    console.log('[StreamingService] Service initialized');
  }

  connect(streamId: string) {
    console.log('[StreamingService] Connecting to stream:', streamId);
    this.streamId = streamId;
    this.reconnectAttempts = 0;
    this.establishConnection();
  }

  private establishConnection() {
    if (!this.streamId) {
      console.error('[StreamingService] No streamId provided');
      return;
    }

    const wsUrl = `ws://localhost:8000/ws/streams/${this.streamId}`;
    console.log('[StreamingService] Establishing WebSocket connection to:', wsUrl);
    
    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[StreamingService] WebSocket connected successfully');
        this.reconnectAttempts = 0;
        this.startPing();
        useStreamingStore.getState().setConnectionStatus('connected');
      };

      this.ws.onmessage = (event) => {
        console.log('[StreamingService] Message received:', event.data);
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('[StreamingService] Failed to parse message:', error, 'Raw data:', event.data);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[StreamingService] WebSocket error:', error);
        useStreamingStore.getState().setConnectionStatus('error');
      };

      this.ws.onclose = (event) => {
        console.log('[StreamingService] WebSocket disconnected. Code:', event.code, 'Reason:', event.reason);
        this.stopPing();
        useStreamingStore.getState().setConnectionStatus('disconnected');
        this.attemptReconnect();
      };
    } catch (error) {
      console.error('[StreamingService] Failed to create WebSocket:', error);
      useStreamingStore.getState().setConnectionStatus('error');
    }
  }

  private handleMessage(data: any) {
    console.log('[StreamingService] Handling message type:', data.type);
    switch (data.type) {
      case 'data':
        console.log('[StreamingService] Adding data point:', data.payload);
        useStreamingStore.getState().addDataPoint(data.payload);
        break;
      case 'console':
        console.log('[StreamingService] Adding console message:', data.payload);
        useStreamingStore.getState().addConsoleMessage(data.payload);
        break;
      case 'status':
        console.log('[StreamingService] Updating stream status:', data.payload);
        useStreamingStore.getState().updateStreamStatus(data.payload);
        break;
      case 'pong':
        console.log('[StreamingService] Received pong response');
        break;
      default:
        console.warn('[StreamingService] Unknown message type:', data.type, 'Data:', data);
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      useStreamingStore.getState().setConnectionStatus('connecting');
      setTimeout(() => {
        this.establishConnection();
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // 30 seconds
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  sendData(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'data',
        payload: data,
        timestamp: new Date().toISOString()
      }));
    }
  }

  disconnect() {
    console.log('[StreamingService] Disconnecting from stream');
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.stopPing();
    this.streamId = null;
  }
}

export const streamingService = new StreamingService();