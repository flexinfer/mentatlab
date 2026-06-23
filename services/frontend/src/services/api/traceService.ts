/**
 * Trace API client.
 * Queries distributed traces via the gateway's Tempo proxy.
 */

import { httpClient } from './httpClient';
import { getApiBaseUrl } from '@/config/orchestrator';

// --- Types ---

export interface TraceSpan {
  traceID: string;
  spanID: string;
  parentSpanID?: string;
  operationName: string;
  serviceName: string;
  startTime: number; // microseconds since epoch
  duration: number;  // microseconds
  status: 'ok' | 'error' | 'unset';
  tags: Record<string, string>;
  children?: TraceSpan[];
}

export interface TraceData {
  traceID: string;
  spans: TraceSpan[];
  rootSpan?: TraceSpan;
}

// --- Tempo OTLP JSON response types ---

interface TempoSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status?: { code?: number; message?: string };
  attributes?: Array<{ key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }>;
}

interface TempoScopeSpan {
  scope?: { name?: string };
  spans: TempoSpan[];
}

interface TempoResourceSpan {
  resource?: {
    attributes?: Array<{ key: string; value: { stringValue?: string } }>;
  };
  scopeSpans: TempoScopeSpan[];
}

interface TempoTraceResponse {
  batches?: TempoResourceSpan[];
  resourceSpans?: TempoResourceSpan[];
}

// --- Service ---

function parseTempoResponse(data: TempoTraceResponse): TraceSpan[] {
  const spans: TraceSpan[] = [];
  const resourceSpans = data.resourceSpans || data.batches || [];

  for (const rs of resourceSpans) {
    const serviceName = rs.resource?.attributes?.find(
      (a) => a.key === 'service.name'
    )?.value?.stringValue || 'unknown';

    for (const ss of rs.scopeSpans) {
      for (const span of ss.spans) {
        const startNano = BigInt(span.startTimeUnixNano);
        const endNano = BigInt(span.endTimeUnixNano);
        const durationMicro = Number((endNano - startNano) / 1000n);
        const startMicro = Number(startNano / 1000n);

        const tags: Record<string, string> = {};
        for (const attr of span.attributes || []) {
          tags[attr.key] = attr.value.stringValue
            || attr.value.intValue
            || String(attr.value.boolValue ?? '');
        }

        let status: 'ok' | 'error' | 'unset' = 'unset';
        if (span.status?.code === 2) status = 'error';
        else if (span.status?.code === 1) status = 'ok';
        else if (durationMicro >= 0) status = 'ok'; // default to ok for completed spans

        spans.push({
          traceID: span.traceId,
          spanID: span.spanId,
          parentSpanID: span.parentSpanId || undefined,
          operationName: span.name,
          serviceName,
          startTime: startMicro,
          duration: durationMicro,
          status,
          tags,
        });
      }
    }
  }

  return spans;
}

function buildSpanTree(spans: TraceSpan[]): TraceSpan[] {
  const byId = new Map<string, TraceSpan>();
  for (const s of spans) {
    byId.set(s.spanID, { ...s, children: [] });
  }

  const roots: TraceSpan[] = [];
  for (const s of byId.values()) {
    if (s.parentSpanID && byId.has(s.parentSpanID)) {
      byId.get(s.parentSpanID)!.children!.push(s);
    } else {
      roots.push(s);
    }
  }

  // Sort children by start time
  for (const s of byId.values()) {
    s.children?.sort((a, b) => a.startTime - b.startTime);
  }

  return roots.sort((a, b) => a.startTime - b.startTime);
}

class TraceService {
  async getTrace(traceID: string): Promise<TraceData> {
    const base = getApiBaseUrl().replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
    const url = `${base}/api/v1/traces/${encodeURIComponent(traceID)}`;
    const data = await httpClient.get<TempoTraceResponse>(url);
    const spans = parseTempoResponse(data);
    const tree = buildSpanTree(spans);

    return {
      traceID,
      spans,
      rootSpan: tree[0],
    };
  }

  async getTraceForRun(runID: string): Promise<TraceData> {
    const base = getApiBaseUrl().replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
    const url = `${base}/api/v1/traces`;
    const data = await httpClient.get<TempoTraceResponse>(url, {
      params: { run_id: runID },
    });
    const spans = parseTempoResponse(data);
    const tree = buildSpanTree(spans);

    return {
      traceID: spans[0]?.traceID || '',
      spans,
      rootSpan: tree[0],
    };
  }
}

export const traceService = new TraceService();
export default traceService;
