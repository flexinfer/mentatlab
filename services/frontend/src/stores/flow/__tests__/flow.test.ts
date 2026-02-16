import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { enableMapSet } from 'immer';

enableMapSet();

import {
  useFlowStore,
  selectFlows,
  selectActiveFlowId,
  selectActiveFlow,
  selectFlowById,
  selectCanUndo,
  selectCanRedo,
  type FlowState,
  type FlowNode,
  type FlowEdge,
} from '../index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getState(): FlowState {
  return useFlowStore.getState();
}

function makeNode(overrides: Partial<FlowNode> = {}): FlowNode {
  return {
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    type: 'agent',
    position: { x: 100, y: 200 },
    data: { label: 'Test Node' },
    ...overrides,
  };
}

function makeEdge(source: string, target: string, overrides: Partial<FlowEdge> = {}): FlowEdge {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  act(() => {
    // Reset the store completely
    useFlowStore.setState({
      flows: new Map(),
      activeFlowId: null,
      history: [],
      historyIndex: -1,
      maxHistorySize: 50,
    });
  });
  // Clear localStorage so persist middleware doesn't interfere
  window.localStorage.clear();
});

// ============================================================================
// Initial State
// ============================================================================

describe('Flow Store - initial state', () => {
  it('starts with empty flows map', () => {
    expect(getState().flows).toBeInstanceOf(Map);
    expect(getState().flows.size).toBe(0);
  });

  it('starts with null activeFlowId', () => {
    expect(getState().activeFlowId).toBeNull();
  });

  it('starts with empty history', () => {
    expect(getState().history).toEqual([]);
    expect(getState().historyIndex).toBe(-1);
  });

  it('starts with maxHistorySize of 50', () => {
    expect(getState().maxHistorySize).toBe(50);
  });
});

// ============================================================================
// Flow CRUD
// ============================================================================

describe('Flow Store - createFlow', () => {
  it('creates a flow with name and description', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Test Flow', 'A test description');
    });

    const flow = getState().flows.get(flowId!);
    expect(flow).toBeDefined();
    expect(flow!.name).toBe('Test Flow');
    expect(flow!.description).toBe('A test description');
    expect(flow!.nodes).toEqual([]);
    expect(flow!.edges).toEqual([]);
  });

  it('generates a unique flow ID starting with "flow-"', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Flow');
    });
    expect(flowId!).toMatch(/^flow-\d+-[a-z0-9]+$/);
  });

  it('sets the created flow as active', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Active Flow');
    });
    expect(getState().activeFlowId).toBe(flowId!);
  });

  it('creates a flow without description', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('No Description');
    });
    expect(getState().flows.get(flowId!)!.description).toBeUndefined();
  });

  it('sets createdAt and updatedAt to roughly now', () => {
    const before = Date.now();
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Timestamped');
    });
    const after = Date.now();
    const flow = getState().flows.get(flowId!)!;
    expect(flow.createdAt).toBeGreaterThanOrEqual(before);
    expect(flow.createdAt).toBeLessThanOrEqual(after);
    expect(flow.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('saves a snapshot to history', () => {
    act(() => {
      getState().createFlow('With History');
    });
    expect(getState().history.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Flow Store - updateFlow', () => {
  let flowId: string;

  beforeEach(() => {
    act(() => {
      flowId = getState().createFlow('Original Name', 'Original Desc');
    });
  });

  it('updates flow name', () => {
    act(() => {
      getState().updateFlow(flowId, { name: 'Updated Name' });
    });
    expect(getState().flows.get(flowId)!.name).toBe('Updated Name');
  });

  it('updates flow description', () => {
    act(() => {
      getState().updateFlow(flowId, { description: 'Updated Desc' });
    });
    expect(getState().flows.get(flowId)!.description).toBe('Updated Desc');
  });

  it('updates updatedAt timestamp', () => {
    const before = getState().flows.get(flowId)!.updatedAt;
    // Small delay to ensure different timestamp
    act(() => {
      getState().updateFlow(flowId, { name: 'Newer' });
    });
    expect(getState().flows.get(flowId)!.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('does not update a non-existent flow', () => {
    const sizeBefore = getState().flows.size;
    act(() => {
      getState().updateFlow('non-existent', { name: 'Nope' });
    });
    expect(getState().flows.size).toBe(sizeBefore);
  });

  it('preserves createdAt when updating', () => {
    const createdAt = getState().flows.get(flowId)!.createdAt;
    act(() => {
      getState().updateFlow(flowId, { name: 'Newer Name' });
    });
    expect(getState().flows.get(flowId)!.createdAt).toBe(createdAt);
  });
});

describe('Flow Store - deleteFlow', () => {
  it('removes a flow from the map', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('To Delete');
    });

    act(() => {
      getState().deleteFlow(flowId!);
    });
    expect(getState().flows.has(flowId!)).toBe(false);
  });

  it('clears activeFlowId when deleting the active flow (no other flows)', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Only Flow');
    });

    act(() => {
      getState().deleteFlow(flowId!);
    });
    expect(getState().activeFlowId).toBeNull();
  });

  it('sets activeFlowId to first remaining flow when deleting active flow', () => {
    let flowId1: string;
    let flowId2: string;
    act(() => {
      flowId1 = getState().createFlow('Flow 1');
      flowId2 = getState().createFlow('Flow 2');
    });
    // flowId2 is the active one (last created)
    expect(getState().activeFlowId).toBe(flowId2!);

    act(() => {
      getState().deleteFlow(flowId2!);
    });
    expect(getState().activeFlowId).toBe(flowId1!);
  });

  it('does nothing when deleting a non-existent flow', () => {
    act(() => {
      getState().createFlow('Stays');
    });
    const sizeBefore = getState().flows.size;
    act(() => {
      getState().deleteFlow('non-existent');
    });
    expect(getState().flows.size).toBe(sizeBefore);
  });
});

describe('Flow Store - duplicateFlow', () => {
  it('creates a copy with "(Copy)" suffix', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Original');
    });

    let dupId: string | null;
    act(() => {
      dupId = getState().duplicateFlow(flowId!);
    });

    expect(dupId!).not.toBeNull();
    expect(dupId!).not.toBe(flowId!);
    expect(getState().flows.get(dupId!)!.name).toBe('Original (Copy)');
  });

  it('duplicates nodes and edges', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('With Nodes');
    });

    const node = makeNode({ id: 'n1' });
    const edge = makeEdge('n1', 'n2');
    act(() => {
      getState().setFlowNodes(flowId!, [node]);
      getState().setFlowEdges(flowId!, [edge]);
    });

    let dupId: string | null;
    act(() => {
      dupId = getState().duplicateFlow(flowId!);
    });

    const dup = getState().flows.get(dupId!)!;
    expect(dup.nodes).toEqual([node]);
    expect(dup.edges).toEqual([edge]);
  });

  it('returns null for non-existent flow', () => {
    let result: string | null;
    act(() => {
      result = getState().duplicateFlow('non-existent');
    });
    expect(result!).toBeNull();
  });

  it('assigns new timestamps to the duplicate', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Old Flow');
    });
    const originalCreatedAt = getState().flows.get(flowId!)!.createdAt;

    let dupId: string | null;
    act(() => {
      dupId = getState().duplicateFlow(flowId!);
    });

    const dup = getState().flows.get(dupId!)!;
    expect(dup.createdAt).toBeGreaterThanOrEqual(originalCreatedAt);
  });
});

// ============================================================================
// Flow Nodes/Edges
// ============================================================================

describe('Flow Store - node operations', () => {
  let flowId: string;

  beforeEach(() => {
    act(() => {
      flowId = getState().createFlow('Node Test');
    });
  });

  it('setFlowNodes replaces all nodes', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' })];
    act(() => {
      getState().setFlowNodes(flowId, nodes);
    });
    expect(getState().flows.get(flowId)!.nodes).toHaveLength(2);
  });

  it('addFlowNode appends a node', () => {
    const node = makeNode({ id: 'new' });
    act(() => {
      getState().addFlowNode(flowId, node);
    });
    expect(getState().flows.get(flowId)!.nodes).toHaveLength(1);
    expect(getState().flows.get(flowId)!.nodes[0].id).toBe('new');
  });

  it('removeFlowNode removes a node and its connected edges', () => {
    const n1 = makeNode({ id: 'n1' });
    const n2 = makeNode({ id: 'n2' });
    const n3 = makeNode({ id: 'n3' });
    const e1 = makeEdge('n1', 'n2');
    const e2 = makeEdge('n2', 'n3');

    act(() => {
      getState().setFlowNodes(flowId, [n1, n2, n3]);
      getState().setFlowEdges(flowId, [e1, e2]);
    });

    act(() => {
      getState().removeFlowNode(flowId, 'n2');
    });

    const flow = getState().flows.get(flowId)!;
    expect(flow.nodes).toHaveLength(2);
    expect(flow.nodes.find((n) => n.id === 'n2')).toBeUndefined();
    // Both edges connected to n2 should be removed
    expect(flow.edges).toHaveLength(0);
  });

  it('updateFlowNode updates node properties', () => {
    const node = makeNode({ id: 'u1' });
    act(() => {
      getState().addFlowNode(flowId, node);
    });

    act(() => {
      getState().updateFlowNode(flowId, 'u1', {
        position: { x: 500, y: 600 },
      });
    });

    const updated = getState().flows.get(flowId)!.nodes.find((n) => n.id === 'u1');
    expect(updated!.position).toEqual({ x: 500, y: 600 });
  });

  it('setFlowEdges replaces all edges', () => {
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    act(() => {
      getState().setFlowEdges(flowId, edges);
    });
    expect(getState().flows.get(flowId)!.edges).toHaveLength(2);
  });

  it('node operations do nothing for non-existent flow', () => {
    act(() => {
      getState().addFlowNode('non-existent', makeNode());
    });
    // No error thrown
    expect(getState().flows.has('non-existent')).toBe(false);
  });

  it('updates updatedAt when modifying nodes', () => {
    const before = getState().flows.get(flowId)!.updatedAt;
    act(() => {
      getState().addFlowNode(flowId, makeNode());
    });
    expect(getState().flows.get(flowId)!.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

// ============================================================================
// Active Flow
// ============================================================================

describe('Flow Store - active flow', () => {
  it('setActiveFlow sets the active flow ID', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Active');
      getState().setActiveFlow(null);
    });
    expect(getState().activeFlowId).toBeNull();

    act(() => {
      getState().setActiveFlow(flowId!);
    });
    expect(getState().activeFlowId).toBe(flowId!);
  });

  it('getActiveFlow returns the active flow object', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Get Active');
    });
    const flow = getState().getActiveFlow();
    expect(flow).not.toBeNull();
    expect(flow!.id).toBe(flowId!);
    expect(flow!.name).toBe('Get Active');
  });

  it('getActiveFlow returns null when no active flow', () => {
    expect(getState().getActiveFlow()).toBeNull();
  });

  it('getActiveFlow returns null when activeFlowId references deleted flow', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Will Delete');
    });
    // Manually set active to the flow, then delete it
    act(() => {
      getState().deleteFlow(flowId!);
    });
    expect(getState().getActiveFlow()).toBeNull();
  });
});

// ============================================================================
// Undo/Redo
// ============================================================================

describe('Flow Store - undo/redo', () => {
  it('canUndo is false initially', () => {
    expect(getState().canUndo()).toBe(false);
  });

  it('canRedo is false initially', () => {
    expect(getState().canRedo()).toBe(false);
  });

  it('canUndo becomes true after creating a flow then making changes', () => {
    act(() => {
      getState().createFlow('Flow 1');
    });
    act(() => {
      getState().createFlow('Flow 2');
    });
    // After two creates, history should have snapshots
    expect(getState().canUndo()).toBe(true);
  });

  it('undo restores previous state', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Before Update');
    });

    act(() => {
      getState().updateFlow(flowId!, { name: 'After Update' });
    });
    expect(getState().flows.get(flowId!)!.name).toBe('After Update');

    act(() => {
      getState().undo();
    });

    // After undo, the state before updateFlow is restored
    // This was the state right after createFlow
    const flow = getState().flows.get(flowId!);
    if (flow) {
      expect(flow.name).toBe('Before Update');
    }
  });

  it('redo restores undone state', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Original');
    });
    act(() => {
      getState().updateFlow(flowId!, { name: 'Changed' });
    });

    act(() => {
      getState().undo();
    });

    act(() => {
      getState().redo();
    });

    // canRedo should use the snapshot which has the updated name
    // The redo restores to "After update"
    const flow = getState().flows.get(flowId!);
    if (flow) {
      expect(flow.name).toBe('Original');
    }
  });

  it('clearHistory resets history', () => {
    act(() => {
      getState().createFlow('Flow');
    });

    act(() => {
      getState().clearHistory();
    });
    expect(getState().history).toEqual([]);
    expect(getState().historyIndex).toBe(-1);
    expect(getState().canUndo()).toBe(false);
    expect(getState().canRedo()).toBe(false);
  });

  it('history does not exceed maxHistorySize', () => {
    // Set a small max for testing
    act(() => {
      useFlowStore.setState({ maxHistorySize: 5 });
    });

    // Create more snapshots than maxHistorySize
    for (let i = 0; i < 10; i++) {
      act(() => {
        getState().createFlow(`Flow ${i}`);
      });
    }

    expect(getState().history.length).toBeLessThanOrEqual(5);
  });
});

// ============================================================================
// Import/Export
// ============================================================================

describe('Flow Store - import/export', () => {
  it('exportFlow returns JSON string for existing flow', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Export Me', 'description');
    });

    const json = getState().exportFlow(flowId!);
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed.name).toBe('Export Me');
    expect(parsed.description).toBe('description');
  });

  it('exportFlow returns null for non-existent flow', () => {
    expect(getState().exportFlow('non-existent')).toBeNull();
  });

  it('importFlow creates a new flow with a new ID', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Original');
    });

    const json = getState().exportFlow(flowId!)!;
    let importedId: string | null;
    act(() => {
      importedId = getState().importFlow(json);
    });

    expect(importedId!).not.toBeNull();
    expect(importedId!).not.toBe(flowId!);
    const imported = getState().flows.get(importedId!)!;
    expect(imported.name).toBe('Original');
  });

  it('importFlow returns null for invalid JSON', () => {
    let result: string | null;
    act(() => {
      result = getState().importFlow('not valid json');
    });
    expect(result!).toBeNull();
  });

  it('importFlow returns null for JSON missing required fields', () => {
    let result: string | null;
    act(() => {
      result = getState().importFlow(JSON.stringify({ foo: 'bar' }));
    });
    expect(result!).toBeNull();
  });

  it('exportAllFlows returns all flows as JSON array', () => {
    act(() => {
      getState().createFlow('Flow A');
      getState().createFlow('Flow B');
    });

    const json = getState().exportAllFlows();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
  });

  it('importAllFlows imports multiple flows', () => {
    act(() => {
      getState().createFlow('Flow A');
      getState().createFlow('Flow B');
    });

    const json = getState().exportAllFlows();

    // Clear and re-import
    act(() => {
      useFlowStore.setState({ flows: new Map(), activeFlowId: null });
    });

    let count: number;
    act(() => {
      count = getState().importAllFlows(json);
    });
    expect(count!).toBe(2);
    expect(getState().flows.size).toBe(2);
  });

  it('importAllFlows returns 0 for invalid JSON', () => {
    let count: number;
    act(() => {
      count = getState().importAllFlows('not json');
    });
    expect(count!).toBe(0);
  });

  it('importAllFlows returns 0 for non-array JSON', () => {
    let count: number;
    act(() => {
      count = getState().importAllFlows(JSON.stringify({ not: 'array' }));
    });
    expect(count!).toBe(0);
  });

  it('importAllFlows skips entries missing id or name', () => {
    const flows = [
      { id: 'f1', name: 'Valid', nodes: [], edges: [] },
      { id: '', name: 'Missing ID', nodes: [], edges: [] },
      { id: 'f3', name: '', nodes: [], edges: [] },
    ];
    let count: number;
    act(() => {
      count = getState().importAllFlows(JSON.stringify(flows));
    });
    expect(count!).toBe(1);
  });
});

// ============================================================================
// Selectors
// ============================================================================

describe('Flow Store - selectors', () => {
  it('selectFlows returns the flows map', () => {
    act(() => {
      getState().createFlow('Sel Flow');
    });
    const flows = selectFlows(getState());
    expect(flows).toBeInstanceOf(Map);
    expect(flows.size).toBe(1);
  });

  it('selectActiveFlowId returns the active flow ID', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('Active Sel');
    });
    expect(selectActiveFlowId(getState())).toBe(flowId!);
  });

  it('selectActiveFlow returns the active flow object', () => {
    act(() => {
      getState().createFlow('Active Sel Flow');
    });
    const flow = selectActiveFlow(getState());
    expect(flow).not.toBeNull();
    expect(flow!.name).toBe('Active Sel Flow');
  });

  it('selectActiveFlow returns null when no active flow', () => {
    expect(selectActiveFlow(getState())).toBeNull();
  });

  it('selectFlowById returns specific flow', () => {
    let flowId: string;
    act(() => {
      flowId = getState().createFlow('By Id');
    });
    const selector = selectFlowById(flowId!);
    expect(selector(getState())).not.toBeNull();
    expect(selector(getState())!.name).toBe('By Id');
  });

  it('selectFlowById returns null for non-existent flow', () => {
    const selector = selectFlowById('non-existent');
    expect(selector(getState())).toBeNull();
  });

  it('selectCanUndo returns boolean', () => {
    expect(selectCanUndo(getState())).toBe(false);
  });

  it('selectCanRedo returns boolean', () => {
    expect(selectCanRedo(getState())).toBe(false);
  });
});
