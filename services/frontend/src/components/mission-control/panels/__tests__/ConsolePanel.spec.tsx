import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ConsolePanel from '../ConsolePanel';
import { flightRecorder } from '../../../../services/mission-control/services';

// Ensure feature flags won't attempt live WS in unrelated code paths
jest.mock('../../../../config/features', () => ({
  FeatureFlags: { CONNECT_WS: false, NEW_STREAMING: false, MULTIMODAL_UPLOAD: false, S3_STORAGE: false, CONTRACT_OVERLAY: false },
}));

describe('ConsolePanel (integration)', () => {
  beforeEach(() => {
    flightRecorder.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('renders entries and attaches id anchors console-{entry.id}', () => {
    const runId = 'console-run-1';
    flightRecorder.startRun(runId);
    const cp1 = flightRecorder.appendConsole(runId, { message: 'm1', tag: 'alpha' });
    const cp2 = flightRecorder.appendConsole(runId, { message: 'm2', tag: 'beta' });

    const { container } = render(<ConsolePanel runId={runId} maxItems={10} />);

    // Allow initial polling to run
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // Rows should exist with corresponding ids
    expect(container.querySelector(`#console-${cp1.id}`)).toBeTruthy();
    expect(container.querySelector(`#console-${cp2.id}`)).toBeTruthy();

    // Basic text presence
    expect(screen.getByText('console:entry', { exact: false })).toBeTruthy();
  });

  test('filter input reduces visible entries case-insensitively (debounced) and respects maxItems after filtering', async () => {
    const runId = 'console-run-2';
    flightRecorder.startRun(runId);
    // Seed multiple entries
    const entries = [
      flightRecorder.appendConsole(runId, { message: 'Alpha One', foo: 'A' }),
      flightRecorder.appendConsole(runId, { message: 'Bravo Two', foo: 'B' }),
      flightRecorder.appendConsole(runId, { message: 'Charlie Three', foo: 'C' }),
      flightRecorder.appendConsole(runId, { message: 'alpha extra', foo: 'D' }),
    ];

    // Use maxItems = 2 so we can assert slicing happens after filtering
    const { container } = render(<ConsolePanel runId={runId} maxItems={2} />);

    // Let initial refresh/poll run
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    // There should be items initially (more than 0)
    expect(container.querySelectorAll('li').length).toBeGreaterThan(0);

    const input = screen.getByLabelText('Console filter') as HTMLInputElement;
    // Type "alpha" (case-insensitive match expected to match two entries)
    act(() => {
      fireEvent.change(input, { target: { value: 'alpha' } });
      // debounce 150ms
      jest.advanceTimersByTime(150);
      // allow the polling refresh (uses 1s interval)
      jest.advanceTimersByTime(1000);
    });

    // After filtering + maxItems=2, visible list items should be <= 2
    const visible = container.querySelectorAll('li');
    expect(visible.length).toBeLessThanOrEqual(2);

    // All visible items should include the filter text somewhere in label/data
    for (const li of Array.from(visible)) {
      expect(li.textContent!.toLowerCase()).toContain('alpha');
    }
  });
});