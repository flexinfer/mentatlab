/**
 * Flow Service - Handles flow persistence and management
 */

import { BaseService } from './baseService';
import { HttpClient } from './httpClient';
import { WebSocketClient } from './websocketClient';

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  version?: string;
  graph: FlowGraph;
  layout?: Record<string, any>;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface CreateFlowRequest {
  id?: string;
  name: string;
  description?: string;
  graph: FlowGraph;
  layout?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface UpdateFlowRequest {
  name?: string;
  description?: string;
  version?: string;
  graph?: FlowGraph;
  layout?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface ListFlowsResponse {
  flows: Flow[];
  count: number;
}

export interface ListFlowsParams {
  limit?: number;
  offset?: number;
  created_by?: string;
}

export class FlowService extends BaseService {
  constructor(http: HttpClient, ws: WebSocketClient | null) {
    super(http, ws, { basePath: '/api/v1/flows', enableStreaming: false });
  }

  /**
   * List all flows with optional pagination
   */
  async listFlows(params?: ListFlowsParams): Promise<ListFlowsResponse> {
    return this.get<ListFlowsResponse>('', params);
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
  async createFlow(flow: CreateFlowRequest): Promise<Flow> {
    return this.post<Flow>('', flow);
  }

  /**
   * Update an existing flow
   */
  async updateFlow(flowId: string, updates: UpdateFlowRequest): Promise<Flow> {
    return this.put<Flow>(`/${flowId}`, updates);
  }

  /**
   * Delete a flow
   */
  async deleteFlow(flowId: string): Promise<void> {
    return this.delete<void>(`/${flowId}`);
  }

  /**
   * Save flow with auto-generated ID if not provided
   */
  async saveFlow(flow: CreateFlowRequest): Promise<Flow> {
    if (flow.id) {
      // Try to update first, create if not found
      try {
        return await this.updateFlow(flow.id, {
          name: flow.name,
          description: flow.description,
          graph: flow.graph,
          layout: flow.layout,
          metadata: flow.metadata,
        });
      } catch (error: any) {
        // If 404, create new
        if (error.status === 404) {
          return this.createFlow(flow);
        }
        throw error;
      }
    }
    return this.createFlow(flow);
  }

  /**
   * Duplicate an existing flow
   */
  async duplicateFlow(flowId: string, newName?: string): Promise<Flow> {
    const original = await this.getFlow(flowId);
    return this.createFlow({
      name: newName || `${original.name} (Copy)`,
      description: original.description,
      graph: original.graph,
      layout: original.layout,
      metadata: original.metadata,
    });
  }

  /**
   * Export flow as JSON
   */
  exportFlow(flow: Flow): string {
    return JSON.stringify(flow, null, 2);
  }

  /**
   * Import flow from JSON string
   */
  async importFlow(jsonString: string): Promise<Flow> {
    try {
      const data = JSON.parse(jsonString);
      // Validate required fields
      if (!data.name || !data.graph) {
        throw new Error('Invalid flow format: missing name or graph');
      }
      return this.createFlow({
        name: data.name,
        description: data.description,
        graph: data.graph,
        layout: data.layout,
        metadata: data.metadata,
      });
    } catch (error: any) {
      if (error.message?.includes('Invalid flow format')) {
        throw error;
      }
      throw new Error(`Failed to parse flow JSON: ${error.message}`);
    }
  }
}

// Export singleton instance
let flowServiceInstance: FlowService | null = null;

export function getFlowService(http: HttpClient, ws: WebSocketClient | null): FlowService {
  if (!flowServiceInstance) {
    flowServiceInstance = new FlowService(http, ws);
  }
  return flowServiceInstance;
}

// Reset singleton for testing
export function resetFlowService(): void {
  flowServiceInstance = null;
}
