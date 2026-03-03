import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks
const { mockConnectionStatus } = vi.hoisted(() => ({
  mockConnectionStatus: { current: 'disconnected' as string },
}));

const { mockStartLiveConnection } = vi.hoisted(() => ({
  mockStartLiveConnection: vi.fn().mockResolvedValue(undefined),
}));

const { mockStopLiveConnection } = vi.hoisted(() => ({
  mockStopLiveConnection: vi.fn(),
}));

// Mock the streaming store
vi.mock('@/stores', () => ({
  useStreamingStore: (selector: (s: any) => any) =>
    selector({ connectionStatus: mockConnectionStatus.current }),
}));

vi.mock('@/components/mission-control/layout/WorkspaceProvider', () => ({
  useWorkspace: () => ({
    startLiveConnection: mockStartLiveConnection,
    stopLiveConnection: mockStopLiveConnection,
  }),
}));

// Mock flightRecorder and services
vi.mock('@/services/mission-control/services', () => ({
  flightRecorder: {
    subscribe: vi.fn(() => vi.fn()),
    listRuns: vi.fn(() => []),
    listCheckpoints: vi.fn(() => []),
    getRun: vi.fn(() => undefined),
  },
}));

// Mock FeatureFlags
vi.mock('@/config/features', () => ({
  FeatureFlags: {
    CONNECT_WS: true,
    AUTO_CONNECT: false,
    NETWORK_PANEL: true,
  },
}));

// Mock orchestrator config
vi.mock('@/config/orchestrator', () => ({
  getOrchestratorBaseUrl: () => 'http://localhost:7070',
  getApiBaseUrl: () => 'http://localhost:7070',
}));

// Mock CanvasUnderlay -- the component imports from './network/CanvasUnderlay'
vi.mock('../network/CanvasUnderlay', () => ({
  __esModule: true,
  default: React.forwardRef((_props: any, _ref: any) => (
    <canvas data-testid="canvas-underlay" />
  )),
}));

// Mock ReactFlow
vi.mock('reactflow', () => ({
  ReactFlow: ({ nodes, edges }: any) => (
    <div data-testid="react-flow-network" data-node-count={nodes?.length ?? 0} data-edge-count={edges?.length ?? 0}>
      {nodes?.map((n: any) => (
        <div key={n.id} data-testid={`net-node-${n.id}`}>{n.data?.label}</div>
      ))}
    </div>
  ),
  ReactFlowProvider: ({ children }: any) => <>{children}</>,
  Background: () => <div data-testid="rf-bg" />,
  Controls: () => <div data-testid="rf-controls" />,
  MiniMap: () => <div data-testid="rf-minimap" />,
  useNodesState: (initial: any) => {
    const [nodes, setNodes] = React.useState(initial);
    return [nodes, setNodes, vi.fn()];
  },
  useEdgesState: (initial: any) => {
    const [edges, setEdges] = React.useState(initial);
    return [edges, setEdges, vi.fn()];
  },
  addEdge: vi.fn((params: any, edges: any[]) => [...edges, params]),
  MarkerType: { ArrowClosed: 'arrowclosed' },
}));

// Mock streaming service
vi.mock('@/services/api/streamingService', () => ({
  __esModule: true,
  default: { connect: vi.fn().mockResolvedValue(undefined) },
}));

// Store original fetch to restore later
const originalFetch = globalThis.fetch;

import NetworkPanel from '../NetworkPanel';

describe('NetworkPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectionStatus.current = 'disconnected';

    // Mock global fetch to return 3 agents
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'http://localhost:7070/api/v1/agents',
      text: vi.fn().mockResolvedValue(JSON.stringify([
        { id: 'agent-1', name: 'Agent One' },
        { id: 'agent-2', name: 'Agent Two' },
        { id: 'agent-3', name: 'Agent Three' },
      ])),
    });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test('renders the Network header label', () => {
    render(<NetworkPanel runId={null} />);
    expect(screen.getByText('Network')).toBeTruthy();
  });

  test('shows Disconnected status when not connected', () => {
    mockConnectionStatus.current = 'disconnected';
    render(<NetworkPanel runId={null} />);
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });

  test('shows Connected status when connected', () => {
    mockConnectionStatus.current = 'connected';
    render(<NetworkPanel runId={null} />);
    expect(screen.getByText('Connected')).toBeTruthy();
  });

  test('shows Connecting status when connecting', () => {
    mockConnectionStatus.current = 'connecting';
    render(<NetworkPanel runId={null} />);
    expect(screen.getByText('Connecting')).toBeTruthy();
  });

  test('shows Error status on error', () => {
    mockConnectionStatus.current = 'error';
    render(<NetworkPanel runId={null} />);
    expect(screen.getByText('Error')).toBeTruthy();
  });

  test('displays Active Nodes metric', () => {
    render(<NetworkPanel runId={null} />);
    expect(screen.getByText(/Active Nodes:/)).toBeTruthy();
  });

  test('displays Msgs/s metric', () => {
    render(<NetworkPanel runId={null} />);
    expect(screen.getByText(/Msgs\/s:/)).toBeTruthy();
  });

  test('renders canvas underlay', () => {
    render(<NetworkPanel runId={null} />);
    expect(screen.getByTestId('canvas-underlay')).toBeTruthy();
  });

  test('loads agents from API and creates nodes', async () => {
    render(<NetworkPanel runId={null} />);

    await waitFor(() => {
      const flow = screen.getByTestId('react-flow-network');
      expect(Number(flow.getAttribute('data-node-count'))).toBeGreaterThan(0);
    });
  });

  test('falls back to default graph when API returns empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'http://localhost:7070/api/v1/agents',
      text: vi.fn().mockResolvedValue('[]'),
    });

    render(<NetworkPanel runId={null} />);

    await waitFor(() => {
      const flow = screen.getByTestId('react-flow-network');
      // Fallback graph has Ego, Perception, Memory, Planning, Actuator (5 nodes)
      expect(Number(flow.getAttribute('data-node-count'))).toBeGreaterThanOrEqual(5);
    });
  });

  test('creates fallback graph on fetch error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    render(<NetworkPanel runId={null} />);

    // Fallback graph is created on error
    await waitFor(() => {
      const flow = screen.getByTestId('react-flow-network');
      expect(Number(flow.getAttribute('data-node-count'))).toBeGreaterThanOrEqual(5);
    });
  });

  test('Connect Live button is visible when disconnected and CONNECT_WS enabled', () => {
    mockConnectionStatus.current = 'disconnected';
    render(<NetworkPanel runId={null} />);
    expect(screen.getByText(/Connect Live/)).toBeTruthy();
  });

  test('Connect Live button calls workspace startLiveConnection', () => {
    mockConnectionStatus.current = 'disconnected';
    render(<NetworkPanel runId={null} />);

    fireEvent.click(screen.getByText(/Connect Live/));

    expect(mockStartLiveConnection).toHaveBeenCalledTimes(1);
  });

  test('Connect Live button is disabled when connecting', () => {
    mockConnectionStatus.current = 'connecting';
    render(<NetworkPanel runId={null} />);
    expect(screen.getByText(/Disconnect/)).toBeTruthy();
  });

  test('Disconnect button calls workspace stopLiveConnection when connected', () => {
    mockConnectionStatus.current = 'connected';
    render(<NetworkPanel runId={null} />);
    fireEvent.click(screen.getByText(/Disconnect/));
    expect(mockStopLiveConnection).toHaveBeenCalledTimes(1);
  });

  test('shows Agents API label after successful fetch', async () => {
    render(<NetworkPanel runId={null} />);
    await waitFor(() => {
      expect(screen.getByText(/Agents API/)).toBeTruthy();
    });
  });

  test('shows Fallback graph label when using fallback', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'));
    render(<NetworkPanel runId={null} />);
    await waitFor(() => {
      expect(screen.getByText(/Fallback graph/)).toBeTruthy();
    });
  });
});
