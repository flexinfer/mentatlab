/**
 * Web Worker Manager for Stream Parsing
 *
 * Manages worker lifecycle and provides a Promise-based API for parsing
 */

import { isStreamWorkerEnabled } from '@/config/features';

type ParseCallback = (result: any, error?: string) => void;

class StreamParserWorkerManager {
  private worker: Worker | null = null;
  private enabled: boolean = false;
  private callbacks: Map<string, ParseCallback> = new Map();
  private requestId: number = 0;

  constructor() {
    this.enabled = isStreamWorkerEnabled();

    if (this.enabled && typeof Worker !== 'undefined') {
      try {
        // Create worker
        this.worker = new Worker(
          new URL('../../workers/streamParser.worker.ts', import.meta.url),
          { type: 'module' }
        );

        // Handle messages from worker
        this.worker.onmessage = (event) => {
          const { id, result, error } = event.data;
          const callback = this.callbacks.get(id);

          if (callback) {
            callback(result, error);
            this.callbacks.delete(id);
          }
        };

        // Handle worker errors
        this.worker.onerror = (error) => {
          console.error('[StreamParserWorker] Error:', error);
          this.enabled = false;
          this.cleanup();
        };

        console.log('[StreamParserWorker] Initialized successfully');
      } catch (error) {
        console.warn('[StreamParserWorker] Failed to initialize:', error);
        this.enabled = false;
      }
    }
  }

  /**
   * Check if worker is available and enabled
   */
  isAvailable(): boolean {
    return this.enabled && this.worker !== null;
  }

  /**
   * Parse SSE message using worker
   */
  async parse(data: string, eventType?: string): Promise<any> {
    if (!this.isAvailable()) {
      // Fallback to main thread parsing
      return this.fallbackParse(data, eventType);
    }

    return new Promise((resolve, reject) => {
      const id = `parse-${this.requestId++}`;

      // Store callback
      this.callbacks.set(id, (result, error) => {
        if (error) {
          reject(new Error(error));
        } else {
          resolve(result);
        }
      });

      // Send to worker
      this.worker!.postMessage({
        id,
        type: 'parse',
        data,
        eventType,
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.callbacks.has(id)) {
          this.callbacks.delete(id);
          reject(new Error('Parser timeout'));
        }
      }, 5000);
    });
  }

  /**
   * Fallback parsing on main thread
   */
  private fallbackParse(raw: string, eventType?: string): any {
    const lines = raw.split('\n');
    const result: any = {
      data: null,
    };

    let dataLines: string[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const field = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();

      switch (field) {
        case 'id':
          result.id = value;
          break;
        case 'event':
          result.event = value;
          break;
        case 'data':
          dataLines.push(value);
          break;
        case 'retry':
          result.retry = parseInt(value, 10);
          break;
      }
    }

    // Join multi-line data
    if (dataLines.length > 0) {
      const dataStr = dataLines.join('\n');
      try {
        result.data = JSON.parse(dataStr);
      } catch {
        result.data = dataStr;
      }
    }

    if (eventType) {
      result.event = eventType;
    }

    // Normalize
    return {
      seq: Date.now(),
      id: result.id,
      type: result.event || 'message',
      ts: result.data?.ts || result.data?.timestamp || new Date().toISOString(),
      level: result.data?.level,
      nodeId: result.data?.node_id || result.data?.nodeId,
      data: result.data,
    };
  }

  /**
   * Clean up worker
   */
  cleanup(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.callbacks.clear();
    this.enabled = false;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      enabled: this.enabled,
      available: this.isAvailable(),
      pendingRequests: this.callbacks.size,
    };
  }
}

// Singleton instance
let workerManager: StreamParserWorkerManager | null = null;

/**
 * Get or create worker manager instance
 */
export function getStreamParserWorker(): StreamParserWorkerManager {
  if (!workerManager) {
    workerManager = new StreamParserWorkerManager();
  }
  return workerManager;
}

/**
 * Parse SSE message (automatically uses worker if available)
 */
export async function parseSSEMessage(data: string, eventType?: string): Promise<any> {
  const worker = getStreamParserWorker();
  return worker.parse(data, eventType);
}

/**
 * Check if worker parsing is available
 */
export function isWorkerParsingAvailable(): boolean {
  return getStreamParserWorker().isAvailable();
}

/**
 * Clean up worker on page unload
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (workerManager) {
      workerManager.cleanup();
    }
  });
}
