import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventPipeline } from './event-pipeline';
import type { TransportEvent } from './connection-manager';

function ev(seq: number): TransportEvent {
  // TransportEvent shape is loose here; we only assert identity/order.
  return { seq } as unknown as TransportEvent;
}

describe('EventPipeline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('batches pushed events and flushes once after the interval, preserving order', () => {
    const flushed: TransportEvent[][] = [];
    const p = new EventPipeline({ flushInterval: 50, onFlush: (e) => flushed.push(e) });

    p.push(ev(1));
    p.push(ev(2));
    p.push(ev(3));
    expect(flushed).toHaveLength(0); // nothing yet
    expect(p.getBufferSize()).toBe(3);

    vi.advanceTimersByTime(50);

    expect(flushed).toHaveLength(1);
    expect(flushed[0].map((e: any) => e.seq)).toEqual([1, 2, 3]);
    expect(p.hasPending()).toBe(false);
  });

  it('force-flushes when the buffer reaches maxBufferSize', () => {
    const flushed: TransportEvent[][] = [];
    const p = new EventPipeline({ flushInterval: 50, maxBufferSize: 2, onFlush: (e) => flushed.push(e) });

    p.push(ev(1));
    expect(flushed).toHaveLength(0);
    p.push(ev(2)); // hits maxBufferSize -> immediate flush
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toHaveLength(2);
  });

  it('flush() is a no-op when the buffer is empty', () => {
    const onFlush = vi.fn();
    const p = new EventPipeline({ onFlush });
    p.flush();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('routes onFlush handler errors to onError instead of throwing', () => {
    const onError = vi.fn();
    const p = new EventPipeline({
      flushInterval: 10,
      onFlush: () => { throw new Error('boom'); },
      onError,
    });
    p.push(ev(1));
    expect(() => vi.advanceTimersByTime(10)).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('tracks stats: received, flushed, flushCount, averageBatchSize', () => {
    const p = new EventPipeline({ flushInterval: 10, onFlush: () => {} });
    p.push(ev(1));
    p.push(ev(2));
    vi.advanceTimersByTime(10);
    p.push(ev(3));
    vi.advanceTimersByTime(10);

    const s = p.getStats();
    expect(s.totalReceived).toBe(3);
    expect(s.totalFlushed).toBe(3);
    expect(s.flushCount).toBe(2);
    expect(s.averageBatchSize).toBeCloseTo(1.5);
  });

  it('flushes remaining buffered events on destroy (no silent drop)', () => {
    const flushed: TransportEvent[][] = [];
    const p = new EventPipeline({ flushInterval: 1000, onFlush: (e) => flushed.push(e) });
    p.push(ev(1));
    p.push(ev(2));

    p.destroy(); // must flush the 2 buffered events before tearing down

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toHaveLength(2);
  });

  it('ignores pushes after destroy', () => {
    const flushed: TransportEvent[][] = [];
    const p = new EventPipeline({ flushInterval: 10, onFlush: (e) => flushed.push(e) });
    p.destroy();
    p.push(ev(1));
    vi.advanceTimersByTime(50);
    expect(flushed).toHaveLength(0);
  });
});
