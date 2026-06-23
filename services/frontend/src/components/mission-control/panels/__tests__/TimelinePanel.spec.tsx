import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Hoisted mock state for SSE handlers
const { mockHandlers, mockClose } = vi.hoisted(() => ({
  mockHandlers: { current: null as any },
  mockClose: vi.fn(),
}));

// Mock the orchestratorService
vi.mock('@/services/api/orchestratorService', () => ({
  orchestratorService: {
    streamRunEvents: vi.fn((_runId: string, handlers: any) => {
      mockHandlers.current = handlers;
      // Call onOpen immediately to simulate connection
      handlers.onOpen?.();
      return { close: mockClose };
    }),
  },
}));

// Mock parseRunEvent to return structured events
vi.mock('@/services/streaming/parse', () => ({
  parseRunEvent: (evt: any) => evt,
}));

// Mock feature flags
vi.mock('../../../../config/features', () => ({
  FeatureFlags: { CONNECT_WS: false, NEW_STREAMING: false, MULTIMODAL_UPLOAD: false, S3_STORAGE: false, CONTRACT_OVERLAY: false },
  isStreamWorkerEnabled: () => false,
}));

import { TimelinePanel } from '../TimelinePanel';

describe('TimelinePanel (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandlers.current = null;
    mockClose.mockClear();
  });

  test('renders empty state when no runId', () => {
    render(<TimelinePanel runId={null} />);
    expect(screen.getByText(/No run selected/i)).toBeTruthy();
  });

  test('renders "Waiting for events" when connected but no events received', () => {
    render(<TimelinePanel runId="run-1" />);
    expect(screen.getByText(/Waiting for events/i)).toBeTruthy();
  });

  test('renders timeline entries when SSE events arrive via onRaw', () => {
    render(<TimelinePanel runId="run-1" />);

    // Simulate SSE events arriving via the onRaw handler
    act(() => {
      mockHandlers.current?.onRaw?.({
        type: 'node_status',
        ts: '2026-01-01T00:00:01Z',
        data: { status: 'running' },
        nodeId: 'agent-1',
      });
    });

    act(() => {
      mockHandlers.current?.onRaw?.({
        type: 'checkpoint',
        ts: '2026-01-01T00:00:02Z',
        data: { type: 'progress' },
      });
    });

    // Should render two list items
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(2);

    // Labels should be formatted
    expect(screen.getByText('node:running')).toBeTruthy();
    expect(screen.getByText('checkpoint:progress')).toBeTruthy();
  });

  test('clicking a timeline entry emits timelineCheckpointSelected event', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

    render(<TimelinePanel runId="run-1" />);

    act(() => {
      mockHandlers.current?.onRaw?.({
        type: 'status',
        ts: '2026-01-01T00:00:01Z',
        data: { status: 'running' },
      });
    });

    const item = screen.getByRole('listitem');
    fireEvent.click(item);

    const customEvents = dispatchSpy.mock.calls
      .map(([evt]) => evt)
      .filter((evt) => evt instanceof CustomEvent && evt.type === 'timelineCheckpointSelected');

    expect(customEvents.length).toBe(1);
    expect((customEvents[0] as CustomEvent).detail.runId).toBe('run-1');

    dispatchSpy.mockRestore();
  });

  test('displays run status and event count in header', () => {
    const { container } = render(<TimelinePanel runId="run-1" />);

    // After connection, the header should show "connected" status
    const header = container.querySelector('.border-b');
    expect(header?.textContent).toContain('connected');
    expect(header?.textContent).toContain('0'); // Events: 0

    act(() => {
      mockHandlers.current?.onRaw?.({
        type: 'status',
        ts: '2026-01-01T00:00:01Z',
        data: { status: 'running' },
      });
    });

    // Status updates to "running" and event count becomes 1
    expect(header?.textContent).toContain('running');
    expect(header?.textContent).toContain('1'); // Events: 1
  });

  test('cleans up SSE connection on unmount', () => {
    const { unmount } = render(<TimelinePanel runId="run-1" />);
    unmount();
    expect(mockClose).toHaveBeenCalled();
  });
});
