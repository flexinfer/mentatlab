/**
 * Base service class providing common functionality for all API services
 */

import { HttpClient } from './httpClient';
import { WebSocketClient } from './websocketClient';

export interface ServiceConfig {
  basePath: string;
  enableStreaming?: boolean;
}

export abstract class BaseService {
  protected http: HttpClient;
  protected ws: WebSocketClient | null;
  protected basePath: string;

  constructor(
    http: HttpClient,
    ws: WebSocketClient | null,
    config: ServiceConfig
  ) {
    this.http = http;
    this.ws = ws;
    this.basePath = config.basePath;
  }

  /**
   * Build full endpoint path
   */
  protected buildPath(endpoint: string): string {
    return `${this.basePath}${endpoint}`;
  }

  /**
   * Generic GET request
   */
  protected async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    return this.http.get<T>(this.buildPath(endpoint), { params });
  }

  /**
   * Generic POST request
   */
  protected async post<T>(endpoint: string, data?: any, params?: Record<string, any>): Promise<T> {
    return this.http.post<T>(this.buildPath(endpoint), data, { params });
  }

  /**
   * Generic PUT request
   */
  protected async put<T>(endpoint: string, data?: any, params?: Record<string, any>): Promise<T> {
    return this.http.put<T>(this.buildPath(endpoint), data, { params });
  }

  /**
   * Generic DELETE request
   */
  protected async delete<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    return this.http.delete<T>(this.buildPath(endpoint), { params });
  }

  /**
   * Generic PATCH request
   */
  protected async patch<T>(endpoint: string, data?: any, params?: Record<string, any>): Promise<T> {
    return this.http.patch<T>(this.buildPath(endpoint), data, { params });
  }

  /**
   * Subscribe to WebSocket messages for this service
   */
  protected subscribeToStream(
    messageType: string,
    handler: (data: any) => void
  ): (() => void) | null {
    if (!this.ws) {
      console.warn('WebSocket client not available. Streaming is disabled.');
      return null;
    }

    return this.ws.onMessage((message) => {
      if (message.type === messageType || message.type === `${this.basePath}:${messageType}`) {
        handler(message.data);
      }
    });
  }

  /**
   * Send WebSocket message
   */
  protected sendStreamMessage(type: string, data: any): boolean {
    if (!this.ws) {
      console.warn('WebSocket client not available. Cannot send stream message.');
      return false;
    }

    return this.ws.send({
      type: `${this.basePath}:${type}`,
      data,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Check if streaming is available
   */
  get isStreamingAvailable(): boolean {
    return this.ws !== null && this.ws.getStatus() === 'connected';
  }
}