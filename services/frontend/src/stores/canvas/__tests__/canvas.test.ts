import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import type { Node, Edge } from 'reactflow';
import { useCanvasStore } from '../index';

// ---------------------------------------------------------------------------
// Mock uuid so we get deterministic IDs in tests
// ---------------------------------------------------------------------------
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getState() {
  return useCanvasStore.getState();
}

function makeNode(overrides: Partial<Node> = {}): Node {
  return {
    id: `node-${Math.random().toString(36).slice(2, 8)}`,
    type: 'default',
    position: { x: 100, y: 200 },
    data: { label: 'Test Node' },
    ...overrides,
  };
}

function makeEdge(source: string, target: string, overrides: Partial<Edge> = {}): Edge {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset before every test
// ---------------------------------------------------------------------------
beforeEach(() => {
  uuidCounter = 0;
  act(() => {
    getState().clearCanvas();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Initial State
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - initial state', () => {
  it('starts with empty nodes and edges', () => {
    expect(getState().nodes).toEqual([]);
    expect(getState().edges).toEqual([]);
  });

  it('starts with null selectedNodeId', () => {
    expect(getState().selectedNodeId).toBeNull();
  });

  it('starts with null clipboard', () => {
    expect(getState().clipboard).toBeNull();
  });

  it('starts with closed context menu', () => {
    expect(getState().contextMenu).toEqual({
      isOpen: false,
      position: { x: 0, y: 0 },
      nodeId: null,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// setNodes / setEdges
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - setNodes / setEdges', () => {
  it('setNodes replaces nodes array', () => {
    const n1 = makeNode({ id: 'a' });
    const n2 = makeNode({ id: 'b' });

    act(() => { getState().setNodes([n1, n2]); });
    expect(getState().nodes).toHaveLength(2);
    expect(getState().nodes.map((n) => n.id)).toEqual(['a', 'b']);

    // Replace entirely
    const n3 = makeNode({ id: 'c' });
    act(() => { getState().setNodes([n3]); });
    expect(getState().nodes).toHaveLength(1);
    expect(getState().nodes[0]?.id).toBe('c');
  });

  it('setEdges replaces edges array', () => {
    const e1 = makeEdge('a', 'b');
    act(() => { getState().setEdges([e1]); });
    expect(getState().edges).toHaveLength(1);

    act(() => { getState().setEdges([]); });
    expect(getState().edges).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// addNode
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - addNode', () => {
  it('appends a node to the array', () => {
    const n1 = makeNode({ id: 'existing' });
    act(() => { getState().setNodes([n1]); });

    const n2 = makeNode({ id: 'new-node' });
    act(() => { getState().addNode(n2); });

    expect(getState().nodes).toHaveLength(2);
    expect(getState().nodes[1]?.id).toBe('new-node');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// createNode
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - createNode', () => {
  it('creates a node with uuid, type, position, and data', () => {
    act(() => { getState().createNode('agent', { x: 10, y: 20 }); });

    const nodes = getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.id).toBe('test-uuid-1');
    expect(nodes[0]?.type).toBe('agent');
    expect(nodes[0]?.position).toEqual({ x: 10, y: 20 });
    expect(nodes[0]?.data).toEqual({ label: 'agent Node' });
  });

  it('merges provided node data when creating a node', () => {
    act(() => {
      getState().createNode('mcp:k8s_apps_k3s__k8s_get', { x: 15, y: 30 }, {
        label: 'K8s Get',
        agent_id: 'loom-mcp-executor',
        tool_name: 'k8s_apps_k3s__k8s_get',
      });
    });

    const node = getState().nodes[0];
    expect(node?.data).toEqual({
      label: 'K8s Get',
      agent_id: 'loom-mcp-executor',
      tool_name: 'k8s_apps_k3s__k8s_get',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// deleteNodes
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - deleteNodes', () => {
  it('removes nodes and connected edges', () => {
    const n1 = makeNode({ id: 'a' });
    const n2 = makeNode({ id: 'b' });
    const n3 = makeNode({ id: 'c' });
    const e1 = makeEdge('a', 'b');
    const e2 = makeEdge('b', 'c');

    act(() => {
      getState().setNodes([n1, n2, n3]);
      getState().setEdges([e1, e2]);
    });

    act(() => { getState().deleteNodes(['b']); });

    expect(getState().nodes.map((n) => n.id)).toEqual(['a', 'c']);
    // Both edges touch node b, so both should be removed
    expect(getState().edges).toHaveLength(0);
  });

  it('clears selectedNodeId if the selected node is deleted', () => {
    const n1 = makeNode({ id: 'sel' });
    act(() => {
      getState().setNodes([n1]);
      getState().setSelectedNodeId('sel');
    });
    expect(getState().selectedNodeId).toBe('sel');

    act(() => { getState().deleteNodes(['sel']); });
    expect(getState().selectedNodeId).toBeNull();
  });

  it('preserves selectedNodeId if a different node is deleted', () => {
    const n1 = makeNode({ id: 'keep' });
    const n2 = makeNode({ id: 'remove' });
    act(() => {
      getState().setNodes([n1, n2]);
      getState().setSelectedNodeId('keep');
    });

    act(() => { getState().deleteNodes(['remove']); });
    expect(getState().selectedNodeId).toBe('keep');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// duplicateNode
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - duplicateNode', () => {
  it('copies a node with a new id and offset position', () => {
    const n1 = makeNode({ id: 'orig', position: { x: 100, y: 100 }, data: { label: 'Hello' } });
    act(() => { getState().setNodes([n1]); });

    act(() => { getState().duplicateNode('orig'); });

    const nodes = getState().nodes;
    expect(nodes).toHaveLength(2);
    const dup = nodes[1]!;
    expect(dup.id).not.toBe('orig');
    expect(dup.position).toEqual({ x: 150, y: 150 });
    expect(dup.data).toEqual({ label: 'Hello' });
  });

  it('does nothing if node does not exist', () => {
    act(() => { getState().duplicateNode('nonexistent'); });
    expect(getState().nodes).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// setSelectedNodeId
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - setSelectedNodeId', () => {
  it('updates selection', () => {
    act(() => { getState().setSelectedNodeId('abc'); });
    expect(getState().selectedNodeId).toBe('abc');
  });

  it('sets to null', () => {
    act(() => { getState().setSelectedNodeId('abc'); });
    act(() => { getState().setSelectedNodeId(null); });
    expect(getState().selectedNodeId).toBeNull();
  });

  it('ignores unchanged selection updates', () => {
    const updates: Array<string | null> = [];
    const unsubscribe = useCanvasStore.subscribe((state) => state.selectedNodeId, (nodeId) => {
      updates.push(nodeId);
    });

    try {
      act(() => { getState().setSelectedNodeId('abc'); });
      act(() => { getState().setSelectedNodeId('abc'); });
      act(() => { getState().setSelectedNodeId(null); });
      act(() => { getState().setSelectedNodeId(null); });
    } finally {
      unsubscribe();
    }

    expect(updates).toEqual(['abc', null]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// updateNodeConfig
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - updateNodeConfig', () => {
  it('merges data into existing node', () => {
    const n1 = makeNode({ id: 'x', data: { label: 'Old', color: 'red' } });
    act(() => { getState().setNodes([n1]); });

    act(() => { getState().updateNodeConfig('x', { color: 'blue', extra: true }); });

    const updated = getState().nodes[0]!;
    expect(updated.data).toEqual({ label: 'Old', color: 'blue', extra: true });
  });

  it('does not affect other nodes', () => {
    const n1 = makeNode({ id: 'a', data: { v: 1 } });
    const n2 = makeNode({ id: 'b', data: { v: 2 } });
    act(() => { getState().setNodes([n1, n2]); });

    act(() => { getState().updateNodeConfig('a', { v: 99 }); });

    expect(getState().nodes[0]?.data.v).toBe(99);
    expect(getState().nodes[1]?.data.v).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Clipboard Operations
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - clipboard operations', () => {
  it('copySelected copies selected nodes and their internal edges to clipboard', () => {
    const n1 = makeNode({ id: 'a', selected: true });
    const n2 = makeNode({ id: 'b', selected: true });
    const n3 = makeNode({ id: 'c', selected: false });
    const e1 = makeEdge('a', 'b'); // internal to selection
    const e2 = makeEdge('a', 'c'); // crosses selection boundary

    act(() => {
      getState().setNodes([n1, n2, n3]);
      getState().setEdges([e1, e2]);
    });

    let count = 0;
    act(() => { count = getState().copySelected(); });

    expect(count).toBe(2);
    expect(getState().clipboard).not.toBeNull();
    expect(getState().clipboard!.nodes).toHaveLength(2);
    expect(getState().clipboard!.edges).toHaveLength(1); // only internal edge
    expect(getState().clipboard!.edges[0]?.source).toBe('a');
    expect(getState().clipboard!.edges[0]?.target).toBe('b');
  });

  it('copySelected returns 0 when nothing is selected', () => {
    const n1 = makeNode({ id: 'a', selected: false });
    act(() => { getState().setNodes([n1]); });

    let count = 0;
    act(() => { count = getState().copySelected(); });
    expect(count).toBe(0);
    expect(getState().clipboard).toBeNull();
  });

  it('pasteClipboard creates new nodes from clipboard with offset positions and new ids', () => {
    const n1 = makeNode({ id: 'a', position: { x: 0, y: 0 }, selected: true });
    const n2 = makeNode({ id: 'b', position: { x: 100, y: 100 }, selected: true });
    const e1 = makeEdge('a', 'b');

    act(() => {
      getState().setNodes([n1, n2]);
      getState().setEdges([e1]);
    });

    act(() => { getState().copySelected(); });

    let pastedCount = 0;
    act(() => { pastedCount = getState().pasteClipboard(); });

    expect(pastedCount).toBe(2);
    const nodes = getState().nodes;
    // Original 2 + 2 pasted
    expect(nodes).toHaveLength(4);

    // Pasted nodes have new ids and offset positions
    const pastedNodes = nodes.slice(2);
    expect(pastedNodes[0]?.id).not.toBe('a');
    expect(pastedNodes[0]?.position).toEqual({ x: 50, y: 50 });
    expect(pastedNodes[1]?.id).not.toBe('b');
    expect(pastedNodes[1]?.position).toEqual({ x: 150, y: 150 });

    // New edges reference the new node ids
    const edges = getState().edges;
    // Original edge + 1 pasted edge
    expect(edges).toHaveLength(2);
    const pastedEdge = edges[1]!;
    expect(pastedEdge.source).not.toBe('a');
    expect(pastedEdge.target).not.toBe('b');
  });

  it('pasteClipboard returns 0 when clipboard is empty', () => {
    let count = 0;
    act(() => { count = getState().pasteClipboard(); });
    expect(count).toBe(0);
  });

  it('duplicateSelected copies and pastes in one step', () => {
    const n1 = makeNode({ id: 'a', position: { x: 10, y: 10 }, selected: true });
    act(() => { getState().setNodes([n1]); });

    let count = 0;
    act(() => { count = getState().duplicateSelected(); });

    expect(count).toBe(1);
    expect(getState().nodes).toHaveLength(2);
  });

  it('duplicateSelected returns 0 with no selection', () => {
    const n1 = makeNode({ id: 'a', selected: false });
    act(() => { getState().setNodes([n1]); });

    let count = 0;
    act(() => { count = getState().duplicateSelected(); });
    expect(count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// deleteSelected
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - deleteSelected', () => {
  it('removes selected nodes and their edges', () => {
    const n1 = makeNode({ id: 'a', selected: true });
    const n2 = makeNode({ id: 'b', selected: false });
    const e1 = makeEdge('a', 'b');

    act(() => {
      getState().setNodes([n1, n2]);
      getState().setEdges([e1]);
    });

    let count = 0;
    act(() => { count = getState().deleteSelected(); });

    expect(count).toBe(1);
    expect(getState().nodes).toHaveLength(1);
    expect(getState().nodes[0]?.id).toBe('b');
    expect(getState().edges).toHaveLength(0);
    expect(getState().selectedNodeId).toBeNull();
  });

  it('returns 0 when nothing is selected', () => {
    const n1 = makeNode({ id: 'a', selected: false });
    act(() => { getState().setNodes([n1]); });

    let count = 0;
    act(() => { count = getState().deleteSelected(); });
    expect(count).toBe(0);
    expect(getState().nodes).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// selectAll / deselectAll
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - selectAll / deselectAll', () => {
  it('selectAll marks all nodes as selected', () => {
    const n1 = makeNode({ id: 'a', selected: false });
    const n2 = makeNode({ id: 'b', selected: false });
    act(() => { getState().setNodes([n1, n2]); });

    act(() => { getState().selectAll(); });
    expect(getState().nodes.every((n) => n.selected)).toBe(true);
  });

  it('deselectAll marks all nodes as not selected and clears selectedNodeId', () => {
    const n1 = makeNode({ id: 'a', selected: true });
    const n2 = makeNode({ id: 'b', selected: true });
    act(() => {
      getState().setNodes([n1, n2]);
      getState().setSelectedNodeId('a');
    });

    act(() => { getState().deselectAll(); });
    expect(getState().nodes.every((n) => !n.selected)).toBe(true);
    expect(getState().selectedNodeId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// nudgeSelected
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - nudgeSelected', () => {
  it('offsets positions of selected nodes', () => {
    const n1 = makeNode({ id: 'a', position: { x: 100, y: 200 }, selected: true });
    const n2 = makeNode({ id: 'b', position: { x: 50, y: 50 }, selected: false });
    act(() => { getState().setNodes([n1, n2]); });

    act(() => { getState().nudgeSelected(10, -5); });

    expect(getState().nodes[0]?.position).toEqual({ x: 110, y: 195 });
    // Unselected node is unchanged
    expect(getState().nodes[1]?.position).toEqual({ x: 50, y: 50 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Context Menu
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - context menu', () => {
  it('openContextMenu sets state', () => {
    act(() => { getState().openContextMenu({ x: 300, y: 400 }, 'node-1'); });

    expect(getState().contextMenu).toEqual({
      isOpen: true,
      position: { x: 300, y: 400 },
      nodeId: 'node-1',
    });
  });

  it('closeContextMenu resets state', () => {
    act(() => { getState().openContextMenu({ x: 300, y: 400 }, 'node-1'); });
    act(() => { getState().closeContextMenu(); });

    expect(getState().contextMenu).toEqual({
      isOpen: false,
      position: { x: 0, y: 0 },
      nodeId: null,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// clearCanvas
// ═══════════════════════════════════════════════════════════════════════════

describe('Canvas Store - clearCanvas', () => {
  it('resets everything', () => {
    const n1 = makeNode({ id: 'a', selected: true });
    const e1 = makeEdge('a', 'b');
    act(() => {
      getState().setNodes([n1]);
      getState().setEdges([e1]);
      getState().setSelectedNodeId('a');
      getState().copySelected();
    });

    // Verify state is populated
    expect(getState().nodes).toHaveLength(1);
    expect(getState().edges).toHaveLength(1);
    expect(getState().selectedNodeId).toBe('a');
    expect(getState().clipboard).not.toBeNull();

    act(() => { getState().clearCanvas(); });

    expect(getState().nodes).toEqual([]);
    expect(getState().edges).toEqual([]);
    expect(getState().selectedNodeId).toBeNull();
    expect(getState().clipboard).toBeNull();
  });
});
