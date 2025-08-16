/**
 * Streaming Parser Worker (skeleton)
 *
 * Responsibilities:
 * - Receive raw WS/SSE frames as strings/objects from main thread
 * - Optionally unwrap CloudEvents envelopes when configured
 * - Post back a normalized shape: { data, envelope?, meta }
 *
 * Messages expected from main thread:
 * - { type: 'config', cloudevents: boolean }
 * - { type: 'parse', __requestId: string, payload: string | object }
 *
 * Messages posted back to main thread:
 * - { __requestId: string, payload: { data: any, envelope?: Envelope, meta: Meta } }
 *
 * No external dependencies.
 */

export {};

declare const self: DedicatedWorkerGlobalScope;

type Envelope = {
  specversion?: string;
  id?: string;
  source?: string;
  type?: string;
  time?: string;
  datacontenttype?: string;
};

type Meta = {
  eventType: string;
  time: string;
};

const state = {
  // Toggled by a 'config' message; safe default is false (no envelope expected)
  cloudevents: false,
};

// Lightweight event type derivation
function deriveEventType(input: any): string {
  try {
    if (!input || typeof input !== 'object') return 'unknown';
    // Common fields we might see
    return (
      input.type ||
      input.event_type ||
      input.kind ||
      (input.data && (input.data.type || input.data.event_type || input.data.kind)) ||
      'unknown'
    );
  } catch {
    return 'unknown';
  }
}

function pickEnvelopeFields(obj: any): Envelope {
  try {
    return {
      specversion: obj?.specversion,
      id: obj?.id,
      source: obj?.source,
      type: obj?.type,
      time: obj?.time,
      datacontenttype: obj?.datacontenttype,
    };
  } catch {
    return {};
  }
}

function isCloudEvent(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  // Basic heuristic: CE JSON envelope typically includes specversion and type, plus data
  const hasSpec = typeof obj.specversion === 'string';
  const hasType = typeof obj.type === 'string';
  const hasData = 'data' in obj;
  return hasSpec && hasType && hasData;
}

function tryJsonParse(input: string): any {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

function normalize(payload: unknown, ceEnabled: boolean): { data: any; envelope?: Envelope; meta: Meta } {
  const nowIso = new Date().toISOString();

  // If payload is a string, try to parse JSON; otherwise use as-is
  const asString = typeof payload === 'string' ? (payload as string) : undefined;
  const parsed = typeof payload === 'string' ? tryJsonParse(payload as string) : payload;

  // If parsing failed and we only have a string, return it as data
  if (asString && parsed === undefined) {
    return {
      data: asString,
      meta: { eventType: 'text', time: nowIso },
    };
  }

  const obj = parsed;

  // CloudEvents unwrap path (only when enabled)
  if (ceEnabled && isCloudEvent(obj)) {
    const env = pickEnvelopeFields(obj);
    // CE envelope carries the actual data in envelope.data
    const data = (obj as any).data;
    const meta: Meta = {
      eventType: env.type || deriveEventType(data),
      time: env.time || nowIso,
    };
    return { data, envelope: env, meta };
  }

  // Non-CE: Prefer obj.data if it exists, otherwise the entire object
  const data = (obj && typeof obj === 'object' && 'data' in (obj as any)) ? (obj as any).data : obj;
  const meta: Meta = {
    eventType: deriveEventType(obj),
    time: nowIso,
  };
  return { data, meta };
}

// Message handling
self.addEventListener('message', (evt: MessageEvent) => {
  const msg = evt.data;

  if (!msg || typeof msg !== 'object') {
    return;
  }

  // Configuration message to toggle CloudEvents mode
  if (msg.type === 'config') {
    state.cloudevents = !!msg.cloudevents;
    // No response necessary for config
    return;
  }

  // Parse request
  if (msg.type === 'parse') {
    const reqId: string | undefined = msg.__requestId;
    if (!reqId) {
      // Ignore malformed requests
      return;
    }

    try {
      const normalized = normalize(msg.payload, state.cloudevents);
      self.postMessage({
        __requestId: reqId,
        payload: normalized,
      });
    } catch (e) {
      // On any unexpected error, fall back to returning minimal shape
      const nowIso = new Date().toISOString();
      self.postMessage({
        __requestId: reqId,
        payload: {
          data: msg?.payload ?? null,
          meta: { eventType: 'unknown', time: nowIso } as Meta,
        },
      });
    }
  }
});