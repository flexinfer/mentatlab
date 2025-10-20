// streamingWorker.ts - Lightweight parser/normalizer worker used optionally by EnhancedStream
// This worker is intentionally minimal: it accepts a small set of messages:
//  - { type: 'config', cloudevents: boolean }       -> sets runtime options
//  - { type: 'parse', __requestId, payload: string } -> attempts to JSON.parse(payload) and posts back { __requestId, payload: { data, ... } }
// The EnhancedStream code expects the worker to post messages shaped like { __requestId, payload: { data, envelope?, meta? } }.
//
// Keep this file small and dependency-free so Vite can bundle it reliably.
const globalSelf: any = self as any;
let cloudevents = false;

globalSelf.addEventListener('message', (evt: MessageEvent) => {
  const msg = evt.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'config') {
    cloudevents = !!msg.cloudevents;
    return;
  }

  if (msg.type === 'parse') {
    const reqId = msg.__requestId;
    const payload = msg.payload;
    try {
      let parsed: any = payload;

      // If payload is a string, try to JSON.parse it
      if (typeof payload === 'string') {
        try {
          parsed = JSON.parse(payload);
        } catch {
          // leave as raw string if parse fails
          parsed = payload;
        }
      }

      // If CloudEvents envelope is expected, try to unwrap `.data`
      if (cloudevents && parsed && typeof parsed === 'object' && 'data' in parsed) {
        parsed = parsed.data;
      }

      // Prepare the normalized result. Keep it small and predictable.
      const normalized = {
        data: parsed,
        meta: {
          parsedAt: new Date().toISOString(),
        },
      };

      globalSelf.postMessage({ __requestId: reqId, payload: normalized });
    } catch (err: any) {
      // Return an error shape the main thread can tolerate
      globalSelf.postMessage({ __requestId: msg.__requestId, error: String(err ?? 'unknown') });
    }
  }
});