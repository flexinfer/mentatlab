/**
 * Orchestrator Run SSE client (via Gateway)
 *
 * Configuration:
 * - Base URL is resolved from VITE_GATEWAY_BASE_URL (preferred) or VITE_GATEWAY_URL; then window.location.origin; then http://127.0.0.1:8080
 * - All paths are relative to the Gateway base.
 *
 * Endpoint (Gateway):
 *   GET /api/v1/runs/:runId/events[?replay=N][&fromId=lastEventId]
 *
 * Behavior:
 * - Uses native EventSource when available.
 * - Tracks lastEventId from MessageEvent.lastEventId and resumes using:
 *     • Native EventSource's built-in Last-Event-ID on reconnect
 *     • Additionally appends fromId=lastEventId to querystring to help upstream resume
 * - Exponential backoff schedule: [1000, 2000, 5000, 10000, 30000] ms
 * - Heartbeat watchdog: if no events for 45s, force reconnect with lastEventId
 * - Clean close() cancels timers, closes EventSource, and resets backoff state
 * - JSON parsing: attempts to JSON.parse(event.data), passes both raw evt and parsed
 *
 * Curl example (align with backend docs):
 *   Subscribe with Last-Event-ID (native EventSource automatically sends this on reconnect)
 *     curl -N "$GATEWAY/api/v1/runs/<run_id>/events"
 *
 *   Subscribe starting from a specific event id:
 *     curl -N "$GATEWAY/api/v1/runs/<run_id>/events?fromId=<lastEventId>"
 *
 *   Subscribe with replay of the last N events:
 *     curl -N "$GATEWAY/api/v1/runs/<run_id>/events?replay=100"
 */

import { getGatewayBaseUrl } from '@/config/orchestrator';

export type RunSSEOpenHandler = () => void;
export type RunSSEErrorHandler = (err: any) => void;
export type RunSSEEventHandler = (evt: MessageEvent, parsed?: any) => void;

export interface SubscribeOptions {
  replay?: number;
  onEvent: RunSSEEventHandler;
  onOpen?: RunSSEOpenHandler;
  onError?: RunSSEErrorHandler;
  // Optionally override base URL (useful for tests)
  baseUrl?: string;
  // Heartbeat timeout in ms (default 45000)
  heartbeatMs?: number;
  // Transport preference:
  //  - 'auto' (default): prefer native EventSource
  //  - 'native': force native EventSource
  //  - 'polyfill': use fetch-based SSE polyfill (allows Last-Event-ID header)
  transport?: 'auto' | 'native' | 'polyfill';
}

/**
 * Subscribe to Orchestrator Run events via Gateway SSE.
 *
 * Returns a handle with close() to unsubscribe and stop any reconnection attempts.
 */
export function subscribeRunEvents(
  runId: string,
  options: SubscribeOptions
): { close(): void } {
  const {
    replay,
    onEvent,
    onOpen,
    onError,
    baseUrl,
    heartbeatMs = 45_000,
    transport = 'auto',
  } = options;

  const gateway = (baseUrl || getGatewayBaseUrl()).replace(/\/+$/, '');
  const backoff = [1000, 2000, 5000, 10000, 30000];

  let es: EventSource | null = null;
  let stopped = false;
  let reconnectAttempt = 0;
  let lastEventId: string | null = null;
  let lastActivityAt = Date.now();
  let heartbeatTimer: number | null = null;
  let reconnectTimer: number | null = null;

  // Polyfill specific state
  let polyfillAbort: AbortController | null = null;
  let polyfillReaderActive = false;

  function buildUrl(): string {
    const u = new URL(`${gateway}/api/v1/runs/${encodeURIComponent(runId)}/events`);
    if (typeof replay === 'number' && replay > 0) {
      u.searchParams.set('replay', String(replay));
    }
    // Append fromId for explicit resume (helps upstream gate/orchestrator)
    if (lastEventId) {
      u.searchParams.set('fromId', lastEventId);
    }
    return u.toString();
  }

  function scheduleHeartbeat(): void {
    clearHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      const idleFor = Date.now() - lastActivityAt;
      if (idleFor >= heartbeatMs) {
        // Force a reconnect to recover from silent stalls
        tryCloseES();
        attemptReconnect();
      }
    }, Math.min(heartbeatMs, 10_000)) as unknown as number; // poll up to every 10s
  }

  function clearHeartbeat(): void {
    if (heartbeatTimer != null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function tryCloseES(): void {
    if (es) {
      try { es.close(); } catch {}
      es = null;
    }
    // Stop any polyfill fetch stream
    if (polyfillAbort) {
      try { polyfillAbort.abort(); } catch {}
      polyfillAbort = null;
    }
    polyfillReaderActive = false;
  }

  function resetBackoff(): void {
    reconnectAttempt = 0;
  }

  function attemptReconnect(): void {
    if (stopped) return;

    const delay = backoff[Math.min(reconnectAttempt, backoff.length - 1)];
    reconnectAttempt++;
    reconnectTimer = window.setTimeout(() => {
      if (!stopped) {
        open();
      }
    }, delay) as unknown as number;
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function open(): void {
    tryCloseES();
    clearReconnectTimer();

    const url = buildUrl();

    const shouldUsePolyfill =
      transport === 'polyfill' ||
      (transport === 'auto' && typeof EventSource === 'undefined');

    if (shouldUsePolyfill) {
      openPolyfill(url);
      return;
    }

    // Native EventSource will automatically include Last-Event-ID it has seen.
    es = new EventSource(url, { withCredentials: false });

    // Guard a first-open timeout in case servers hang without firing onerror
    const firstOpenGuard = window.setTimeout(() => {
      // If still connecting (readyState 0) after guard window, force reconnect
      if (es && (es as any).readyState === 0) {
        tryCloseES();
        attemptReconnect();
      }
    }, 10_000); // 10s guard

    if (!es) {
      // If instantiation failed synchronously, schedule reconnect
      attemptReconnect();
      return;
    }

    es.onopen = () => {
      window.clearTimeout(firstOpenGuard);
      lastActivityAt = Date.now();
      resetBackoff();
      scheduleHeartbeat();
      if (onOpen) {
        try {
          onOpen();
        } catch {}
      }
    };

    es.onmessage = (evt: MessageEvent) => {
      lastActivityAt = Date.now();
      if ((evt as any).lastEventId) {
        lastEventId = (evt as any).lastEventId;
      }
      let parsed: any = undefined;
      if (typeof evt.data === 'string' && evt.data.length) {
        try {
          parsed = JSON.parse(evt.data);
        } catch {
          // tolerate non-JSON frames
        }
      }
      try {
        onEvent(evt, parsed);
      } catch {}
    };

    es.onerror = (err: any) => {
      window.clearTimeout(firstOpenGuard);
      if (onError) {
        try { onError(err); } catch {}
      }
      tryCloseES();
      clearHeartbeat();
      if (!stopped) {
        attemptReconnect();
      }
    };
  }

  // Minimal SSE polyfill that:
  // - Uses fetch to stream the event data
  // - Can set the Last-Event-ID header explicitly when reconnecting
  // - Parses text/event-stream frames and dispatches synthetic MessageEvents
  function openPolyfill(url: string): void {
    // Guard first-open similarly
    let firstOpened = false;
    const firstOpenGuard = window.setTimeout(() => {
      if (!firstOpened) {
        tryCloseES();
        attemptReconnect();
      }
    }, 10_000);

    polyfillAbort = new AbortController();

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      // Explicit Last-Event-ID header for resume, in addition to fromId query
      ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
      // Cache control hints
      'Cache-Control': 'no-cache',
    };

    fetch(url, {
      method: 'GET',
      headers,
      signal: polyfillAbort.signal,
      // include credentials if needed later; default keep it simple
    })
      .then(async (resp) => {
        if (!resp.ok || !resp.body) {
          throw new Error(`SSE polyfill HTTP error ${resp.status}`);
        }

        firstOpened = true;
        window.clearTimeout(firstOpenGuard);

        lastActivityAt = Date.now();
        resetBackoff();
        scheduleHeartbeat();

        if (onOpen) {
          try { onOpen(); } catch {}
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        polyfillReaderActive = true;

        while (!stopped) {
          const { value, done } = await reader.read().catch((e) => {
            // Reading errored (e.g., abort), break loop to reconnect
            return { value: undefined, done: true };
          });
          if (done) break;
          if (!value) continue;

          buffer += decoder.decode(value, { stream: true });
          // Parse complete SSE events separated by double newline
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const rawEvent = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const parsed = parseSSEEvent(rawEvent);
            if (!parsed) continue;

            // Track activity and lastEventId
            lastActivityAt = Date.now();
            if (parsed.id) lastEventId = parsed.id;

            const dataStr = parsed.data ?? '';
            let parsedJSON: any = undefined;
            if (dataStr) {
              try { parsedJSON = JSON.parse(dataStr); } catch {}
            }

            // Dispatch synthetic MessageEvent shape
            const syntheticEvt = {
              data: dataStr,
              lastEventId: parsed.id || '',
              type: parsed.event || 'message',
            } as unknown as MessageEvent;

            try {
              onEvent(syntheticEvt, parsedJSON);
            } catch {}
          }
        }

        // If exited read loop not via stop, schedule reconnect
        polyfillReaderActive = false;
        if (!stopped) {
          clearHeartbeat();
          attemptReconnect();
        }
      })
      .catch((err) => {
        window.clearTimeout(firstOpenGuard);
        if (onError) {
          try { onError(err); } catch {}
        }
        polyfillReaderActive = false;
        if (!stopped) {
          clearHeartbeat();
          attemptReconnect();
        }
      });
  }

  function parseSSEEvent(chunk: string): { id?: string; event?: string; data?: string } | null {
    // text/event-stream fields: id:, event:, data:, retry:
    // Combine multiple data: lines with '\n'
    const lines = chunk.split('\n');
    let id: string | undefined;
    let event: string | undefined;
    const dataLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.replace(/\r$/, '');
      if (!trimmed) continue;
      if (trimmed.startsWith(':')) {
        // comment line - ignore
        continue;
      }
      const [field, ...rest] = trimmed.split(':');
      const value = rest.join(':').replace(/^ /, '');
      switch (field) {
        case 'id':
          id = value;
          break;
        case 'event':
          event = value;
          break;
        case 'data':
          dataLines.push(value);
          break;
        default:
          // ignore unknown fields
          break;
      }
    }

    return {
      id,
      event,
      data: dataLines.length ? dataLines.join('\n') : undefined,
    };
  }

  // Kick off initial connection
  open();

  return {
    close(): void {
      stopped = true;
      clearHeartbeat();
      clearReconnectTimer();
      tryCloseES();
      // reset state
      resetBackoff();
    },
  };
}