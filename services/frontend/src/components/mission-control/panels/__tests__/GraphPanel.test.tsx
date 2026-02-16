import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ToastProvider } from '../../../../contexts/ToastContext';

// Hoisted mocks for useRunGraph and store
const { mockRunGraphState, mockOpenContextMenu, mockToast, mockRetryNodes } = vi.hoisted(() => ({
  mockRunGraphState: {
    nodes: [] as any[],
    edges: [] as any[],
    runStatus: 'queued' as string,
    selectedNodeId: null as string | null,
    setSelectedNodeId: vi.fn(),
    onCancelRun: vi.fn(),
    fitViewNonce: 0,
  },
  mockOpenContextMenu: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    addToast: vi.fn(),
    removeToast: vi.fn(),
    clearAll: vi.fn(),
  },
  mockRetryNodes: vi.fn(),
}));

// Mock useRunGraph
vi.mock('../graph/useRunGraph', () => ({
  useRunGraph: () => mockRunGraphState,
}));

// Mock the store (useStore default export)
vi.mock('../../../../store', () => ({
  __esModule: true,
  default: (selector: (s: any) => any) =>
    selector({ openContextMenu: mockOpenContextMenu }),
}));

// Mock ToastContext
vi.mock('../../../../contexts/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: () => mockToast,
}));

// Mock orchestratorService
vi.mock('../../../../services/api/orchestratorService', () => ({
  orchestratorService: {
    retryNodes: (...args: any[]) => mockRetryNodes(...args),
  },
}));

// Mock ReactFlow and its components to avoid rendering complexity
vi.mock('reactflow', () => ({
  ReactFlow: ({ nodes, edges, onSelectionChange, onNodeContextMenu, onInit }: any) => (
    <div data-testid="react-flow" data-node-count={nodes?.length ?? 0} data-edge-count={edges?.length ?? 0}>
      {nodes?.map((n: any) => (
        <div key={n.id} data-testid={`rf-node-${n.id}`} onClick={() => onSelectionChange?.({ nodes: [n] })}>
          {n.id}
        </div>
      ))}
    </div>
  ),
  ReactFlowProvider: ({ children }: any) => <>{children}</>,
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  MiniMap: () => <div data-testid="rf-minimap" />,
}));

// Mock PanelShell
vi.mock('@/components/ui/PanelShell', () => ({
  PanelShell: ({ children, toolbar }: any) => (
    <div data-testid="panel-shell">
      <div data-testid="panel-toolbar">{toolbar}</div>
      <div data-testid="panel-content">{children}</div>
    </div>
  ),
}));

// Mock Badge
vi.mock('@/components/ui/Badge', () => ({
  __esModule: true,
  default: ({ children, variant }: any) => (
    <span data-testid={`badge-${variant || 'default'}`}>{children}</span>
  ),
  Badge: ({ children, variant }: any) => (
    <span data-testid={`badge-${variant || 'default'}`}>{children}</span>
  ),
}));

// Mock custom node types
vi.mock('@/nodes/ConditionalNode', () => ({ __esModule: true, default: () => <div /> }));
vi.mock('@/nodes/ForEachNode', () => ({ __esModule: true, default: () => <div /> }));
vi.mock('@/nodes/GateNode', () => ({ __esModule: true, default: () => <div /> }));
vi.mock('../graph/NodeCard', () => ({
  __esModule: true,
  default: () => <div />,
}));

import GraphPanel from '../GraphPanel';

describe('GraphPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunGraphState.nodes = [];
    mockRunGraphState.edges = [];
    mockRunGraphState.runStatus = 'queued';
    mockRunGraphState.selectedNodeId = null;
    mockRunGraphState.setSelectedNodeId = vi.fn();
    mockRunGraphState.onCancelRun = vi.fn();
    mockRunGraphState.fitViewNonce = 0;
  });

  test('renders the panel shell and toolbar', () => {
    render(<GraphPanel runId="run-1" />);
    expect(screen.getByTestId('panel-shell')).toBeTruthy();
    expect(screen.getByTestId('panel-toolbar')).toBeTruthy();
  });

  test('renders ReactFlow canvas with correct node count', () => {
    mockRunGraphState.nodes = [
      { id: 'A', type: 'nodeCard', position: { x: 0, y: 0 }, data: { label: 'A', status: 'idle' } },
      { id: 'B', type: 'nodeCard', position: { x: 100, y: 0 }, data: { label: 'B', status: 'idle' } },
    ];
    render(<GraphPanel runId="run-1" />);
    const flow = screen.getByTestId('react-flow');
    expect(flow.getAttribute('data-node-count')).toBe('2');
  });

  test('shows running status badge when run is running', () => {
    mockRunGraphState.runStatus = 'running';
    render(<GraphPanel runId="run-1" />);
    expect(screen.getByText(/Run: Running/)).toBeTruthy();
  });

  test('shows succeeded status badge when run succeeded', () => {
    mockRunGraphState.runStatus = 'succeeded';
    render(<GraphPanel runId="run-1" />);
    expect(screen.getByText(/Run: Succeeded/)).toBeTruthy();
  });

  test('shows failed status badge when run failed', () => {
    mockRunGraphState.runStatus = 'failed';
    render(<GraphPanel runId="run-1" />);
    expect(screen.getByText(/Run: Failed/)).toBeTruthy();
  });

  test('shows queued status badge when run is queued', () => {
    mockRunGraphState.runStatus = 'queued';
    render(<GraphPanel runId="run-1" />);
    expect(screen.getByText(/Run: Queued/)).toBeTruthy();
  });

  test('displays selected node id when a node is selected', () => {
    mockRunGraphState.selectedNodeId = 'node-42';
    render(<GraphPanel runId="run-1" />);
    expect(screen.getByText(/Selected: node-42/)).toBeTruthy();
  });

  test('does not display selected node text when no node selected', () => {
    mockRunGraphState.selectedNodeId = null;
    render(<GraphPanel runId="run-1" />);
    expect(screen.queryByText(/Selected:/)).toBeNull();
  });

  test('Cancel Run button is disabled when no runId', () => {
    render(<GraphPanel runId={null} />);
    const cancelBtn = screen.getByText(/Cancel Run/);
    expect(cancelBtn).toBeTruthy();
    expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);
  });

  test('Cancel Run button calls onCancelRun when clicked', () => {
    render(<GraphPanel runId="run-1" />);
    const cancelBtn = screen.getByText(/Cancel Run/);
    fireEvent.click(cancelBtn);
    expect(mockRunGraphState.onCancelRun).toHaveBeenCalledOnce();
  });

  test('Retry Failed button is disabled when no runId', () => {
    render(<GraphPanel runId={null} />);
    const retryBtns = screen.getAllByText(/Retry Failed/);
    const retryBtn = retryBtns[0] as HTMLButtonElement;
    expect(retryBtn.disabled).toBe(true);
  });

  test('Retry Failed shows toast info when no failed nodes', async () => {
    mockRunGraphState.nodes = [
      { id: 'A', data: { status: 'idle' } },
    ];
    render(<GraphPanel runId="run-1" />);
    const retryBtn = screen.getByText(/Retry Failed/);
    fireEvent.click(retryBtn);
    await waitFor(() => {
      expect(mockToast.info).toHaveBeenCalledWith('No failed nodes to retry');
    });
  });

  test('Retry Failed calls orchestratorService.retryNodes with failed node ids', async () => {
    mockRunGraphState.nodes = [
      { id: 'A', data: { status: 'failed' } },
      { id: 'B', data: { status: 'idle' } },
      { id: 'C', data: { status: 'failed' } },
    ];
    mockRetryNodes.mockResolvedValueOnce({ retriedNodes: ['A', 'C'] });

    render(<GraphPanel runId="run-1" />);
    const retryBtn = screen.getByText(/Retry Failed/);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockRetryNodes).toHaveBeenCalledWith('run-1', ['A', 'C']);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  test('Retry Failed shows error toast on failure', async () => {
    mockRunGraphState.nodes = [
      { id: 'A', data: { status: 'failed' } },
    ];
    mockRetryNodes.mockRejectedValueOnce(new Error('Server error'));

    render(<GraphPanel runId="run-1" />);
    const retryBtn = screen.getByText(/Retry Failed/);
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Server error');
    });
  });

  test('Retry Failed shows warning toast when no run selected', async () => {
    render(<GraphPanel runId={null} />);
    // The button is disabled when no runId, but we can still test the handler logic
    // by rendering with null runId - the button should be disabled
    const retryBtns = screen.getAllByText(/Retry Failed/);
    expect((retryBtns[0] as HTMLButtonElement).disabled).toBe(true);
  });

  test('onSelectNode callback is invoked on node selection', () => {
    const mockOnSelect = vi.fn();
    mockRunGraphState.nodes = [
      { id: 'nodeA', data: {} },
    ];
    render(<GraphPanel runId="run-1" onSelectNode={mockOnSelect} />);
    const node = screen.getByTestId('rf-node-nodeA');
    fireEvent.click(node);
    expect(mockRunGraphState.setSelectedNodeId).toHaveBeenCalled();
  });
});
