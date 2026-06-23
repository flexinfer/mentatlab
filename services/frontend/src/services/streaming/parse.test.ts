import { describe, it, expect } from 'vitest';
import { parseRunEvent } from './parse';

describe('parseRunEvent', () => {
  it('derives seq from a numeric id and type from the event name', () => {
    const e = parseRunEvent({ id: 42, event: 'node_status', data: { status: 'running' } });
    expect(e.seq).toBe(42);
    expect(e.type).toBe('node_status');
    expect(e.id).toBe('42');
    expect(e.data).toEqual({ status: 'running' });
  });

  it('infers type from data.type when no event name is given', () => {
    const e = parseRunEvent({ id: 1, data: { type: 'log', message: 'hi' } });
    expect(e.type).toBe('log');
  });

  it('infers type from data.kind as a fallback', () => {
    const e = parseRunEvent({ id: 1, data: { kind: 'progress' } });
    expect(e.type).toBe('progress');
  });

  it('defaults type to "message" when nothing identifies it', () => {
    const e = parseRunEvent({ id: 1, data: {} });
    expect(e.type).toBe('message');
  });

  it('JSON-parses string data on a plain frame', () => {
    const e = parseRunEvent({ id: 2, event: 'log', data: '{"message":"parsed"}' });
    expect(e.data).toEqual({ message: 'parsed' });
  });

  it('keeps malformed JSON string data as a raw string', () => {
    const e = parseRunEvent({ id: 3, event: 'log', data: '{not valid json' });
    expect(e.data).toBe('{not valid json');
  });

  it('extracts ts from data.ts/time/timestamp', () => {
    expect(parseRunEvent({ id: 1, data: { ts: 'T1' } }).ts).toBe('T1');
    expect(parseRunEvent({ id: 1, data: { timestamp: 'T2' } }).ts).toBe('T2');
  });

  it('extracts nodeId from node_id / nodeId / node', () => {
    expect(parseRunEvent({ id: 1, data: { node_id: 'a' } }).nodeId).toBe('a');
    expect(parseRunEvent({ id: 1, data: { nodeId: 'b' } }).nodeId).toBe('b');
    expect(parseRunEvent({ id: 1, data: { node: 'c' } }).nodeId).toBe('c');
  });

  it('extracts log level from top-level and nested data.data', () => {
    expect(parseRunEvent({ id: 1, data: { level: 'warn' } }).level).toBe('warn');
    expect(parseRunEvent({ id: 1, data: { data: { level: 'error' } } }).level).toBe('error');
  });

  it('falls back to data.sequence/seq/offset when id is non-numeric', () => {
    const e = parseRunEvent({ id: 'abc', data: { sequence: 7 } });
    expect(e.seq).toBe(7);
  });

  it('uses a monotonic fallback counter when no id or payload seq exists', () => {
    const a = parseRunEvent({ data: { type: 'log' } });
    const b = parseRunEvent({ data: { type: 'log' } });
    expect(Number.isFinite(a.seq)).toBe(true);
    expect(b.seq).toBeGreaterThan(a.seq);
  });

  it('handles a browser MessageEvent: parses data and reads lastEventId', () => {
    const me = new MessageEvent('message', {
      data: JSON.stringify({ type: 'checkpoint', node_id: 'n1' }),
      lastEventId: '9',
    });
    const e = parseRunEvent(me);
    expect(e.id).toBe('9');
    expect(e.seq).toBe(9);
    expect(e.type).toBe('checkpoint');
    expect(e.nodeId).toBe('n1');
  });

  it('leaves non-JSON MessageEvent data as text', () => {
    const me = new MessageEvent('message', { data: 'plain text', lastEventId: '1' });
    const e = parseRunEvent(me);
    expect(e.data).toBe('plain text');
  });
});
