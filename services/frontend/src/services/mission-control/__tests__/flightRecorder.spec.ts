import { flightRecorder } from '../../mission-control/services';

describe('FlightRecorderService', () => {
  beforeEach(() => {
    // Reset singleton state between tests
    flightRecorder.clear();
  });

  test('startRun, appendConsole and listCheckpoints produce console:entry checkpoints with payload and timestamp', () => {
    const runId = 'test-run-1';
    flightRecorder.startRun(runId, 'flow-x');
    const entry = { level: 'info', message: 'hello-world', foo: 'bar' } as any;
    const cp = flightRecorder.appendConsole(runId, entry);

    expect(cp).toBeDefined();
    expect(cp.label).toBe('console:entry');
    expect(cp.runId).toBe(runId);
    expect(cp.data).toEqual(expect.objectContaining({ message: 'hello-world', foo: 'bar' }));
    expect(typeof cp.at).toBe('string');
    expect(cp.at.length).toBeGreaterThan(0);

    const cps = flightRecorder.listCheckpoints(runId);
    expect(Array.isArray(cps)).toBe(true);
    expect(cps.find((c) => c.id === cp.id)).toBeDefined();
  });

  test('onSelect listener fires when selectCheckpoint is called with valid ids', () => {
    const runId = 'test-run-2';
    flightRecorder.startRun(runId);
    const cp = flightRecorder.appendConsole(runId, { message: 'select-me' });

    const listener = jest.fn();
    const unsub = flightRecorder.onSelect(listener);

    flightRecorder.selectCheckpoint(runId, cp.id);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ runId, checkpointId: cp.id });

    // cleanup
    unsub();
  });

  test('selectCheckpoint is a no-op for unknown runId or checkpointId (listener not invoked)', () => {
    const runId = 'test-run-3';
    flightRecorder.startRun(runId);
    const cp = flightRecorder.appendConsole(runId, { message: 'keep-out' });

    const listener = jest.fn();
    const unsub = flightRecorder.onSelect(listener);

    // Unknown run
    flightRecorder.selectCheckpoint('unknown-run', cp.id);
    // Unknown checkpoint
    flightRecorder.selectCheckpoint(runId, 'does-not-exist');

    expect(listener).not.toHaveBeenCalled();

    unsub();
  });

  test('per-run checkpoint cap evicts oldest checkpoints (FIFO)', () => {
    const runId = 'cap-run';
    flightRecorder.startRun(runId);

    // MAX_CHECKPOINTS_PER_RUN is 1000 in product code; add slightly more to trigger eviction
    const totalToAdd = 1005;
    for (let i = 0; i < totalToAdd; i++) {
      flightRecorder.appendConsole(runId, { idx: i });
    }

    const cps = flightRecorder.listCheckpoints(runId);
    // Should be capped to <= 1000
    expect(cps.length).toBeLessThanOrEqual(1000);
    // The earliest ids (0..(totalToAdd-1000-1)) should have been evicted; check that the first remaining has idx >= totalToAdd - cps.length
    const firstData = cps[0].data as any;
    expect(firstData).toBeDefined();
    expect(firstData.idx).toBeGreaterThanOrEqual(totalToAdd - cps.length);
  });

  test('run capacity evicts oldest runs when MAX_RUNS exceeded', () => {
    // MAX_RUNS is 20 in product code; create more to trigger eviction
    const totalRuns = 25;
    for (let i = 0; i < totalRuns; i++) {
      const id = `run-${i}`;
      flightRecorder.startRun(id);
      // add one checkpoint so run appears in list
      flightRecorder.appendConsole(id, { seed: i });
    }

    const runs = flightRecorder.listRuns();
    // Should be capped to <= MAX_RUNS (20)
    expect(runs.length).toBeLessThanOrEqual(20);

    // Oldest run(s) should have been evicted. Ensure run-0 is not present.
    expect(runs.find((r) => r.runId === 'run-0')).toBeUndefined();
    // Newer run should be present
    expect(runs.find((r) => r.runId === `run-${totalRuns - 1}`)).toBeDefined();
  });
});