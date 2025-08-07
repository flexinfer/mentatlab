/**
 * Flow Service - Handles flow management and execution
 */

import { BaseService } from './baseService';
import { HttpClient } from './httpClient';
import { WebSocketClient } from './websocketClient';

// Import existing types
import type { Flow, Node, Edge } from '@/types/graph';

export interface FlowExecutionRequest {
  flowId: string;
  inputs?: Record<string, any>;
  config?: Record<string, any>;
}

export interface FlowExecutionResponse {
  executionId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  outputs?: Record<string, any>;
  error?: string;
}

export interface FlowStreamUpdate {
  executionId: string;
  nodeId: string;
  status: 'running' | 'completed' | 'failed';
  outputs?: Record<string, any>;
  error?: string;
  timestamp: string;
}

export class FlowService extends BaseService {
  constructor(http: HttpClient, ws: WebSocketClient | null) {
    super(http, ws, { basePath: '/api/flows', enableStreaming: true });
  }

  /**
   * List all flows
   */
  async listFlows(params?: { limit?: number; offset?: number }): Promise<Flow[]> {
    return this.get<Flow[]>('', params);
  }

  /**
   * Get a specific flow by ID
   */
  async getFlow(flowId: string): Promise<Flow> {
    return this.get<Flow>(`/${flowId}`);
  }

  /**
   * Create a new flow
   */
  async createFlow(flow: Partial<Flow>): Promise<Flow> {
    return this.post<Flow>('', flow);
  }

  /**
   * Update an existing flow
   */
  async updateFlow(flowId: string, updates: Partial<Flow>): Promise<Flow> {
    return this.put<Flow>(`/${flowId}`, updates);
  }

  /**
   * Delete a flow
   */
  async deleteFlow(flowId: string): Promise<void> {
    return this.delete<void>(`/${flowId}`);
  }

  /**
   * Execute a flow
   */
  async executeFlow(request: FlowExecutionRequest): Promise<FlowExecutionResponse> {
    const response = await this.post<FlowExecutionResponse>('/execute', request);
    
    // If streaming is available, subscribe to execution updates
    if (this.isStreamingAvailable && response.executionId) {
      this.subscribeToExecution(response.executionId);
    }
    
    return response;
  }

  /**
   * Get flow execution status
   */
  async getExecutionStatus(executionId: string): Promise<FlowExecutionResponse> {
    return this.get<FlowExecutionResponse>(`/executions/${executionId}`);
  }

  /**
   * Cancel flow execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    return this.post<void>(`/executions/${executionId}/cancel`);
  }

  /**
   * Validate flow configuration
   */
  async validateFlow(flow: Partial<Flow>): Promise<{ valid: boolean; errors?: string[] }> {
    return this.post<{ valid: boolean; errors?: string[] }>('/validate', flow);
  }

  /**
   * Export flow as JSON
   */
  async exportFlow(flowId: string): Promise<string> {
    return this.get<string>(`/${flowId}/export`);
  }

  /**
   * Import flow from JSON
   */
  async importFlow(flowData: string): Promise<Flow> {
    return this.post<Flow>('/import', { data: flowData });
  }

  /**
   * Subscribe to flow execution updates
   */
  subscribeToExecution(
    executionId: string,
    onUpdate?: (update: FlowStreamUpdate) => void
  ): (() => void) | null {
    return this.subscribeToStream(`execution:${executionId}`, (data) => {
      if (onUpdate) {
        onUpdate(data as FlowStreamUpdate);
      }
    });
  }

  /**
   * Subscribe to all flow updates
   */
  subscribeToFlowUpdates(
    onUpdate: (update: { type: string; flow: Flow }) => void
  ): (() => void) | null {
    return this.subscribeToStream('flow:update', onUpdate);
  }

  /**
   * Get available node types
   */
  async getNodeTypes(): Promise<Array<{ type: string; category: string; config: any }>> {
    return this.get<Array<{ type: string; category: string; config: any }>>('/node-types');
  }

  /**
   * Test flow connection
   */
  async testConnection(flowId: string): Promise<{ success: boolean; message?: string }> {
    return this.post<{ success: boolean; message?: string }>(`/${flowId}/test`);
  }
}

// Export singleton instance
let flowServiceInstance: FlowService;

export function getFlowService(http: HttpClient, ws: WebSocketClient | null): FlowService {
  if (!flowServiceInstance) {
    flowServiceInstance = new FlowService(http, ws);
  }
  return flowServiceInstance;
}