/**
 * Event Pipeline - Batched event processing for high-frequency streams
 *
 * This module provides a batching layer between raw transport events and
 * the application state. Events are collected over a configurable window
 * (default 50ms) and flushed as a single batch to reduce React re-renders.
 *
 * Usage:
 *   const pipeline = new EventPipeline({
 *     flushInterval: 50,
 *     onFlush: (events) => store.batchAddEvents(events),
 *   });
 *
 *   // Push events from transport
 *   pipeline.push(event);
 *
 *   // Force immediate flush
 *   pipeline.flush();
 *
 *   // Cleanup
 *   pipeline.destroy();
 */

import type { TransportEvent } from './connection-manager';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface EventPipelineConfig {
  /** Batch flush interval in milliseconds (default: 50) */
  flushInterval?: number;
  /** Maximum buffer size before forced flush (default: 1000) */
  maxBufferSize?: number;
  /** Callback when events are flushed */
  onFlush: (events: TransportEvent[]) => void;
  /** Optional error handler */
  onError?: (error: Error) => void;
  /** Enable debug logging */
  debug?: boolean;
}

export interface EventPipelineStats {
  totalReceived: number;
  totalFlushed: number;
  flushCount: number;
  bufferSize: number;
  lastFlushAt: number | null;
  averageBatchSize: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event Pipeline
// ─────────────────────────────────────────────────────────────────────────────

export class EventPipeline {
  private buffer: TransportEvent[] = [];
  private flushTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed = false;
  private config: Required<Omit<EventPipelineConfig, 'onError'>> & Pick<EventPipelineConfig, 'onError'>;

  // Stats
  private stats: EventPipelineStats = {
    totalReceived: 0,
    totalFlushed: 0,
    flushCount: 0,
    bufferSize: 0,
    lastFlushAt: null,
    averageBatchSize: 0,
  };

  constructor(config: EventPipelineConfig) {
    this.config = {
      flushInterval: config.flushInterval ?? 50,
      maxBufferSize: config.maxBufferSize ?? 1000,
      onFlush: config.onFlush,
      onError: config.onError,
      debug: config.debug ?? false,
    };
  }

  /**
   * Push an event into the pipeline buffer
   */
  push(event: TransportEvent): void {
    if (this.isDestroyed) {
      if (this.config.debug) {
        console.warn('[EventPipeline] Attempted to push after destroy');
      }
      return;
    }

    this.buffer.push(event);
    this.stats.totalReceived++;
    this.stats.bufferSize = this.buffer.length;

    // Force flush if buffer exceeds max size
    if (this.buffer.length >= this.config.maxBufferSize) {
      this.flush();
      return;
    }

    // Schedule flush if not already scheduled
    this.scheduleFlush();
  }

  /**
   * Push multiple events at once
   */
  pushBatch(events: TransportEvent[]): void {
    if (this.isDestroyed || events.length === 0) return;

    this.buffer.push(...events);
    this.stats.totalReceived += events.length;
    this.stats.bufferSize = this.buffer.length;

    // Force flush if buffer exceeds max size
    if (this.buffer.length >= this.config.maxBufferSize) {
      this.flush();
      return;
    }

    this.scheduleFlush();
  }

  /**
   * Immediately flush all buffered events
   */
  flush(): void {
    if (this.isDestroyed) return;

    // Clear pending timeout
    if (this.flushTimeoutId !== null) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }

    // Nothing to flush
    if (this.buffer.length === 0) return;

    // Grab buffer and reset
    const events = this.buffer;
    this.buffer = [];
    this.stats.bufferSize = 0;

    // Update stats
    this.stats.totalFlushed += events.length;
    this.stats.flushCount++;
    this.stats.lastFlushAt = Date.now();
    this.stats.averageBatchSize =
      this.stats.totalFlushed / this.stats.flushCount;

    if (this.config.debug) {
      console.debug(
        `[EventPipeline] Flushing ${events.length} events (avg batch: ${this.stats.averageBatchSize.toFixed(1)})`
      );
    }

    // Call flush handler
    try {
      this.config.onFlush(events);
    } catch (error) {
      if (this.config.onError) {
        this.config.onError(error instanceof Error ? error : new Error(String(error)));
      } else {
        console.error('[EventPipeline] Error in onFlush handler:', error);
      }
    }
  }

  /**
   * Get current pipeline statistics
   */
  getStats(): EventPipelineStats {
    return { ...this.stats, bufferSize: this.buffer.length };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalReceived: 0,
      totalFlushed: 0,
      flushCount: 0,
      bufferSize: this.buffer.length,
      lastFlushAt: null,
      averageBatchSize: 0,
    };
  }

  /**
   * Check if pipeline has pending events
   */
  hasPending(): boolean {
    return this.buffer.length > 0;
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /**
   * Destroy the pipeline and release resources
   */
  destroy(): void {
    if (this.isDestroyed) return;

    this.isDestroyed = true;

    // Flush any remaining events
    if (this.buffer.length > 0) {
      this.flush();
    }

    // Clear timeout
    if (this.flushTimeoutId !== null) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }

    this.buffer = [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private methods
  // ─────────────────────────────────────────────────────────────────────────

  private scheduleFlush(): void {
    if (this.flushTimeoutId !== null) {
      // Already scheduled
      return;
    }

    this.flushTimeoutId = setTimeout(() => {
      this.flushTimeoutId = null;
      this.flush();
    }, this.config.flushInterval);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory function for convenience
// ─────────────────────────────────────────────────────────────────────────────

export function createEventPipeline(config: EventPipelineConfig): EventPipeline {
  return new EventPipeline(config);
}

export default EventPipeline;
