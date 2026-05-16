import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks
const { mockFlightRecorder, mockCanvasStoreState, mockUpdateNodeConfig } = vi.hoisted(() => ({
  mockFlightRecorder: {
    listCheckpoints: vi.fn(() => []),
    getRun: vi.fn(() => undefined),
    subscribe: vi.fn(() => vi.fn()),
  },
  mockCanvasStoreState: {
    nodes: [] as any[],
  },
  mockUpdateNodeConfig: vi.fn(),
}));

// Mock services
vi.mock('@/services/mission-control/services', () => ({
  flightRecorder: mockFlightRecorder,
}));

// Mock canvas store
vi.mock('@/stores/canvas', () => ({
  useCanvasStore: {
    getState: () => ({
      nodes: mockCanvasStoreState.nodes,
      updateNodeConfig: mockUpdateNodeConfig,
    }),
  },
}));

import InspectorPanel from '../InspectorPanel';

function selectGraphNode(nodeId: string) {
  act(() => {
    window.dispatchEvent(new CustomEvent('graphNodeSelected', { detail: { nodeId } }));
  });
}

function clearGraphNodeSelection() {
  act(() => {
    window.dispatchEvent(new CustomEvent('graphNodeCleared'));
  });
}

describe('InspectorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlightRecorder.listCheckpoints.mockReturnValue([]);
    mockFlightRecorder.getRun.mockReturnValue(undefined);
    mockFlightRecorder.subscribe.mockReturnValue(vi.fn());
    mockCanvasStoreState.nodes = [];
    mockUpdateNodeConfig.mockClear();
  });

  test('renders Run section heading', () => {
    render(<InspectorPanel runId={null} />);
    expect(screen.getByText('Run')).toBeTruthy();
  });

  test('shows "No active run" when runId is null', () => {
    render(<InspectorPanel runId={null} />);
    expect(screen.getByText('No active run')).toBeTruthy();
  });

  test('displays runId when provided', () => {
    mockFlightRecorder.listCheckpoints.mockReturnValue([{}, {}]);
    mockFlightRecorder.getRun.mockReturnValue({ status: 'running' });

    render(<InspectorPanel runId="run-abc-123" />);
    expect(screen.getByText('run-abc-123')).toBeTruthy();
  });

  test('shows run status from flight recorder', () => {
    mockFlightRecorder.listCheckpoints.mockReturnValue([]);
    mockFlightRecorder.getRun.mockReturnValue({ status: 'completed' });

    render(<InspectorPanel runId="run-1" />);
    expect(screen.getByText('completed')).toBeTruthy();
  });

  test('displays checkpoint count', () => {
    mockFlightRecorder.listCheckpoints.mockReturnValue([{}, {}, {}]);
    mockFlightRecorder.getRun.mockReturnValue({ status: 'running' });

    render(<InspectorPanel runId="run-1" />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  test('shows "No node selected" when no node is selected', () => {
    render(<InspectorPanel runId="run-1" />);
    expect(screen.getByText('No node selected')).toBeTruthy();
  });

  test('renders Selection section heading', () => {
    render(<InspectorPanel runId={null} />);
    expect(screen.getByText('Selection')).toBeTruthy();
  });

  test('shows node details when graphNodeSelected event fires', async () => {
    mockCanvasStoreState.nodes = [
      { id: 'node-X', type: 'agent', data: { retry_policy: null, timeout: null } },
    ];

    render(<InspectorPanel runId="run-1" />);

    // Simulate graphNodeSelected custom event
    selectGraphNode('node-X');

    await waitFor(() => {
      expect(screen.getByText('node-X')).toBeTruthy();
    });
  });

  test('shows node type when node is selected via event', async () => {
    mockCanvasStoreState.nodes = [
      { id: 'node-Y', type: 'conditional', data: {} },
    ];

    render(<InspectorPanel runId="run-1" />);
    selectGraphNode('node-Y');

    await waitFor(() => {
      expect(screen.getByText('conditional')).toBeTruthy();
    });
  });

  test('clears selection on graphNodeCleared event', async () => {
    mockCanvasStoreState.nodes = [
      { id: 'node-Z', type: 'agent', data: {} },
    ];

    render(<InspectorPanel runId="run-1" />);

    // Select a node
    selectGraphNode('node-Z');
    await waitFor(() => {
      expect(screen.getByText('node-Z')).toBeTruthy();
    });

    // Clear selection
    clearGraphNodeSelection();
    await waitFor(() => {
      expect(screen.getByText('No node selected')).toBeTruthy();
    });
  });

  test('renders Timeout input when node is selected', async () => {
    mockCanvasStoreState.nodes = [
      { id: 'nodeA', type: 'agent', data: { timeout: 30000000000 } },
    ];

    render(<InspectorPanel runId="run-1" />);
    selectGraphNode('nodeA');

    await waitFor(() => {
      expect(screen.getByText('Timeout')).toBeTruthy();
      expect(screen.getByPlaceholderText('seconds')).toBeTruthy();
    });
  });

  test('renders Retry Policy editor when node is selected', async () => {
    mockCanvasStoreState.nodes = [
      { id: 'nodeB', type: 'agent', data: {} },
    ];

    render(<InspectorPanel runId="run-1" />);
    selectGraphNode('nodeB');

    await waitFor(() => {
      expect(screen.getByText('Retry Policy')).toBeTruthy();
      expect(screen.getByText('Max retries')).toBeTruthy();
      expect(screen.getByText('Backoff type')).toBeTruthy();
    });
  });

  test('shows readiness checklist for selected chat nodes', async () => {
    mockCanvasStoreState.nodes = [
      { id: 'chat-1', type: 'chat', data: { label: 'Synthesis Agent', prompt: 'Write a brief.' } },
    ];

    render(<InspectorPanel runId="run-1" />);
    selectGraphNode('chat-1');

    await waitFor(() => {
      expect(screen.getByText('Configuration Checklist')).toBeTruthy();
      expect(screen.getByText('Prompt')).toBeTruthy();
      expect(screen.getByText('Prompt configured')).toBeTruthy();
    });
  });

  test('flags unresolved FlexInfer runtime env in checklist', async () => {
    mockCanvasStoreState.nodes = [
      {
        id: 'mcp-1',
        type: 'mcp:flexinfer-template-inference',
        data: {
          label: 'FlexInfer Inference',
          tool_name: 'flexinfer__inference_chat',
          runtime_contract: {
            required_env: ['FLEXINFER_PROXY_URL', 'FLEXINFER_MODEL', 'FLEXINFER_PROMPT'],
          },
          tool_args: {
            proxy_url: '${FLEXINFER_PROXY_URL}',
            model: '${FLEXINFER_MODEL}',
            prompt: '${FLEXINFER_PROMPT}',
          },
        },
      },
    ];

    render(<InspectorPanel runId="run-1" />);
    selectGraphNode('mcp-1');

    await waitFor(() => {
      expect(screen.getByText('Runtime env')).toBeTruthy();
      expect(screen.getByText('FLEXINFER_PROXY_URL, FLEXINFER_MODEL, FLEXINFER_PROMPT')).toBeTruthy();
      expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    });
  });

  test('subscribes to flight recorder on run change', () => {
    render(<InspectorPanel runId="run-1" />);
    expect(mockFlightRecorder.subscribe).toHaveBeenCalledWith('run-1', expect.any(Function));
  });

  test('does not subscribe when runId is null', () => {
    render(<InspectorPanel runId={null} />);
    expect(mockFlightRecorder.subscribe).not.toHaveBeenCalled();
  });

  test('shows n/a status when flight recorder returns no run', () => {
    mockFlightRecorder.listCheckpoints.mockReturnValue([]);
    mockFlightRecorder.getRun.mockReturnValue(undefined);

    render(<InspectorPanel runId="run-1" />);
    expect(screen.getByText('n/a')).toBeTruthy();
  });
});
