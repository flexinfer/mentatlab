import { httpClient, HttpClient } from './httpClient';
import { isFeatureEnabled } from '@/config/features';
import { FlowService, getFlowService } from './flowService';
import { AgentService, getAgentService } from './agentService';
import { MediaService, getMediaService } from './mediaService';
import { StreamingService } from './streamingService'; // Only import the class, not the singleton

/**
 * Configuration for the API service
 */
export interface ApiServiceConfig {
  baseUrl: string;
  wsUrl: string;
  sseUrl: string; // Added sseUrl
  apiKey?: string;
  debug?: boolean;
}

/**
 * Main API service that orchestrates HTTP and WebSocket communication
 */
export class ApiService {
  private http: HttpClient;
  private config: ApiServiceConfig;
  
  // Service instances
  public flows: FlowService;
  public agents: AgentService;
  public media: MediaService;
  public streaming: StreamingService; // Added streaming service

  constructor(config: ApiServiceConfig) {
    this.config = config;
    this.http = httpClient;
    
    // Initialize HTTP client base URL
    this.http.defaults.baseURL = config.baseUrl;
    
    // Set up authentication if API key is provided
    if (config.apiKey) {
      this.http.defaults.headers.common['Authorization'] = `Bearer ${config.apiKey}`;
    }
    
    // Initialize streaming service
    this.streaming = new StreamingService(
      'default-api-stream', // A default streamId for API level
      this.config.wsUrl,
      this.config.sseUrl
    );

    // Initialize other service instances, passing null for wsClient as it's now handled by StreamingService
    this.flows = getFlowService(this.http, null);
    this.agents = getAgentService(this.http, null);
    this.media = getMediaService(this.http, null);
  }

  /**
   * Get HTTP client instance
   */
  get httpClient(): HttpClient {
    return this.http;
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
    
    if (config.wsUrl || config.sseUrl) {
      // Reconnect streaming service with new URLs
      this.streaming.disconnect(); // Disconnect current stream
      this.streaming = new StreamingService(
        'default-api-stream', // Keep same streamId or update as needed
        config.wsUrl || this.config.wsUrl,
        config.sseUrl || this.config.sseUrl
      );
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
  sseUrl: import.meta.env.VITE_WS_URL ? (import.meta.env.VITE_WS_URL + '/sse') : 'http://localhost:8000/ws/sse',
  debug: import.meta.env.DEV
});

// Export for convenience
export default apiService;