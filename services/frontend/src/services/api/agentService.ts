/**
 * Agent Service - Handles agent management and communication
 */

import { BaseService } from './baseService';
import { HttpClient } from './httpClient';
import { WebSocketClient } from './websocketClient';

export interface Agent {
  id: string;
  name: string;
  type: string;
  status: 'online' | 'offline' | 'busy' | 'error';
  capabilities: string[];
  config: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface AgentMessage {
  agentId: string;
  messageId: string;
  type: string;
  content: any;
  timestamp: string;
}

export interface AgentTask {
  taskId: string;
  agentId: string;
  type: string;
  input: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: any;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export class AgentService extends BaseService {
  constructor(http: HttpClient, ws: WebSocketClient | null) {
    super(http, ws, { basePath: '/api/agents', enableStreaming: true });
  }

  /**
   * List all available agents
   */
  async listAgents(params?: { type?: string; status?: string }): Promise<Agent[]> {
    return this.get<Agent[]>('', params);
  }

  /**
   * Get a specific agent by ID
   */
  async getAgent(agentId: string): Promise<Agent> {
    return this.get<Agent>(`/${agentId}`);
  }

  /**
   * Register a new agent
   */
  async registerAgent(agent: Omit<Agent, 'id' | 'status'>): Promise<Agent> {
    return this.post<Agent>('/register', agent);
  }

  /**
   * Update agent configuration
   */
  async updateAgent(agentId: string, updates: Partial<Agent>): Promise<Agent> {
    return this.put<Agent>(`/${agentId}`, updates);
  }

  /**
   * Unregister an agent
   */
  async unregisterAgent(agentId: string): Promise<void> {
    return this.delete<void>(`/${agentId}`);
  }

  /**
   * Send a task to an agent
   */
  async sendTask(agentId: string, task: Omit<AgentTask, 'taskId' | 'status' | 'createdAt'>): Promise<AgentTask> {
    const response = await this.post<AgentTask>(`/${agentId}/tasks`, task);
    
    // Subscribe to task updates if streaming is available
    if (this.isStreamingAvailable && response.taskId) {
      this.subscribeToTaskUpdates(response.taskId);
    }
    
    return response;
  }

  /**
   * Get task status
   */
  async getTaskStatus(taskId: string): Promise<AgentTask> {
    return this.get<AgentTask>(`/tasks/${taskId}`);
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<void> {
    return this.post<void>(`/tasks/${taskId}/cancel`);
  }

  /**
   * Get agent capabilities
   */
  async getAgentCapabilities(agentId: string): Promise<string[]> {
    return this.get<string[]>(`/${agentId}/capabilities`);
  }

  /**
   * Test agent connection
   */
  async testAgentConnection(agentId: string): Promise<{ connected: boolean; latency?: number }> {
    return this.get<{ connected: boolean; latency?: number }>(`/${agentId}/ping`);
  }

  /**
   * Send message to agent
   */
  sendMessage(agentId: string, message: any): boolean {
    return this.sendStreamMessage(`agent:${agentId}:message`, {
      agentId,
      message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Subscribe to agent status updates
   */
  subscribeToAgentStatus(
    agentId: string,
    onStatusChange: (status: Agent['status']) => void
  ): (() => void) | null {
    return this.subscribeToStream(`agent:${agentId}:status`, (data) => {
      onStatusChange(data.status);
    });
  }

  /**
   * Subscribe to agent messages
   */
  subscribeToAgentMessages(
    agentId: string,
    onMessage: (message: AgentMessage) => void
  ): (() => void) | null {
    return this.subscribeToStream(`agent:${agentId}:message`, onMessage);
  }

  /**
   * Subscribe to task updates
   */
  subscribeToTaskUpdates(
    taskId: string,
    onUpdate?: (task: AgentTask) => void
  ): (() => void) | null {
    return this.subscribeToStream(`task:${taskId}:update`, (data) => {
      if (onUpdate) {
        onUpdate(data as AgentTask);
      }
    });
  }

  /**
   * Subscribe to all agent events
   */
  subscribeToAllAgentEvents(
    onEvent: (event: { type: string; agent: Agent; data?: any }) => void
  ): (() => void) | null {
    return this.subscribeToStream('agent:event', onEvent);
  }

  /**
   * Get agent metrics
   */
  async getAgentMetrics(agentId: string, timeRange?: { start: Date; end: Date }): Promise<{
    tasksCompleted: number;
    tasksFailed: number;
    averageResponseTime: number;
    uptime: number;
  }> {
    const params = timeRange ? {
      start: timeRange.start.toISOString(),
      end: timeRange.end.toISOString()
    } : undefined;
    
    return this.get<{
      tasksCompleted: number;
      tasksFailed: number;
      averageResponseTime: number;
      uptime: number;
    }>(`/${agentId}/metrics`, params);
  }
}

// Export singleton instance
let agentServiceInstance: AgentService;

export function getAgentService(http: HttpClient, ws: WebSocketClient | null): AgentService {
  if (!agentServiceInstance) {
    agentServiceInstance = new AgentService(http, ws);
  }
  return agentServiceInstance;
}