/**
 * Contract tests for SSE event parsing
 *
 * These tests verify that the frontend correctly parses events
 * matching the backend's wire format (orchestrator-go/pkg/types/event.go)
 */
import { describe, it, expect } from 'vitest';
import {
  LogEventDataSchema,
  CheckpointEventDataSchema,
  NodeStatusEventDataSchema,
  RunStatusEventDataSchema,
  ProgressEventDataSchema,
  BaseEventSchema,
  parseEventData,
  safeValidateSSEEvent,
} from '@/schemas/event.schema';
import { parseRunEvent } from '@/services/streaming/parse';

describe('Event Schema Contracts', () => {
  describe('LogEventData', () => {
    it('should parse valid log event with all fields', () => {
      const data = {
        level: 'info',
        message: 'Processing started',
        fields: { node: 'node-1', step: '1' },
      };
      const result = LogEventDataSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
    });

    it('should parse log event without optional fields', () => {
      const data = {
        level: 'debug',
        message: 'Debug message',
      };
      const result = LogEventDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept warning level (backend uses "warning" not "warn")', () => {
      const data = {
        level: 'warning',
        message: 'Something might be wrong',
      };
      const result = LogEventDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid log level', () => {
      const data = {
        level: 'warn', // Backend uses "warning", not "warn"
        message: 'Test',
      };
      const result = LogEventDataSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('CheckpointEventData', () => {
    it('should parse checkpoint with artifact reference', () => {
      const data = {
        label: 'model_checkpoint',
        artifact_ref: 's3://bucket/path/to/checkpoint.pt',
        metadata: { epoch: 10, loss: 0.5 },
      };
      const result = CheckpointEventDataSchema.safeParse(data);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
    });

    it('should parse minimal checkpoint', () => {
      const data = { label: 'progress' };
      const result = CheckpointEventDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('NodeStatusEventData', () => {
    it('should parse succeeded status with exit code', () => {
      const data = {
        status: 'succeeded',
        exit_code: 0,
      };
      const result = NodeStatusEventDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should parse failed status with error', () => {
      const data = {
        status: 'failed',
        exit_code: 1,
        error: 'Process exited with non-zero status',
      };
      const result = NodeStatusEventDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should parse running status', () => {
      const data = { status: 'running' };
      const result = NodeStatusEventDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept all valid node statuses', () => {
      const validStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'skipped'];
      for (const status of validStatuses) {
        const result = NodeStatusEventDataSchema.safeParse({ status });
        expect(result.success, `status "${status}" should be valid`).toBe(true);
      }
    });
  });

  describe('RunStatusEventData', () => {
    it('should parse all valid run statuses', () => {
      const validStatuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
      for (const status of validStatuses) {
        const result = RunStatusEventDataSchema.safeParse({ status });
        expect(result.success, `status "${status}" should be valid`).toBe(true);
      }
    });

    it('should reject deprecated statuses', () => {
      const deprecatedStatuses = ['pending', 'completed', 'canceled'];
      for (const status of deprecatedStatuses) {
        const result = RunStatusEventDataSchema.safeParse({ status });
        expect(result.success, `status "${status}" should be invalid`).toBe(false);
      }
    });
  });

  describe('ProgressEventData', () => {
    it('should parse progress event', () => {
      const data = {
        current: 50,
        total: 100,
        message: 'Processing files...',
      };
      const result = ProgressEventDataSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('BaseEvent (wire format)', () => {
    it('should parse complete SSE event envelope', () => {
      const event = {
        id: '123',
        run_id: 'run-abc',
        type: 'log',
        node_id: 'node-1',
        timestamp: '2024-01-15T10:30:00Z',
        data: { level: 'info', message: 'Test' },
      };
      const result = BaseEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it('should parse event without optional fields', () => {
      const event = {
        id: '1',
        run_id: 'run-1',
        type: 'hello',
        timestamp: '2024-01-15T10:30:00Z',
      };
      const result = BaseEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });
  });
});

describe('parseRunEvent (normalization)', () => {
  it('should normalize browser MessageEvent format', () => {
    // Simulating browser MessageEvent.data as JSON string
    const msgEvent = {
      data: JSON.stringify({
        id: '100',
        type: 'log',
        data: { level: 'info', message: 'Hello' },
      }),
      lastEventId: '100',
      type: 'message',
    };

    const result = parseRunEvent(msgEvent);
    expect(result.seq).toBe(100);
    expect(result.type).toBe('log');
  });

  it('should extract nested level from data.data (backend LogEvent structure)', () => {
    const event = {
      id: '1',
      type: 'log',
      data: {
        data: { level: 'warning', message: 'Nested message' },
      },
    };

    const result = parseRunEvent(event);
    expect(result.level).toBe('warning');
  });

  it('should extract top-level level when present', () => {
    const event = {
      id: '2',
      type: 'log',
      data: { level: 'error', message: 'Direct level' },
    };

    const result = parseRunEvent(event);
    expect(result.level).toBe('error');
  });

  it('should extract nodeId from various field names', () => {
    const variations = [
      { data: { node_id: 'node-1' } },
      { data: { nodeId: 'node-2' } },
      { data: { node: 'node-3' } },
    ];

    expect(parseRunEvent(variations[0]).nodeId).toBe('node-1');
    expect(parseRunEvent(variations[1]).nodeId).toBe('node-2');
    expect(parseRunEvent(variations[2]).nodeId).toBe('node-3');
  });

  it('should use fallback sequence when id is not numeric', () => {
    const event1 = { id: 'non-numeric', type: 'log' };
    const event2 = { id: 'also-non-numeric', type: 'log' };

    const r1 = parseRunEvent(event1);
    const r2 = parseRunEvent(event2);

    expect(typeof r1.seq).toBe('number');
    expect(typeof r2.seq).toBe('number');
    expect(r2.seq).toBeGreaterThan(r1.seq);
  });
});

describe('parseEventData (type discrimination)', () => {
  it('should parse log event data correctly', () => {
    const data = { level: 'info', message: 'Test' };
    const result = parseEventData('log', data);
    expect(result).toEqual(data);
  });

  it('should return undefined for invalid data', () => {
    const result = parseEventData('log', { invalid: 'data' });
    expect(result).toBeUndefined();
  });

  it('should return raw data for unknown event types', () => {
    const data = { custom: 'field' };
    const result = parseEventData('unknown_type', data);
    expect(result).toEqual(data);
  });
});

describe('safeValidateSSEEvent', () => {
  it('should return undefined for invalid events', () => {
    const result = safeValidateSSEEvent({ missing: 'required fields' });
    expect(result).toBeUndefined();
  });

  it('should return parsed event for valid input', () => {
    const event = {
      id: '1',
      run_id: 'run-1',
      type: 'log',
      timestamp: '2024-01-15T10:30:00Z',
    };
    const result = safeValidateSSEEvent(event);
    expect(result).toBeDefined();
    expect(result?.type).toBe('log');
  });
});
