import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { enableMapSet } from 'immer';

enableMapSet();

// ---------------------------------------------------------------------------
// Mock modules (must be before imports that use them)
// ---------------------------------------------------------------------------
const mockListFlows = vi.fn();

vi.mock('@/services/api/flowService', () => ({
  getFlowService: vi.fn(() => ({
    listFlows: mockListFlows,
  })),
}));

vi.mock('@/services/api/httpClient', () => ({
  httpClient: {},
}));

vi.mock('@/config/features', () => ({
  FeatureFlags: {
    DEMO_MODE: true,
  },
}));

vi.mock('@/data/exampleFlows', () => ({
  EXAMPLE_FLOWS: [
    {
      meta: {
        id: 'example-1',
        name: 'Example Flow 1',
        description: 'Test example',
        createdAt: '2024-01-01T00:00:00Z',
      },
      graph: {
        nodes: [
          { id: 'n1', type: 'agent', position: { x: 0, y: 0 }, params: { prompt: 'hi' }, outputs: {} },
        ],
        edges: [
          { from: 'n1.out', to: 'n2.in' },
        ],
      },
    },
  ],
}));

// Import after mocks
import { useFlowLoader } from '../useFlowLoader';
import { useFlowStore } from '@/stores/flow';

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockListFlows.mockReset();

  // Reset the flow store
  useFlowStore.setState({
    flows: new Map(),
    activeFlowId: null,
    history: [],
    historyIndex: -1,
    maxHistorySize: 50,
  });
});

// ============================================================================
// useFlowLoader
// ============================================================================

describe('useFlowLoader - successful API load', () => {
  it('populates flow store from backend response', async () => {
    mockListFlows.mockResolvedValue({
      flows: [
        {
          id: 'flow-1',
          name: 'Backend Flow',
          description: 'From API',
          graph: { nodes: [], edges: [] },
          metadata: {},
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-06-01T00:00:00Z',
        },
      ],
    });

    const { result } = renderHook(() => useFlowLoader());

    await waitFor(() => {
      expect(useFlowStore.getState().flows.size).toBe(1);
    });

    const flow = Array.from(useFlowStore.getState().flows.values())[0];
    expect(flow.name).toBe('Backend Flow');
    expect(flow.description).toBe('From API');
  });

  it('sets the first flow as active', async () => {
    mockListFlows.mockResolvedValue({
      flows: [
        {
          id: 'flow-1',
          name: 'First',
          graph: { nodes: [], edges: [] },
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 'flow-2',
          name: 'Second',
          graph: { nodes: [], edges: [] },
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ],
    });

    renderHook(() => useFlowLoader());

    await waitFor(() => {
      expect(useFlowStore.getState().activeFlowId).toBe('flow-1');
    });
  });
});

describe('useFlowLoader - empty API response', () => {
  it('loads example flows in DEMO_MODE when API returns empty', async () => {
    mockListFlows.mockResolvedValue({ flows: [] });

    renderHook(() => useFlowLoader());

    await waitFor(() => {
      expect(useFlowStore.getState().flows.size).toBeGreaterThan(0);
    });

    const flow = useFlowStore.getState().flows.get('example-1');
    expect(flow).toBeDefined();
    expect(flow!.name).toBe('Example Flow 1');
  });

  it('loads example flows when API returns null flows', async () => {
    mockListFlows.mockResolvedValue({ flows: null });

    renderHook(() => useFlowLoader());

    await waitFor(() => {
      expect(useFlowStore.getState().flows.size).toBeGreaterThan(0);
    });
  });
});

describe('useFlowLoader - API error', () => {
  it('falls back to example flows when API fails', async () => {
    mockListFlows.mockRejectedValue(new Error('Network error'));

    // Suppress the console.warn
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderHook(() => useFlowLoader());

    await waitFor(() => {
      expect(useFlowStore.getState().flows.size).toBeGreaterThan(0);
    });
  });

  it('returns loaded=false on initial render (ref set inside useEffect)', () => {
    // loadedRef is set to true inside useEffect, which fires after the first render.
    // Because the hook returns a ref value (not state), the component does not
    // re-render when it changes.  The synchronous snapshot after renderHook
    // therefore sees the pre-effect value.
    mockListFlows.mockReturnValue(new Promise(() => {})); // Never resolves
    const { result } = renderHook(() => useFlowLoader());
    // On the very first render the ref hasn't been set yet
    expect(result.current.loaded).toBe(false);
  });
});

describe('useFlowLoader - does not overwrite existing flows', () => {
  it('skips loading when flows already exist in store', async () => {
    // Pre-populate the store
    useFlowStore.setState((state) => {
      state.flows.set('existing', {
        id: 'existing',
        name: 'Existing Flow',
        nodes: [],
        edges: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    mockListFlows.mockResolvedValue({
      flows: [
        {
          id: 'flow-api',
          name: 'From API',
          graph: { nodes: [], edges: [] },
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ],
    });

    renderHook(() => useFlowLoader());

    // Wait for the promise to settle
    await waitFor(() => {
      expect(mockListFlows).toHaveBeenCalled();
    });

    // The store should still have the original flow, not the API flow
    expect(useFlowStore.getState().flows.has('existing')).toBe(true);
    expect(useFlowStore.getState().flows.size).toBe(1);
  });
});
