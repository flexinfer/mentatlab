import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock httpClient
// ---------------------------------------------------------------------------
const mockGet = vi.fn();

vi.mock('../httpClient', () => ({
  httpClient: {
    get: (...args: any[]) => mockGet(...args),
  },
}));

vi.mock('@/config/features', () => ({
  FeatureFlags: {},
}));

vi.mock('@/config/orchestrator', () => ({
  getOrchestratorBaseUrl: () => 'http://localhost:7070',
  getApiBaseUrl: () => 'http://localhost:7070',
}));

// Import after mocks
import { traceService, type TraceSpan } from '../traceService';

// ---------------------------------------------------------------------------
// Helpers — build Tempo OTLP JSON fixtures
// ---------------------------------------------------------------------------

function tempoSpan(overrides: Partial<{
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  startNano: string;
  endNano: string;
  statusCode: number;
  attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }>;
}> = {}) {
  return {
    traceId: overrides.traceId ?? 'abc123',
    spanId: overrides.spanId ?? 'span-1',
    parentSpanId: overrides.parentSpanId,
    name: overrides.name ?? 'TestOp',
    kind: 1,
    startTimeUnixNano: overrides.startNano ?? '1000000000000', // 1s in ns
    endTimeUnixNano: overrides.endNano ?? '1002000000000',     // 1.002s in ns (2ms duration)
    status: overrides.statusCode !== undefined ? { code: overrides.statusCode } : undefined,
    attributes: overrides.attributes,
  };
}

function tempoResponse(spans: ReturnType<typeof tempoSpan>[], serviceName = 'orchestrator') {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: 'service.name', value: { stringValue: serviceName } }],
        },
        scopeSpans: [{ scope: { name: 'mentatlab/scheduler' }, spans }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('traceService', () => {
  // ---- parseTempoResponse (tested via getTrace) ----

  describe('getTrace', () => {
    it('parses a single-span Tempo response', async () => {
      const resp = tempoResponse([tempoSpan()]);
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/traces/abc123'),
      );
      expect(data.traceID).toBe('abc123');
      expect(data.spans).toHaveLength(1);
      expect(data.spans[0].operationName).toBe('TestOp');
      expect(data.spans[0].serviceName).toBe('orchestrator');
    });

    it('calculates duration in microseconds', async () => {
      const resp = tempoResponse([
        tempoSpan({
          startNano: '1000000000',     // 1s = 1,000,000us
          endNano: '1005000000',       // 1.005s → diff = 5,000,000ns = 5000us
        }),
      ]);
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');
      expect(data.spans[0].duration).toBe(5000);
      expect(data.spans[0].startTime).toBe(1000000); // 1e9 ns / 1000 = 1,000,000us
    });

    it('parses span attributes', async () => {
      const resp = tempoResponse([
        tempoSpan({
          attributes: [
            { key: 'run_id', value: { stringValue: 'run-1' } },
            { key: 'node_count', value: { intValue: '5' } },
            { key: 'is_retry', value: { boolValue: true } },
          ],
        }),
      ]);
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');
      expect(data.spans[0].tags).toEqual({
        run_id: 'run-1',
        node_count: '5',
        is_retry: 'true',
      });
    });

    it('maps status code 2 to error', async () => {
      const resp = tempoResponse([tempoSpan({ statusCode: 2 })]);
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');
      expect(data.spans[0].status).toBe('error');
    });

    it('maps status code 1 to ok', async () => {
      const resp = tempoResponse([tempoSpan({ statusCode: 1 })]);
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');
      expect(data.spans[0].status).toBe('ok');
    });

    it('defaults unset status to ok for completed spans', async () => {
      const resp = tempoResponse([tempoSpan()]);
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');
      expect(data.spans[0].status).toBe('ok');
    });

    it('handles empty resourceSpans', async () => {
      mockGet.mockResolvedValue({ resourceSpans: [] });

      const data = await traceService.getTrace('empty');
      expect(data.spans).toHaveLength(0);
      expect(data.rootSpan).toBeUndefined();
    });

    it('handles batches field (legacy Tempo format)', async () => {
      const resp = {
        batches: [
          {
            resource: {
              attributes: [{ key: 'service.name', value: { stringValue: 'gateway' } }],
            },
            scopeSpans: [{ spans: [tempoSpan()] }],
          },
        ],
      };
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');
      expect(data.spans).toHaveLength(1);
      expect(data.spans[0].serviceName).toBe('gateway');
    });

    it('defaults serviceName to unknown when resource has no service.name', async () => {
      const resp = {
        resourceSpans: [
          {
            resource: { attributes: [] },
            scopeSpans: [{ spans: [tempoSpan()] }],
          },
        ],
      };
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');
      expect(data.spans[0].serviceName).toBe('unknown');
    });

    it('URL-encodes the trace ID', async () => {
      mockGet.mockResolvedValue({ resourceSpans: [] });

      await traceService.getTrace('abc/def');
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/traces/abc%2Fdef'),
      );
    });
  });

  // ---- buildSpanTree (tested via getTrace) ----

  describe('span tree building', () => {
    it('builds parent-child hierarchy', async () => {
      const resp = tempoResponse([
        tempoSpan({ spanId: 'root', name: 'StartRun' }),
        tempoSpan({ spanId: 'child-1', parentSpanId: 'root', name: 'ScheduleNode', startNano: '1001000000000', endNano: '1003000000000' }),
        tempoSpan({ spanId: 'child-2', parentSpanId: 'root', name: 'EmitEvent', startNano: '1002000000000', endNano: '1004000000000' }),
      ]);
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');

      expect(data.rootSpan).toBeDefined();
      expect(data.rootSpan!.operationName).toBe('StartRun');
      expect(data.rootSpan!.children).toHaveLength(2);
      expect(data.rootSpan!.children![0].operationName).toBe('ScheduleNode');
      expect(data.rootSpan!.children![1].operationName).toBe('EmitEvent');
    });

    it('sorts children by start time', async () => {
      const resp = tempoResponse([
        tempoSpan({ spanId: 'root', name: 'Root' }),
        tempoSpan({ spanId: 'late', parentSpanId: 'root', name: 'Late', startNano: '2000000000000', endNano: '2001000000000' }),
        tempoSpan({ spanId: 'early', parentSpanId: 'root', name: 'Early', startNano: '1001000000000', endNano: '1002000000000' }),
      ]);
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');
      expect(data.rootSpan!.children![0].operationName).toBe('Early');
      expect(data.rootSpan!.children![1].operationName).toBe('Late');
    });

    it('handles orphaned spans as roots', async () => {
      const resp = tempoResponse([
        tempoSpan({ spanId: 'a', name: 'A', parentSpanId: 'missing-parent' }),
        tempoSpan({ spanId: 'b', name: 'B' }),
      ]);
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');
      // Both should be roots since 'missing-parent' doesn't exist
      expect(data.spans).toHaveLength(2);
      // rootSpan is the first root sorted by start time
      expect(data.rootSpan).toBeDefined();
    });

    it('handles deeply nested spans', async () => {
      const resp = tempoResponse([
        tempoSpan({ spanId: 'L0', name: 'L0' }),
        tempoSpan({ spanId: 'L1', parentSpanId: 'L0', name: 'L1', startNano: '1001000000000', endNano: '1002000000000' }),
        tempoSpan({ spanId: 'L2', parentSpanId: 'L1', name: 'L2', startNano: '1001000000000', endNano: '1002000000000' }),
      ]);
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');
      expect(data.rootSpan!.children![0].children![0].operationName).toBe('L2');
    });
  });

  // ---- getTraceForRun ----

  describe('getTraceForRun', () => {
    it('passes run_id as query parameter', async () => {
      const resp = tempoResponse([tempoSpan()]);
      mockGet.mockResolvedValue(resp);

      await traceService.getTraceForRun('run-abc');

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/traces'),
        { params: { run_id: 'run-abc' } },
      );
    });

    it('sets traceID from first span when response has spans', async () => {
      const resp = tempoResponse([tempoSpan({ traceId: 'trace-xyz' })]);
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTraceForRun('run-abc');
      expect(data.traceID).toBe('trace-xyz');
    });

    it('sets traceID to empty string when no spans', async () => {
      mockGet.mockResolvedValue({ resourceSpans: [] });

      const data = await traceService.getTraceForRun('run-abc');
      expect(data.traceID).toBe('');
    });
  });

  // ---- Multiple services in one trace ----

  describe('multi-service traces', () => {
    it('assigns correct serviceName from each resource', async () => {
      const resp = {
        resourceSpans: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: 'gateway' } }] },
            scopeSpans: [{ spans: [tempoSpan({ spanId: 's1', name: 'ProxyRequest' })] }],
          },
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: 'orchestrator' } }] },
            scopeSpans: [{ spans: [tempoSpan({ spanId: 's2', name: 'StartRun' })] }],
          },
        ],
      };
      mockGet.mockResolvedValue(resp);

      const data = await traceService.getTrace('abc123');
      expect(data.spans).toHaveLength(2);

      const gateway = data.spans.find((s) => s.spanID === 's1');
      const orch = data.spans.find((s) => s.spanID === 's2');
      expect(gateway!.serviceName).toBe('gateway');
      expect(orch!.serviceName).toBe('orchestrator');
    });
  });
});
