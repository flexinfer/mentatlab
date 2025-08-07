import { httpClient, HttpClient } from './httpClient';
import { WebSocketClient } from './websocketClient';
import { isFeatureEnabled } from '@/config/features';
import { FlowService, getFlowService } from './flowService';
import { AgentService, getAgentService } from './agentService';
import { MediaService, getMediaService } from './mediaService';

/**
 * Configuration for the API service
 */
export interface ApiServiceConfig {
  baseUrl: string;
  wsUrl: string;
  apiKey?: string;
  debug?: boolean;
}

/**
 * Main API service that orchestrates HTTP and WebSocket communication
 */
export class ApiService {
  private http: HttpClient;
  private ws: WebSocketClient | null = null;
  private config: ApiServiceConfig;
  
  // Service instances
  public flows: FlowService;
  public agents: AgentService;
  public media: MediaService;

  constructor(config: ApiServiceConfig) {
    this.config = config;
    this.http = httpClient;
    
    // Initialize HTTP client base URL
    this.http.defaults.baseURL = config.baseUrl;
    
    // Set up authentication if API key is provided
    if (config.apiKey) {
      this.http.defaults.headers.common['Authorization'] = `Bearer ${config.apiKey}`;
    }
    
    // Initialize WebSocket client if streaming is enabled
    if (isFeatureEnabled('NEW_STREAMING')) {
      this.initializeWebSocket();
    }
    
    // Initialize service instances
    this.flows = getFlowService(this.http, this.ws);
    this.agents = getAgentService(this.http, this.ws);
    this.media = getMediaService(this.http, this.ws);
  }

  /**
   * Initialize WebSocket client
   */
  private initializeWebSocket(): void {
    this.ws = new WebSocketClient({
      url: this.config.wsUrl,
      reconnect: true,
      reconnectInterval: 5000,
      maxReconnectAttempts: 10,
      heartbeatInterval: 30000,
      enableSSEFallback: true,
      debug: this.config.debug
    });
  }

  /**
   * Get HTTP client instance
   */
  get httpClient(): HttpClient {
    return this.http;
  }

  /**
   * Get WebSocket client instance
   */
  get wsClient(): WebSocketClient | null {
    return this.ws;
  }

  /**
   * Connect WebSocket client
   */
  async connectWebSocket(): Promise<void> {
    if (!this.ws) {
      throw new Error('WebSocket client not initialized. Enable streaming feature flag.');
    }
    await this.ws.connect();
  }

  /**
   * Disconnect WebSocket client
   */
  disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.disconnect();
    }
  }

  /**
   * Update API configuration
   */
  updateConfig(config: Partial<ApiServiceConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.baseUrl) {
      this.http.defaults.baseURL = config.baseUrl;
    }
    
    if (config.apiKey !== undefined) {
      if (config.apiKey) {
        this.http.defaults.headers.common['Authorization'] = `Bearer ${config.apiKey}`;
      } else {
        delete this.http.defaults.headers.common['Authorization'];
      }
    }
    
    if (config.wsUrl && this.ws) {
      // Reconnect with new URL
      this.ws.disconnect();
      this.ws = new WebSocketClient({
        ...this.ws.config,
        url: config.wsUrl
      });
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.http.get('/health');
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }
}

/**
 * Default API service instance
 */
export const apiService = new ApiService({
  baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  wsUrl: import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws',
  debug: import.meta.env.DEV
});

// Export for convenience
export default apiService;