/**
 * Tests for Mission Control Status Bar QoS badge
 *
 * - Validates feature flag gating (CONNECT_WS)
 * - Validates p95 thresholds map to text + color tokens
 *
 * Notes:
 * - Mocks lightweight UI children so we can render the smallest tree that includes StatusBar.
 * - Uses jest.mock to override '../../../config/features' and the streaming service.
 */
import React from 'react';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';

// Minimal mocks for children imported by MissionControlLayout to keep render fast.
jest.mock('../../../../config/features', () => ({
  FeatureFlags: {
    MULTIMODAL_UPLOAD: false,
    NEW_STREAMING: false,
    S3_STORAGE: false,
    CONNECT_WS: false,
    CONTRACT_OVERLAY: false,
  },
}));

jest.mock('../../../../services/mission-control/services', () => ({
  flightRecorder: {
    listRuns: () => [],
    listCheckpoints: () => [],
    subscribe: () => () => {},
    startRun: () => {},
    addCheckpoint: () => {},
    endRun: () => {},
  },
}));

jest.mock('../../../../store/index', () => ({
  // Provide a simple useStreamingStore that applies selector to a static snapshot.
  useStreamingStore: (selector: any) =>
    selector({ connectionStatus: 'disconnected', activeStreams: new Set() }),
}));

// Mock heavy UI components imported by the layout
jest.mock('../../../../components/FlowCanvas', () => () => <div data-testid="mock-flow-canvas" />);
jest.mock('../../../../components/ui/button', () => ({ Button: ({ children }: any) => <button>{children}</button> }));
jest.mock('../../../../components/mission-control/panels/TimelinePanel', () => () => <div />);
jest.mock('../../../../components/mission-control/panels/IssuesPanel', () => ({ onCountChange }: any) => <div />);
jest.mock('../../../../components/mission-control/panels/ConsolePanel', () => () => <div />);
jest.mock('../../../../PropertyInspector', () => () => <div />);

// Mock reactflow provider to simply render children
jest.mock('reactflow', () => ({
  ReactFlowProvider: ({ children }: any) => <div>{children}</div>,
}));

// Streaming service mock - we will override its getStats implementation per-test below.
const mockGetStats = jest.fn();
const mockConnect = jest.fn();
jest.mock('../../../../services/api/streamingService', () => {
  return {
    default: {
      getStats: () => mockGetStats(),
      connect: () => mockConnect(),
    },
  };
});

afterEach(() => {
  jest.resetModules();
  mockGetStats.mockReset();
  mockConnect.mockReset();
  cleanup();
  // Restore real timers if tests used fake timers
  try {
    jest.useRealTimers();
  } catch {
    // ignore in case environment doesn't support switching back
  }
});

describe('Mission Control Status Bar — QoS badge', () => {
  const layoutPath = '../../../MissionControlLayout';
  // Import inside tests so mocks applied correctly per-case
  test('does not render QoS badge when CONNECT_WS is false', async () => {
    // Ensure features mock has CONNECT_WS false (module was mocked above)
    const { default: MissionControlLayout } = await import('../../../MissionControlLayout');
    render(<MissionControlLayout />);
    // QoS badge should not exist
    expect(screen.queryByTestId('qos-badge')).toBeNull();
  });

  describe('when CONNECT_WS is true', () => {
    beforeEach(() => {
      // Replace the FeatureFlags mock to enable CONNECT_WS for these tests
      jest.doMock('../../../../config/features', () => ({
        FeatureFlags: {
          MULTIMODAL_UPLOAD: false,
          NEW_STREAMING: false,
          S3_STORAGE: false,
          CONNECT_WS: true,
          CONTRACT_OVERLAY: false,
        },
      }));
    });

    afterEach(() => {
      jest.dontMock('../../../../config/features');
    });

    test('p95Ms = 120 → "QoS good" and green token', async () => {
      mockGetStats.mockImplementation(() => ({ p95Ms: 120, messagesReceived: 0, uptime: 0 }));
      const { default: MissionControlLayout } = await import('../../../MissionControlLayout');
      render(<MissionControlLayout />);

      // Wait for async effect (dynamic import + immediate pull)
      await waitFor(() => expect(screen.queryByTestId('qos-badge')).not.toBeNull());

      const badge = screen.getByTestId('qos-badge');
      expect(badge.textContent).toMatch(/QoS good/);
      expect(badge.textContent).toMatch(/120/);
      // The small dot is the first child span inside the badge; assert its class contains success token
      const dot = badge.querySelector('span');
      expect(dot).not.toBeNull();
      expect((dot as HTMLElement).className).toEqual(expect.stringContaining('bg-emerald-500'));
    });

    test('p95Ms = 300 → "QoS fair" and amber/yellow token', async () => {
      mockGetStats.mockImplementation(() => ({ p95Ms: 300, messagesReceived: 0, uptime: 0 }));
      const { default: MissionControlLayout } = await import('../../../MissionControlLayout');
      render(<MissionControlLayout />);

      await waitFor(() => expect(screen.queryByTestId('qos-badge')).not.toBeNull());

      const badge = screen.getByTestId('qos-badge');
      expect(badge.textContent).toMatch(/QoS fair/);
      expect(badge.textContent).toMatch(/300/);
      const dot = badge.querySelector('span');
      expect(dot).not.toBeNull();
      expect((dot as HTMLElement).className).toEqual(expect.stringContaining('bg-amber-500'));
    });

    test('p95Ms = 650 → "QoS poor" and red token', async () => {
      mockGetStats.mockImplementation(() => ({ p95Ms: 650, messagesReceived: 0, uptime: 0 }));
      const { default: MissionControlLayout } = await import('../../../MissionControlLayout');
      render(<MissionControlLayout />);

      await waitFor(() => expect(screen.queryByTestId('qos-badge')).not.toBeNull());

      const badge = screen.getByTestId('qos-badge');
      expect(badge.textContent).toMatch(/QoS poor/);
      expect(badge.textContent).toMatch(/650/);
      const dot = badge.querySelector('span');
      expect(dot).not.toBeNull();
      expect((dot as HTMLElement).className).toEqual(expect.stringContaining('bg-red-500'));
    });

    test('polling/refresh reflects updated p95 when timers advance', async () => {
      // Use fake timers to exercise setInterval path
      jest.useFakeTimers();
      // First call returns 120, later returns 650
      let call = 0;
      mockGetStats.mockImplementation(() => {
        call += 1;
        return call === 1 ? { p95Ms: 120, messagesReceived: 0, uptime: 0 } : { p95Ms: 650, messagesReceived: 0, uptime: 0 };
      });

      const { default: MissionControlLayout } = await import('../../../MissionControlLayout');
      render(<MissionControlLayout />);

      // Initially should show first value
      await waitFor(() => expect(screen.queryByTestId('qos-badge')).not.toBeNull());
      expect(screen.getByTestId('qos-badge').textContent).toMatch(/QoS good/);
      // Advance timers to trigger interval pull (1s in code)
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      // Wait for DOM update reflecting second mocked value
      await waitFor(() => expect(screen.getByTestId('qos-badge').textContent).toMatch(/QoS poor/));
      jest.useRealTimers();
    });
  });
});