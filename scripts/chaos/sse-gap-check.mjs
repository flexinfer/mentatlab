#!/usr/bin/env node
// Robustness kill-test (SSE half): is Last-Event-ID resumption lossless?
//
// Creates a run with a high-rate event burst, subscribes to SSE, forces a
// disconnect mid-stream, reconnects with Last-Event-ID, then compares the
// union of received event IDs against the authoritative full replay
// (reconnect with Last-Event-ID:0). Any IDs in the full replay that were
// never delivered across the two live connections are reported as GAPS.
//
// Usage:  node scripts/chaos/sse-gap-check.mjs
// Env:    BASE (default http://localhost:7071)
//         BURST_SECONDS (default 6)  EMIT_INTERVAL (default 0.02)
//         DISCONNECT_AFTER (events seen before forced disconnect, default 25)

const BASE = process.env.BASE || 'http://localhost:7071';
const AGENT = new URL('../../agents/sleep/main.py', import.meta.url).pathname;
const BURST_SECONDS = process.env.BURST_SECONDS || '6';
const EMIT_INTERVAL = process.env.EMIT_INTERVAL || '0.02';
const DISCONNECT_AFTER = parseInt(process.env.DISCONNECT_AFTER || '25', 10);

const log = (...a) => console.log('[sse]', ...a);

async function createRun() {
  const body = {
    name: 'chaos-sse-gap',
    auto_start: true,
    plan: { nodes: [{ id: 'burster', type: 'agent',
      command: ['python3', AGENT],
      env: { SLEEP_SECONDS: BURST_SECONDS, EMIT_INTERVAL } }] },
  };
  const res = await fetch(`${BASE}/api/v1/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  return j.run_id || j.runId;
}

// Reads an SVG... no — reads an SSE stream. onEvent(id) per event; stops when
// stopAfter events seen (returns 'aborted') or stream ends (returns 'ended').
async function readSSE(runId, lastEventId, onEvent, stopAfter = Infinity) {
  const headers = { Accept: 'text/event-stream' };
  if (lastEventId != null) headers['Last-Event-ID'] = String(lastEventId);
  const ctrl = new AbortController();
  const res = await fetch(`${BASE}/api/v1/runs/${runId}/events`,
    { headers, signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let seen = 0;
  let lastId = lastEventId;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return { reason: 'ended', lastId, seen };
      buf += dec.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop();
      for (const frame of frames) {
        let id = null, type = null;
        for (const line of frame.split('\n')) {
          if (line.startsWith('id:')) id = line.slice(3).trim();
          else if (line.startsWith('event:')) type = line.slice(6).trim();
        }
        if (id != null) { lastId = id; onEvent(id, type); seen++; }
        if (type === 'run_complete') return { reason: 'complete', lastId, seen };
        if (seen >= stopAfter) { ctrl.abort(); return { reason: 'aborted', lastId, seen }; }
      }
    }
  } catch (e) {
    return { reason: 'error', error: String(e), lastId, seen };
  }
}

async function main() {
  log(`base=${BASE} burst=${BURST_SECONDS}s interval=${EMIT_INTERVAL}s`);
  const runId = await createRun();
  if (!runId) { console.error('could not create run'); process.exit(1); }
  log(`run_id=${runId}`);

  const liveIds = new Set();

  // Phase 1: connect, collect until DISCONNECT_AFTER events, then drop.
  const p1 = await readSSE(runId, null, (id) => liveIds.add(id), DISCONNECT_AFTER);
  log(`phase1: ${p1.reason} after ${p1.seen} events, lastId=${p1.lastId}`);

  // Phase 2: reconnect with Last-Event-ID, collect to completion.
  const p2 = await readSSE(runId, p1.lastId, (id) => liveIds.add(id));
  log(`phase2: ${p2.reason} after ${p2.seen} events, lastId=${p2.lastId}`);

  // Authoritative full replay from the beginning.
  const fullIds = new Set();
  const pf = await readSSE(runId, '0', (id) => fullIds.add(id));
  log(`full replay: ${pf.reason}, ${fullIds.size} distinct ids`);

  // Gaps = ids present in full replay but never delivered live across p1+p2.
  const gaps = [...fullIds].filter((id) => id !== '0' && !liveIds.has(id));
  log('===== SSE VERDICT INPUTS =====');
  log(`live_distinct_ids=${liveIds.size}  full_distinct_ids=${fullIds.size}`);
  log(`gap_count=${gaps.length}`);
  if (gaps.length) log(`sample_gaps=${gaps.slice(0, 10).join(',')}`);
  log(gaps.length === 0
    ? 'RESUMPTION LOSSLESS under normal disconnect (within retained window)'
    : 'RESUMPTION DROPPED EVENTS across reconnect');
}

main().catch((e) => { console.error(e); process.exit(1); });
