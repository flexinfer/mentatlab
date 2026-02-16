import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Agent } from '@/services/api/agentService';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------
const mockListAgents = vi.fn();

vi.mock('@/services/api/agentService', () => ({
  getAgentService: vi.fn(() => ({
    listAgents: mockListAgents,
  })),
}));

vi.mock('@/services/api/httpClient', () => ({
  httpClient: {},
}));

// Import after mocks are set up
import { useAgentList } from '../useAgentList';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const fakeAgents: Agent[] = [
  {
    id: 'agent-1',
    name: 'Echo Agent',
    type: 'echo',
    status: 'online',
    capabilities: ['text'],
    config: {},
  },
  {
    id: 'agent-2',
    name: 'Psyche Agent',
    type: 'psyche',
    status: 'busy',
    capabilities: ['text', 'reasoning'],
    config: { model: 'gpt-4' },
  },
];

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockListAgents.mockReset();
});

// ═══════════════════════════════════════════════════════════════════════════
// Initial loading state
// ═══════════════════════════════════════════════════════════════════════════

describe('useAgentList - initial state', () => {
  it('starts with loading=true and agents=[]', () => {
    // Return a promise that never resolves to test the initial state
    mockListAgents.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAgentList());

    expect(result.current.loading).toBe(true);
    expect(result.current.agents).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.selectedAgent).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Successful fetch
// ═══════════════════════════════════════════════════════════════════════════

describe('useAgentList - successful fetch', () => {
  it('populates agents after fetch (array response)', async () => {
    mockListAgents.mockResolvedValue(fakeAgents);

    const { result } = renderHook(() => useAgentList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents).toEqual(fakeAgents);
    expect(result.current.error).toBeNull();
  });

  it('populates agents from { agents: [...] } response shape', async () => {
    mockListAgents.mockResolvedValue({ agents: fakeAgents });

    const { result } = renderHook(() => useAgentList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.agents).toEqual(fakeAgents);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Error handling
// ═══════════════════════════════════════════════════════════════════════════

describe('useAgentList - error handling', () => {
  it('sets error and empties agents on failure', async () => {
    mockListAgents.mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useAgentList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network failure');
    expect(result.current.agents).toEqual([]);
  });

  it('falls back to generic error message when error has no message', async () => {
    mockListAgents.mockRejectedValue({});

    const { result } = renderHook(() => useAgentList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to load agents');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Refresh
// ═══════════════════════════════════════════════════════════════════════════

describe('useAgentList - refresh', () => {
  it('triggers a new fetch', async () => {
    mockListAgents.mockResolvedValue(fakeAgents);

    const { result } = renderHook(() => useAgentList());

    // Wait for initial fetch
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mockListAgents).toHaveBeenCalledTimes(1);

    // Update mock to return different data
    const updatedAgents = [fakeAgents[0]!];
    mockListAgents.mockResolvedValue(updatedAgents);

    // Trigger refresh
    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockListAgents).toHaveBeenCalledTimes(2);
    expect(result.current.agents).toEqual(updatedAgents);
  });

  it('clears previous error on refresh', async () => {
    // First call fails
    mockListAgents.mockRejectedValueOnce(new Error('Temporary error'));

    const { result } = renderHook(() => useAgentList());

    await waitFor(() => {
      expect(result.current.error).toBe('Temporary error');
    });

    // Second call succeeds
    mockListAgents.mockResolvedValue(fakeAgents);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.agents).toEqual(fakeAgents);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// selectAgent
// ═══════════════════════════════════════════════════════════════════════════

describe('useAgentList - selectAgent', () => {
  it('updates selectedAgent', async () => {
    mockListAgents.mockResolvedValue(fakeAgents);

    const { result } = renderHook(() => useAgentList());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.selectAgent(fakeAgents[0]!);
    });
    expect(result.current.selectedAgent).toEqual(fakeAgents[0]);

    act(() => {
      result.current.selectAgent(null);
    });
    expect(result.current.selectedAgent).toBeNull();
  });
});
