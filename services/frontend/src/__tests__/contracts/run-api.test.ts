/**
 * Contract tests for Run API responses
 *
 * These tests verify that the frontend correctly handles responses
 * matching the backend's wire format (orchestrator-go/pkg/types/run.go)
 */
import { describe, it, expect } from 'vitest';
import {
  RunSchema,
  RunMetaSchema,
  CreateRunResponseSchema,
  NodeSpecSchema,
  PlanSchema,
  isTerminalStatus,
  isControlFlowNode,
  safeValidateRun,
  safeValidateCreateRunResponse,
} from '@/schemas/run.schema';

describe('Run Schema Contracts', () => {
  describe('RunSchema', () => {
    it('should parse a complete run response', () => {
      const run = {
        id: 'run-123',
        name: 'Test Run',
        status: 'running',
        plan: {
          nodes: [
            { id: 'node-1', type: 'task', agent_id: 'echo-agent' },
          ],
          edges: [{ from: 'node-1', to: 'node-2' }],
        },
        started_at: '2024-01-15T10:00:00Z',
        finished_at: null,
        metadata: { env: 'test' },
        created_at: '2024-01-15T09:55:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      };
      const result = RunSchema.safeParse(run);
      expect(result.success).toBe(true);
    });

    it('should parse minimal run response', () => {
      const run = {
        id: 'run-1',
        status: 'queued',
        created_at: '2024-01-15T09:55:00Z',
        updated_at: '2024-01-15T09:55:00Z',
      };
      const result = RunSchema.safeParse(run);
      expect(result.success).toBe(true);
    });

    it('should accept all valid run statuses', () => {
      const validStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
      for (const status of validStatuses) {
        const run = {
          id: 'run-1',
          status,
          created_at: '2024-01-15T09:55:00Z',
          updated_at: '2024-01-15T09:55:00Z',
        };
        const result = RunSchema.safeParse(run);
        expect(result.success, `status "${status}" should be valid`).toBe(true);
      }
    });

    it('should reject deprecated statuses', () => {
      const deprecated = ['pending', 'completed', 'canceled'];
      for (const status of deprecated) {
        const run = {
          id: 'run-1',
          status,
          created_at: '2024-01-15T09:55:00Z',
          updated_at: '2024-01-15T09:55:00Z',
        };
        const result = RunSchema.safeParse(run);
        expect(result.success, `status "${status}" should be rejected`).toBe(false);
      }
    });
  });

  describe('NodeSpecSchema', () => {
    it('should use agent_id not agent (backend field name)', () => {
      const nodeWithAgentId = {
        id: 'node-1',
        type: 'task',
        agent_id: 'my-agent', // Correct backend field name
      };
      const result = NodeSpecSchema.safeParse(nodeWithAgentId);
      expect(result.success).toBe(true);
      expect(result.data?.agent_id).toBe('my-agent');
    });

    it('should parse node with command and image', () => {
      const node = {
        id: 'node-1',
        type: 'container',
        image: 'python:3.9',
        command: ['python', '-c', 'print("hello")'],
        env: { DEBUG: 'true' },
      };
      const result = NodeSpecSchema.safeParse(node);
      expect(result.success).toBe(true);
    });

    it('should parse conditional control flow node', () => {
      const node = {
        id: 'cond-1',
        type: 'conditional',
        conditional: {
          type: 'if',
          expression: '{{ result > 0 }}',
          branches: {
            true: { targets: ['success-node'] },
            false: { targets: ['fallback-node'] },
          },
        },
      };
      const result = NodeSpecSchema.safeParse(node);
      expect(result.success).toBe(true);
    });

    it('should parse for_each control flow node', () => {
      const node = {
        id: 'loop-1',
        type: 'for_each',
        for_each: {
          collection: '{{ items }}',
          item_var: 'item',
          index_var: 'idx',
          max_parallel: 4,
          body: ['process-item'],
        },
      };
      const result = NodeSpecSchema.safeParse(node);
      expect(result.success).toBe(true);
    });
  });

  describe('CreateRunResponseSchema', () => {
    it('should parse response with sse_url', () => {
      const response = {
        runId: 'run-abc',
        status: 'running',
        sse_url: '/api/v1/runs/run-abc/events',
      };
      const result = CreateRunResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
      expect(result.data?.sse_url).toBe('/api/v1/runs/run-abc/events');
    });

    it('should parse response without sse_url (auto_start=false)', () => {
      const response = {
        runId: 'run-def',
        status: 'created',
      };
      const result = CreateRunResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });
});

describe('Type Guard Functions', () => {
  describe('isTerminalStatus', () => {
    it('should return true for terminal statuses', () => {
      expect(isTerminalStatus('succeeded')).toBe(true);
      expect(isTerminalStatus('failed')).toBe(true);
      expect(isTerminalStatus('cancelled')).toBe(true);
    });

    it('should return false for non-terminal statuses', () => {
      expect(isTerminalStatus('queued')).toBe(false);
      expect(isTerminalStatus('running')).toBe(false);
    });
  });

  describe('isControlFlowNode', () => {
    it('should identify conditional nodes', () => {
      const node = {
        id: 'n1',
        type: 'conditional',
        conditional: {
          type: 'if' as const,
          expression: 'true',
          branches: {},
        },
      };
      expect(isControlFlowNode(node)).toBe(true);
    });

    it('should identify for_each nodes', () => {
      const node = {
        id: 'n2',
        type: 'for_each',
        for_each: {
          collection: '[]',
          item_var: 'x',
          body: [],
        },
      };
      expect(isControlFlowNode(node)).toBe(true);
    });

    it('should return false for regular task nodes', () => {
      const node = {
        id: 'n3',
        type: 'task',
        agent_id: 'echo',
      };
      expect(isControlFlowNode(node)).toBe(false);
    });
  });
});

describe('Safe Validation Helpers', () => {
  describe('safeValidateRun', () => {
    it('should return undefined for invalid run', () => {
      const result = safeValidateRun({ invalid: 'data' });
      expect(result).toBeUndefined();
    });

    it('should return run for valid input', () => {
      const run = {
        id: 'run-1',
        status: 'succeeded',
        created_at: '2024-01-15T09:55:00Z',
        updated_at: '2024-01-15T10:00:00Z',
      };
      const result = safeValidateRun(run);
      expect(result).toBeDefined();
      expect(result?.id).toBe('run-1');
    });
  });

  describe('safeValidateCreateRunResponse', () => {
    it('should capture sse_url when present', () => {
      const response = {
        runId: 'run-123',
        status: 'running',
        sse_url: '/api/v1/runs/run-123/events',
      };
      const result = safeValidateCreateRunResponse(response);
      expect(result?.sse_url).toBe('/api/v1/runs/run-123/events');
    });
  });
});

describe('Backend Wire Format Compatibility', () => {
  it('should handle Go time.Time as ISO 8601 strings', () => {
    // Go's json.Marshal outputs time.Time as RFC3339/ISO8601
    const run = {
      id: 'run-1',
      status: 'succeeded',
      started_at: '2024-01-15T10:00:00.123456789Z', // Go includes nanoseconds
      finished_at: '2024-01-15T10:05:00Z',
      created_at: '2024-01-15T09:55:00Z',
      updated_at: '2024-01-15T10:05:00Z',
    };
    const result = RunSchema.safeParse(run);
    expect(result.success).toBe(true);
  });

  it('should handle null optional fields', () => {
    const run = {
      id: 'run-1',
      status: 'queued',
      plan: null, // Go omitempty sends null for empty struct pointers
      started_at: null,
      created_at: '2024-01-15T09:55:00Z',
      updated_at: '2024-01-15T09:55:00Z',
    };
    const result = RunSchema.safeParse(run);
    expect(result.success).toBe(true);
  });

  it('should handle Go duration as number (nanoseconds)', () => {
    // Go's time.Duration is serialized as int64 nanoseconds
    const node = {
      id: 'node-1',
      type: 'task',
      timeout: 30000000000, // 30 seconds in nanoseconds
    };
    const result = NodeSpecSchema.safeParse(node);
    expect(result.success).toBe(true);
  });
});
