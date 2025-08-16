/**
 * parseRunEvent - normalize event frames from Orchestrator/Gateway SSE
 *
 * Accepts either:
 *  - a browser MessageEvent from EventSource.onmessage (evt.data is string)
 *  - a plain object that looks like an SSE frame: { id?: string|number, event?: string, data?: any }
 *
 * Output:
 *   {
 *     seq: number;         // best-effort numeric sequence (derived from id if numeric or increment)
 *     type: string;        // event type (from 'event' or data.type/kind fallback)
 *     data: any;           // parsed payload (JSON-decoded if needed)
 *     ts?: string;         // timestamp when available
 *     nodeId?: string;     // extracted node id if present in payload
 *     level?: string;      // log level if present in payload
 *     id?: string;         // original lastEventId or id as string
 *   }
 *
 * Notes:
 * - If given a MessageEvent, we JSON.parse(evt.data) when possible.
 * - We try multiple common homes for fields: data.ts / data.timestamp, data.node_id / data.node / data.id
 */

export interface NormalizedRunEvent {
  seq: number;
  type: string;
  data: any;
  ts?: string;
  nodeId?: string;
  level?: string;
  id?: string;
}

let __seqFallback = 0;

function toNumberOrNaN(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : NaN;
}

export function parseRunEvent(input: MessageEvent | { id?: any; event?: string; data?: any }): NormalizedRunEvent {
  let rawId: string | undefined;
  let eventName: string | undefined;
  let data: any = undefined;

  // Case A: Browser MessageEvent
  if (isMessageEvent(input)) {
    rawId = (input as any).lastEventId || undefined;
    const d = (input as MessageEvent).data;
    if (typeof d === 'string') {
      try {
        data = JSON.parse(d);
      } catch {
        data = d; // leave as text
      }
    } else {
      data = d;
    }
    // MessageEvent doesn't carry a named SSE 'event', so attempt to infer from payload
    eventName = inferTypeFromData(data);
  } else {
    // Case B: Plain-ish SSE frame object
    const obj = input as { id?: any; event?: string; data?: any };
    rawId = obj?.id != null ? String(obj.id) : undefined;
    eventName = obj?.event || inferTypeFromData(obj?.data);
    data = obj?.data;
    // If data is a string JSON, parse it
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {/* keep as string */}
    }
  }

  // seq derivation: prefer numeric id; else try data.sequence; else fallback counter
  let seq = toNumberOrNaN(rawId);
  if (Number.isNaN(seq)) {
    const fromPayload = toNumberOrNaN((data && (data.sequence ?? data.seq ?? data.offset)) as any);
    if (Number.isFinite(fromPayload)) {
      seq = fromPayload;
    } else {
      __seqFallback += 1;
      seq = __seqFallback;
    }
  }

  // Timestamp
  const ts = (data && (data.ts || data.time || data.timestamp)) as string | undefined;

  // Node ID
  const nodeId = (data && (data.node_id || data.nodeId || data.node || data.id)) as string | undefined;

  // Level (logs)
  const level = (data && (data.level || data.severity || data.log_level)) as string | undefined;

  return {
    seq,
    type: eventName || 'message',
    data,
    ts,
    nodeId,
    level,
    id: rawId,
  };
}

function isMessageEvent(x: any): x is MessageEvent {
  return x && typeof x === 'object' && 'data' in x && ('lastEventId' in x || x.type === 'message');
}

function inferTypeFromData(data: any): string | undefined {
  if (!data) return undefined;
  return (data.type as string) || (data.kind as string) || (data.event as string);
}