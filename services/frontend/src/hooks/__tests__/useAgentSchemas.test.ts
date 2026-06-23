import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { enableMapSet } from 'immer';

enableMapSet();

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

// Import after mocks
import { useAgentSchemas } from '../useAgentSchemas';
import { useCanvasStore } from '@/stores/canvas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getCanvasState() {
  return useCanvasStore.getState();
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  mockListAgents.mockReset();

  // Reset canvas store
  getCanvasState().clearCanvas();
});

// ============================================================================
// useAgentSchemas
// ============================================================================

describe('useAgentSchemas - enriches nodes', () => {
  it('enriches canvas nodes with schema inputs/outputs', async () => {
    // Set up agents with schemas
    mockListAgents.mockResolvedValue([
      {
        id: 'agent-echo',
        name: 'Echo Agent',
        type: 'echo',
        status: 'online',
        capabilities: ['text'],
        config: {},
        metadata: {
          schema: {
            inputs: { prompt: { type: 'string', description: 'The prompt' } },
            outputs: { result: { type: 'string', description: 'The result' } },
          },
        },
      },
    ]);

    // Set up canvas node that references the agent
    getCanvasState().setNodes([
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { agent_id: 'agent-echo', label: 'Echo' },
      },
    ]);

    renderHook(() => useAgentSchemas());

    await waitFor(() => {
      const nodes = getCanvasState().nodes;
      const node = nodes.find((n: any) => n.id === 'node-1');
      expect(node).toBeDefined();
      expect((node as any).data.inputs).toEqual({
        prompt: { type: 'string', description: 'The prompt' },
      });
      expect((node as any).data.outputs).toEqual({
        result: { type: 'string', description: 'The result' },
      });
    });
  });

  it('does not overwrite existing inputs/outputs', async () => {
    mockListAgents.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Agent',
        type: 'test',
        status: 'online',
        capabilities: [],
        config: {},
        metadata: {
          schema: {
            inputs: { new_input: { type: 'string' } },
            outputs: { new_output: { type: 'string' } },
          },
        },
      },
    ]);

    // Set up a node that already has inputs and outputs
    getCanvasState().setNodes([
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: {
          agent_id: 'agent-1',
          inputs: { existing_input: { type: 'number' } },
          outputs: { existing_output: { type: 'boolean' } },
        },
      },
    ]);

    renderHook(() => useAgentSchemas());

    await waitFor(() => {
      expect(mockListAgents).toHaveBeenCalled();
    });

    // Should keep existing data since both inputs and outputs are populated
    const node = getCanvasState().nodes.find((n: any) => n.id === 'node-1');
    expect((node as any).data.inputs).toEqual({ existing_input: { type: 'number' } });
    expect((node as any).data.outputs).toEqual({ existing_output: { type: 'boolean' } });
  });
});

describe('useAgentSchemas - no matching agents', () => {
  it('does not modify nodes when no agent schemas match', async () => {
    mockListAgents.mockResolvedValue([
      {
        id: 'agent-x',
        name: 'Agent X',
        type: 'special',
        status: 'online',
        capabilities: [],
        config: {},
        metadata: {
          schema: {
            inputs: { x: { type: 'string' } },
          },
        },
      },
    ]);

    getCanvasState().setNodes([
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { agent_id: 'agent-y', label: 'Different agent' },
      },
    ]);

    renderHook(() => useAgentSchemas());

    await waitFor(() => {
      expect(mockListAgents).toHaveBeenCalled();
    });

    // Node should be unchanged
    const node = getCanvasState().nodes.find((n: any) => n.id === 'node-1');
    expect((node as any).data.inputs).toBeUndefined();
  });
});

describe('useAgentSchemas - API returns empty', () => {
  it('does nothing when no agents are returned', async () => {
    mockListAgents.mockResolvedValue([]);

    getCanvasState().setNodes([
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { agent_id: 'agent-1' },
      },
    ]);

    renderHook(() => useAgentSchemas());

    await waitFor(() => {
      expect(mockListAgents).toHaveBeenCalled();
    });

    // Node should be unchanged
    const node = getCanvasState().nodes.find((n: any) => n.id === 'node-1');
    expect((node as any).data.inputs).toBeUndefined();
  });
});

describe('useAgentSchemas - API error', () => {
  it('handles API errors gracefully', async () => {
    mockListAgents.mockRejectedValue(new Error('API Error'));

    vi.spyOn(console, 'warn').mockImplementation(() => {});

    getCanvasState().setNodes([
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { agent_id: 'agent-1' },
      },
    ]);

    // Should not throw
    renderHook(() => useAgentSchemas());

    await waitFor(() => {
      expect(mockListAgents).toHaveBeenCalled();
    });

    // Node should be unchanged
    expect(getCanvasState().nodes).toHaveLength(1);
  });
});

describe('useAgentSchemas - schema parsing variants', () => {
  it('parses schema from config field as fallback', async () => {
    mockListAgents.mockResolvedValue([
      {
        id: 'agent-cfg',
        name: 'Config Agent',
        type: 'test',
        status: 'online',
        capabilities: [],
        config: {
          schema: {
            inputs: { text: { type: 'string' } },
            outputs: { response: { type: 'string' } },
          },
        },
      },
    ]);

    getCanvasState().setNodes([
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { agent_id: 'agent-cfg' },
      },
    ]);

    renderHook(() => useAgentSchemas());

    await waitFor(() => {
      const node = getCanvasState().nodes.find((n: any) => n.id === 'node-1');
      expect((node as any).data.inputs).toEqual({ text: { type: 'string' } });
    });
  });

  it('handles agents with no schema', async () => {
    mockListAgents.mockResolvedValue([
      {
        id: 'agent-noschema',
        name: 'No Schema',
        type: 'basic',
        status: 'online',
        capabilities: [],
        config: {},
      },
    ]);

    getCanvasState().setNodes([
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { agent_id: 'agent-noschema' },
      },
    ]);

    renderHook(() => useAgentSchemas());

    await waitFor(() => {
      expect(mockListAgents).toHaveBeenCalled();
    });

    const node = getCanvasState().nodes.find((n: any) => n.id === 'node-1');
    expect((node as any).data.inputs).toBeUndefined();
  });

  it('parses string schema from metadata', async () => {
    mockListAgents.mockResolvedValue([
      {
        id: 'agent-str',
        name: 'String Schema',
        type: 'test',
        status: 'online',
        capabilities: [],
        config: {},
        metadata: {
          schema: JSON.stringify({
            inputs: { data: { type: 'object' } },
          }),
        },
      },
    ]);

    getCanvasState().setNodes([
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { agent_id: 'agent-str' },
      },
    ]);

    renderHook(() => useAgentSchemas());

    await waitFor(() => {
      const node = getCanvasState().nodes.find((n: any) => n.id === 'node-1');
      expect((node as any).data.inputs).toEqual({ data: { type: 'object' } });
    });
  });

  it('uses agentId alias (camelCase) on node data', async () => {
    mockListAgents.mockResolvedValue([
      {
        id: 'agent-camel',
        name: 'Camel Agent',
        type: 'test',
        status: 'online',
        capabilities: [],
        config: {},
        metadata: {
          schema: {
            inputs: { msg: { type: 'string' } },
          },
        },
      },
    ]);

    getCanvasState().setNodes([
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { agentId: 'agent-camel' },
      },
    ]);

    renderHook(() => useAgentSchemas());

    await waitFor(() => {
      const node = getCanvasState().nodes.find((n: any) => n.id === 'node-1');
      expect((node as any).data.inputs).toEqual({ msg: { type: 'string' } });
    });
  });

  it('handles result with agents property (paginated response)', async () => {
    mockListAgents.mockResolvedValue({
      agents: [
        {
          id: 'agent-paged',
          name: 'Paged Agent',
          type: 'test',
          status: 'online',
          capabilities: [],
          config: {},
          metadata: {
            schema: {
              inputs: { q: { type: 'string' } },
            },
          },
        },
      ],
    });

    getCanvasState().setNodes([
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { agent_id: 'agent-paged' },
      },
    ]);

    renderHook(() => useAgentSchemas());

    await waitFor(() => {
      const node = getCanvasState().nodes.find((n: any) => n.id === 'node-1');
      expect((node as any).data.inputs).toEqual({ q: { type: 'string' } });
    });
  });
});
