/**
 * Orchestrator SSE helper
 *
 * Usage:
 *  const client = new OrchestratorSSE({ baseUrl: 'http://localhost:7070', replay: 10 });
 *  client.connect(runId, {
 *    onHello: (ev) => {},
 *    onCheckpoint: (cp) => {},
 *    onStatus: (s) => {},
 *    onError: (err) => {}
 *  });
 *  client.close();
 *
 * Notes:
 * - Uses native EventSource (browser). Query param `replay` is supported.
 * - The server supports Last-Event-ID for resume; browsers automatically send Last-Event-ID on reconnect.
 * - Authentication must be handled by the application (cookies or URL-based tokens) since EventSource
 *   doesn't allow custom headers in browsers.
 */

import { Checkpoint, OrchestratorEvent } from '@/types/orchestrator';

export type OrchestratorSSEHandlers = {
  onHello?: (data: { runId: string }) => void;
  onCheckpoint?: (cp: Checkpoint) => void;
  onStatus?: (data: { runId: string; status: string }) => void;
  onRaw?: (event: OrchestratorEvent) => void;
  onOpen?: () => void;
  onError?: (err: Event | Error) => void;
};

export type OrchestratorSSEConfig = {
  baseUrl?: string; // e.g. http://localhost:7070
  replay?: number; // default 10
  debug?: boolean;
};

/**
 * Simple SSE client for orchestrator run events
 */
export class OrchestratorSSE {
  private es: EventSource | null = null;
  private config: OrchestratorSSEConfig;
  private handlers: OrchestratorSSEHandlers = {};
  private currentRunId: string | null = null;

  constructor(config: OrchestratorSSEConfig = {}) {
    this.config = {
      baseUrl: config.baseUrl || (import.meta.env.VITE_API_URL as string) || 'http://localhost:7070',
      replay: typeof config.replay === 'number' ? Math.max(0, Math.min(100, config.replay)) : 10,
      debug: !!config.debug
    };
  }

  private buildUrl(runId: string, replay?: number): string {
    const base = this.config.baseUrl!.replace(/\/$/, '');
    const q = new URLSearchParams();
    if (replay !== undefined) q.set('replay', String(replay));
    return `${base}/runs/${encodeURIComponent(runId)}/events${q.toString() ? `?${q.toString()}` : ''}`;
  }

  connect(runId: string, handlers: OrchestratorSSEHandlers = {}, replay?: number): Promise<void> {
    this.handlers = handlers;
    this.currentRunId = runId;

    return new Promise((resolve, reject) => {
      try {
        const url = this.buildUrl(runId, replay ?? this.config.replay);
        if (this.config.debug) console.debug('[OrchestratorSSE] connecting to', url);

        // Close previous if present
        this.close();

        this.es = new EventSource(url, { withCredentials: false });

        this.es.onopen = () => {
          if (this.config.debug) console.debug('[OrchestratorSSE] open');
          this.handlers.onOpen?.();
          resolve();
        };

        this.es.onerror = (ev) => {
          if (this.config.debug) console.warn('[OrchestratorSSE] error', ev);
          this.handlers.onError?.(ev);
          // Do not reject here; EventSource may reconnect automatically.
        };

        // Generic message handler (for events without explicit event: <type>)
        this.es.onmessage = (ev: MessageEvent) => {
          try {
            const parsed = JSON.parse(ev.data);
            this.dispatch(parsed as OrchestratorEvent);
          } catch (err) {
            if (this.config.debug) console.error('[OrchestratorSSE] failed to parse message', err);
            this.handlers.onError?.(err as Error);
          }
        };

        // Named events: hello, checkpoint, status — server emits event: <type>
        this.es.addEventListener('hello', (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data);
            this.handlers.onHello?.(data);
            this.handlers.onRaw?.({ type: 'hello', data } as OrchestratorEvent);
          } catch (err) {
            this.handlers.onError?.(err as Error);
          }
        });

        this.es.addEventListener('checkpoint', (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data) as Checkpoint;
            this.handlers.onCheckpoint?.(data);
            this.handlers.onRaw?.({ type: 'checkpoint', data } as OrchestratorEvent);
          } catch (err) {
            this.handlers.onError?.(err as Error);
          }
        });

        this.es.addEventListener('status', (ev: MessageEvent) => {
          try {
            const data = JSON.parse(ev.data) as { runId: string; status: string };
            this.handlers.onStatus?.(data);
            this.handlers.onRaw?.({ type: 'status', data } as OrchestratorEvent);
          } catch (err) {
            this.handlers.onError?.(err as Error);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private dispatch(event: OrchestratorEvent) {
    // Generic dispatcher for completeness
    switch (event.type) {
      case 'hello':
        this.handlers.onHello?.(event.data);
        break;
      case 'checkpoint':
        this.handlers.onCheckpoint?.(event.data as Checkpoint);
        break;
      case 'status':
        this.handlers.onStatus?.(event.data as { runId: string; status: string });
        break;
      default:
        // unknown
        break;
    }
    this.handlers.onRaw?.(event);
  }

  close() {
    if (this.es) {
      this.es.close();
      this.es = null;
      if (this.config.debug) console.debug('[OrchestratorSSE] closed');
    }
    this.currentRunId = null;
  }

  isConnected(): boolean {
    return this.es != null && (this.es as any).readyState === 1;
  }
}

export default OrchestratorSSE;