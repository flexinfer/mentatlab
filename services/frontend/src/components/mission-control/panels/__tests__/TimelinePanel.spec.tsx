import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import TimelinePanel from '../TimelinePanel';
import ConsolePanel from '../ConsolePanel';
import { flightRecorder } from '../../../../services/mission-control/services';

// Mock feature flags to stable defaults (avoid live WS)
jest.mock('../../../../config/features', () => ({
  FeatureFlags: { CONNECT_WS: false, NEW_STREAMING: false, MULTIMODAL_UPLOAD: false, S3_STORAGE: false, CONTRACT_OVERLAY: false },
}));

describe('TimelinePanel (integration)', () => {
  beforeEach(() => {
    flightRecorder.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    // restore any mocks on document
    // @ts-ignore
    if ((document.getElementById as any).mockRestore) (document.getElementById as any).mockRestore();
  });

  test('lists checkpoints for the active run', () => {
    const runId = 'tl-run-1';
    flightRecorder.startRun(runId);
    const a = flightRecorder.appendConsole(runId, { message: 'one' });
    const b = flightRecorder.appendConsole(runId, { message: 'two' });
    const c = flightRecorder.appendConsole(runId, { message: 'three' });

    const { container } = render(<TimelinePanel runId={runId} />);

    // Initial snapshot is synchronous (no timers needed)
    const items = container.querySelectorAll('li');
    expect(items.length).toBe(3);
    // Ensure labels are present
    expect(screen.getByText('console:entry', { exact: false })).toBeTruthy();
  });

  test('clicking a checkpoint calls selectCheckpoint and attempts to scroll console anchor into view', () => {
    const runId = 'tl-run-2';
    flightRecorder.startRun(runId);
    const cp1 = flightRecorder.appendConsole(runId, { message: 'click-me' });

    const selectSpy = jest.spyOn(flightRecorder, 'selectCheckpoint');

    // Stub document.getElementById to provide element with scrollIntoView spy
    const scrollSpy = jest.fn();
    const fakeEl = { scrollIntoView: scrollSpy } as any;
    const originalGet = document.getElementById;
    // @ts-ignore
    document.getElementById = jest.fn().mockImplementation((id: string) => {
      if (id === `console-${cp1.id}`) return fakeEl;
      return originalGet.call(document, id);
    });

    const { container } = render(
      <div>
        <TimelinePanel runId={runId} />
        <ConsolePanel runId={runId} />
      </div>
    );

    const item = container.querySelector('li');
    expect(item).toBeTruthy();

    act(() => {
      fireEvent.click(item!);
    });

    expect(selectSpy).toHaveBeenCalledWith(runId, cp1.id);
    expect(scrollSpy).toHaveBeenCalled();

    // Restore
    selectSpy.mockRestore();
    // @ts-ignore
    document.getElementById = originalGet;
  });

  test('selection highlight toggles when recorder emits onSelect', () => {
    const runId = 'tl-run-3';
    flightRecorder.startRun(runId);
    const cp1 = flightRecorder.appendConsole(runId, { message: 'first' });
    const cp2 = flightRecorder.appendConsole(runId, { message: 'second' });

    const { container } = render(<TimelinePanel runId={runId} />);

    // Initially no selection
    let selected = container.querySelector('.bg-indigo-50') || container.querySelector('.dark\\:bg-indigo-900\\/20');
    expect(selected).toBeNull();

    act(() => {
      flightRecorder.selectCheckpoint(runId, cp2.id);
    });

    // Now the selected li should have the selection class
    const lis = container.querySelectorAll('li');
    const found = Array.from(lis).find((li) => li.textContent?.includes('second'));
    expect(found).toBeDefined();
    expect(found!.className).toContain('bg-indigo-50');
  });

  test('empty state renders "No checkpoints yet" when run has no data', () => {
    const runId = 'tl-run-empty';
    flightRecorder.startRun(runId);
    const { container } = render(<TimelinePanel runId={runId} />);

    // Should show empty message
    expect(container.textContent).toContain('No checkpoints yet');
  });
});