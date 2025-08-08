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
import { getOrchestratorBaseUrl } from '@/config/orchestrator';
 
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
 
   // Resiliency state
   private lastEventAt: number | null = null;
   private heartbeatIntervalId: number | null = null;
   private reconnectTimeoutId: number | null = null;
   private reconnectAttempts = 0;
   private manualClose = false;
 
   // Internal constants (module-local as requested)
   private static readonly HEARTBEAT_TIMEOUT_MS = 45_000; // 45s
   private static readonly HEARTBEAT_CHECK_INTERVAL_MS = 5_000; // 5s
   private static readonly BACKOFF_MS = [1000, 2000, 5000, 10000, 30000]; // cap at last
 
   constructor(config: OrchestratorSSEConfig = {}) {
     this.config = {
       baseUrl: config.baseUrl || getOrchestratorBaseUrl(),
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
     this.manualClose = false;
 
     // reset state for a fresh connect
     this.clearHeartbeat();
     this.clearPendingReconnect();
     this.lastEventAt = null;
     this.reconnectAttempts = 0;
 
     return new Promise((resolve, reject) => {
       try {
         const url = this.buildUrl(runId, replay ?? this.config.replay);
         if (this.config.debug) console.debug('[OrchestratorSSE] connecting to', url);
 
         // Close previous EventSource if present (do not flip manualClose)
         if (this.es) {
           try {
             this.es.close();
           } catch (e) {
             // ignore
           }
           this.es = null;
         }
 
         this.es = new EventSource(url, { withCredentials: false });
 
         // onopen -> connection established, reset backoff and start heartbeat watchdog
         this.es.onopen = () => {
           this.updateLastEvent();
           this.resetBackoff();
           if (this.config.debug) console.debug('[OrchestratorSSE] open');
           this.handlers.onOpen?.();
           // start heartbeat checks
           this.startHeartbeatWatchdog();
           resolve();
         };
 
         // onerror -> schedule reconnect (but avoid when we intentionally closed)
         this.es.onerror = (ev) => {
           if (this.config.debug) console.warn('[OrchestratorSSE] error', ev);
           this.handlers.onError?.(ev);
           // schedule a proactive reconnect if not manually closed
           if (!this.manualClose) {
             this.scheduleReconnect('[onerror]');
           }
           // Do not reject here; EventSource may reconnect automatically, but we proactively handle it.
         };
 
         // Generic message handler (for events without explicit event: <type>)
         this.es.onmessage = (ev: MessageEvent) => {
           try {
             const parsed = JSON.parse(ev.data);
             this.updateLastEvent();
             this.resetBackoff();
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
             this.updateLastEvent();
             this.resetBackoff();
             this.handlers.onHello?.(data);
             this.handlers.onRaw?.({ type: 'hello', data } as OrchestratorEvent);
           } catch (err) {
             this.handlers.onError?.(err as Error);
           }
         });
 
         this.es.addEventListener('checkpoint', (ev: MessageEvent) => {
           try {
             const data = JSON.parse(ev.data) as Checkpoint;
             this.updateLastEvent();
             this.resetBackoff();
             this.handlers.onCheckpoint?.(data);
             this.handlers.onRaw?.({ type: 'checkpoint', data } as OrchestratorEvent);
           } catch (err) {
             this.handlers.onError?.(err as Error);
           }
         });
 
         this.es.addEventListener('status', (ev: MessageEvent) => {
           try {
             const data = JSON.parse(ev.data) as { runId: string; status: string };
             this.updateLastEvent();
             this.resetBackoff();
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
 
   /**
    * Update lastEventAt timestamp (called whenever we receive any event)
    */
   private updateLastEvent() {
     this.lastEventAt = Date.now();
   }
 
   /**
    * Start the heartbeat/stall watchdog which checks for staleness periodically.
    */
   private startHeartbeatWatchdog() {
     // clear any previous watchdog first
     this.clearHeartbeat();
     this.heartbeatIntervalId = window.setInterval(() => {
       if (!this.lastEventAt) return;
       const stale = Date.now() - this.lastEventAt;
       if (stale >= OrchestratorSSE.HEARTBEAT_TIMEOUT_MS) {
         if (this.config.debug) console.debug('[OrchestratorSSE] stalled (no events for', stale, 'ms), triggering reconnect');
         this.scheduleReconnect('[heartbeat-stall]');
       }
     }, OrchestratorSSE.HEARTBEAT_CHECK_INTERVAL_MS);
   }
 
   private clearHeartbeat() {
     if (this.heartbeatIntervalId != null) {
       window.clearInterval(this.heartbeatIntervalId);
       this.heartbeatIntervalId = null;
     }
   }
 
   /**
    * Reset backoff counters after successful traffic
    */
   private resetBackoff() {
     this.reconnectAttempts = 0;
     if (this.reconnectTimeoutId != null) {
       window.clearTimeout(this.reconnectTimeoutId);
       this.reconnectTimeoutId = null;
     }
   }
 
   private clearPendingReconnect() {
     if (this.reconnectTimeoutId != null) {
       window.clearTimeout(this.reconnectTimeoutId);
       this.reconnectTimeoutId = null;
     }
   }
 
   /**
    * Schedule a reconnect using the backoff schedule. If already scheduled, it's a no-op.
    */
   private scheduleReconnect(reason = '') {
     // Do not schedule if manual close requested or no runId to reconnect to
     if (this.manualClose || !this.currentRunId) return;
 
     // If there's already a pending reconnect, do nothing (to avoid duplicate timers)
     if (this.reconnectTimeoutId != null) {
       if (this.config.debug) console.debug('[OrchestratorSSE] reconnect already scheduled');
       return;
     }
 
     // Close current event source cleanly
     if (this.es) {
       try {
         this.es.close();
       } catch (e) {
         // ignore
       }
       this.es = null;
     }
 
     // stop heartbeat while reconnecting
     this.clearHeartbeat();
 
     // increment attempts (first attempt = 1)
     this.reconnectAttempts = Math.max(0, this.reconnectAttempts) + 1;
     const idx = Math.min(this.reconnectAttempts - 1, OrchestratorSSE.BACKOFF_MS.length - 1);
     const delay = OrchestratorSSE.BACKOFF_MS[idx];
 
     if (this.config.debug) console.debug(`[OrchestratorSSE] scheduling reconnect #${this.reconnectAttempts} in ${delay}ms ${reason}`);
 
     this.reconnectTimeoutId = window.setTimeout(() => {
       this.reconnectTimeoutId = null;
       // if manual close happened while waiting, abort
       if (this.manualClose) return;
       if (this.config.debug) console.debug(`[OrchestratorSSE] attempting reconnect #${this.reconnectAttempts}`);
       // Attempt to reconnect using the same runId and handlers. We preserve replay semantics via config.
       // The connect() call will re-establish state and reset watchdog/backoff on success.
       const runId = this.currentRunId!;
       this.connect(runId, this.handlers, this.config.replay).catch((err) => {
         if (this.config.debug) console.warn('[OrchestratorSSE] reconnect attempt failed', err);
         // If connect fails synchronously, schedule next backoff
         this.scheduleReconnect('[reconnect-failed]');
       });
     }, delay);
   }
 
   close() {
     // mark manual close to prevent automatic reconnects
     this.manualClose = true;
 
     // Clear heartbeat/watchdog
     this.clearHeartbeat();
 
     // Clear any pending reconnect timer
     this.clearPendingReconnect();
 
     if (this.es) {
       try {
         this.es.close();
       } catch (e) {
         // ignore
       }
       this.es = null;
       if (this.config.debug) console.debug('[OrchestratorSSE] closed');
     }
 
     // Reset state counters
     this.currentRunId = null;
     this.lastEventAt = null;
     this.reconnectAttempts = 0;
   }
 
   isConnected(): boolean {
     return this.es != null && (this.es as any).readyState === 1;
   }
 }
 
 export default OrchestratorSSE;