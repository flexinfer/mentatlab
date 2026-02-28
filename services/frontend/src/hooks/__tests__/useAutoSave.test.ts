import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockSaveFlow, mockGetFlowService } = vi.hoisted(() => {
  const saveFlow = vi.fn();
  return {
    mockSaveFlow: saveFlow,
    mockGetFlowService: vi.fn(() => ({
      saveFlow,
    })),
  };
});

vi.mock('../../services/api/flowService', () => ({
  FlowService: class {},
  getFlowService: mockGetFlowService,
}));

vi.mock('../../services/api/httpClient', () => ({
  httpClient: {},
}));

import { useAutoSave } from '../useAutoSave';
import { useFlowStore } from '@/stores/flow';

function resetFlowStore() {
  useFlowStore.setState({
    flows: new Map(),
    activeFlowId: null,
    history: [],
    historyIndex: -1,
    maxHistorySize: 50,
  });
}

function setSingleFlow(flow: any) {
  useFlowStore.setState({
    flows: new Map([[flow.id, flow]]),
    activeFlowId: flow.id,
  });
}

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFlowStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes canonical flow nodes/edges when graph wrapper is absent', async () => {
    mockSaveFlow.mockResolvedValueOnce({ updated_at: '2026-01-01T00:00:00Z' });

    const { result } = renderHook(() => useAutoSave({ enabled: false }));
    await waitFor(() => expect(mockGetFlowService).toHaveBeenCalled());

    const nodes = [
      { id: 'n1', type: 'agent', position: { x: 10, y: 20 }, data: { agent_id: 'echo' } },
    ];
    const edges = [
      { id: 'e-1', source: 'n1', target: 'n2' },
    ];

    await act(async () => {
      setSingleFlow({
        id: 'flow-1',
        name: 'Flow One',
        nodes,
        edges,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await result.current.saveNow();
    });

    expect(mockSaveFlow).toHaveBeenCalledTimes(1);
    const payload = mockSaveFlow.mock.calls[0][0];
    expect(payload.id).toBe('flow-1');
    expect(payload.graph).toEqual({ nodes, edges });
    expect(payload.metadata.lastModifiedLocally).toEqual(expect.any(String));
  });

  it('debounces store changes and returns to idle after a successful save', async () => {
    vi.useFakeTimers();
    mockSaveFlow.mockResolvedValue({ updated_at: '2026-01-01T00:00:00Z' });

    const { result } = renderHook(() => useAutoSave({ enabled: true, debounceMs: 50 }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGetFlowService).toHaveBeenCalled();

    act(() => {
      setSingleFlow({
        id: 'flow-2',
        name: 'Flow Two',
        nodes: [{ id: 'n1', type: 'agent', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    expect(result.current.pendingChanges).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(75);
    });

    expect(mockSaveFlow).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    expect(result.current.status).toBe('idle');
  });

  it('keeps conflict state when saveFlow reports a 409 conflict', async () => {
    const err: any = new Error('conflict');
    err.status = 409;
    mockSaveFlow.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useAutoSave({ enabled: false }));
    await waitFor(() => expect(mockGetFlowService).toHaveBeenCalled());

    await act(async () => {
      setSingleFlow({
        id: 'flow-3',
        name: 'Flow Three',
        nodes: [{ id: 'n1', type: 'agent', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await result.current.saveNow();
    });

    expect(result.current.status).toBe('conflict');
    expect(result.current.error?.message).toContain('modified on server');
  });
});
