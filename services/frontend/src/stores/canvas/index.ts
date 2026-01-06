/**
 * Canvas Store - ReactFlow state management
 *
 * Manages all canvas-related state:
 * - Nodes and edges
 * - Selection state
 * - Clipboard operations (copy/paste/duplicate)
 * - Context menu
 * - Node operations (create, delete, update)
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from 'reactflow';
import { v4 as uuidv4 } from 'uuid';
import type { Position } from '@/types/graph';
import type { NodeType } from '@/types/NodeOperations';
import type { WorkflowChange } from '@/types/collaboration';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ClipboardState {
  nodes: Node[];
  edges: Edge[];
}

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  nodeId: string | null;
}

export interface CanvasState {
  // Core ReactFlow state
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;

  // Clipboard for copy/paste
  clipboard: ClipboardState | null;

  // Context menu
  contextMenu: ContextMenuState;

  // ReactFlow handlers
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // Node operations
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  updateNodes: (updater: (nodes: Node[]) => Node[]) => void;
  addNode: (node: Node) => void;
  createNode: (type: NodeType, position: Position) => void;
  duplicateNode: (nodeId: string) => void;
  deleteNodes: (nodeIds: string[]) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  updateNodeConfig: (nodeId: string, data: object) => void;
  applyWorkflowChanges: (changes: WorkflowChange[]) => void;

  // Clipboard operations
  copySelected: () => number;
  pasteClipboard: () => number;
  duplicateSelected: () => number;
  deleteSelected: () => number;
  selectAll: () => void;
  deselectAll: () => void;
  nudgeSelected: (dx: number, dy: number) => void;

  // Context menu operations
  openContextMenu: (position: { x: number; y: number }, nodeId: string) => void;
  closeContextMenu: () => void;

  // Bulk operations
  clearCanvas: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useCanvasStore = create<CanvasState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      // Initial state
      nodes: [],
      edges: [],
      selectedNodeId: null,
      clipboard: null,
      contextMenu: { isOpen: false, position: { x: 0, y: 0 }, nodeId: null },

      // ─────────────────────────────────────────────────────────────────────
      // ReactFlow handlers
      // ─────────────────────────────────────────────────────────────────────

      onNodesChange: (changes: NodeChange[]) => {
        set((state) => ({
          nodes: applyNodeChanges(changes, state.nodes),
        }));
      },

      onEdgesChange: (changes: EdgeChange[]) => {
        set((state) => ({
          edges: applyEdgeChanges(changes, state.edges),
        }));
      },

      onConnect: (connection: Connection) => {
        set((state) => ({
          edges: addEdge(connection, state.edges),
        }));
      },

      // ─────────────────────────────────────────────────────────────────────
      // Node operations
      // ─────────────────────────────────────────────────────────────────────

      setNodes: (nodes: Node[]) => set({ nodes }),

      setEdges: (edges: Edge[]) => set({ edges }),

      updateNodes: (updater: (nodes: Node[]) => Node[]) => {
        set((state) => ({
          nodes: updater(state.nodes),
        }));
      },

      addNode: (node: Node) => {
        set((state) => ({
          nodes: [...state.nodes, node],
        }));
      },

      createNode: (type: NodeType, position: Position) => {
        const newNode: Node = {
          id: uuidv4(),
          type,
          position,
          data: { label: `${type} Node` },
        };
        set((state) => ({
          nodes: [...state.nodes, newNode],
        }));
      },

      duplicateNode: (nodeId: string) => {
        set((state) => {
          const nodeToDuplicate = state.nodes.find((node) => node.id === nodeId);
          if (!nodeToDuplicate) {
            return state;
          }
          const duplicatedNode: Node = {
            ...nodeToDuplicate,
            id: uuidv4(),
            position: {
              x: nodeToDuplicate.position.x + 50,
              y: nodeToDuplicate.position.y + 50,
            },
          };
          return {
            nodes: [...state.nodes, duplicatedNode],
          };
        });
      },

      deleteNodes: (nodeIds: string[]) => {
        set((state) => {
          const remainingNodes = state.nodes.filter((node) => !nodeIds.includes(node.id));
          const remainingEdges = state.edges.filter(
            (edge) => !nodeIds.includes(edge.source) && !nodeIds.includes(edge.target)
          );
          const newSelectedNodeId = nodeIds.includes(state.selectedNodeId ?? '') ? null : state.selectedNodeId;

          return {
            nodes: remainingNodes,
            edges: remainingEdges,
            selectedNodeId: newSelectedNodeId,
          };
        });
      },

      setSelectedNodeId: (nodeId: string | null) => set({ selectedNodeId: nodeId }),

      updateNodeConfig: (nodeId: string, data: object) => {
        set((state) => ({
          nodes: state.nodes.map((node) =>
            node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
          ),
        }));
      },

      applyWorkflowChanges: (changes: WorkflowChange[]) => {
        set((state) => {
          let newNodes = [...state.nodes];
          let newEdges = [...state.edges];

          changes.forEach((change) => {
            if (change.type === 'add') {
              if ((change.payload as Node).position !== undefined) {
                newNodes.push(change.payload as Node);
              } else if ((change.payload as Edge).source !== undefined) {
                newEdges.push(change.payload as Edge);
              }
            } else if (change.type === 'remove') {
              const payload = change.payload as { id: string };
              newNodes = newNodes.filter((node) => node.id !== payload.id);
              newEdges = newEdges.filter(
                (edge) =>
                  edge.id !== payload.id &&
                  edge.source !== payload.id &&
                  edge.target !== payload.id
              );
            } else if (change.type === 'update') {
              const payload = change.payload as Partial<Node> & { id: string };
              newNodes = newNodes.map((node) =>
                node.id === payload.id ? { ...node, ...payload } : node
              );
            }
          });

          return { nodes: newNodes, edges: newEdges };
        });
      },

      // ─────────────────────────────────────────────────────────────────────
      // Clipboard operations
      // ─────────────────────────────────────────────────────────────────────

      copySelected: () => {
        const state = get();
        const selectedNodes = state.nodes.filter((node) => node.selected);
        if (selectedNodes.length === 0) return 0;

        const selectedIds = new Set(selectedNodes.map((n) => n.id));
        const internalEdges = state.edges.filter(
          (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)
        );

        set({ clipboard: { nodes: selectedNodes, edges: internalEdges } });
        return selectedNodes.length;
      },

      pasteClipboard: () => {
        const state = get();
        if (!state.clipboard || state.clipboard.nodes.length === 0) return 0;

        const idMap = new Map<string, string>();
        const newNodes = state.clipboard.nodes.map((node) => {
          const newId = uuidv4();
          idMap.set(node.id, newId);
          return {
            ...node,
            id: newId,
            position: {
              x: node.position.x + 50,
              y: node.position.y + 50,
            },
            selected: true,
            data: { ...node.data },
          };
        });

        const newEdges = state.clipboard.edges.map((edge) => ({
          ...edge,
          id: uuidv4(),
          source: idMap.get(edge.source) ?? edge.source,
          target: idMap.get(edge.target) ?? edge.target,
        }));

        const updatedNodes = state.nodes.map((n) => ({ ...n, selected: false }));

        set({
          nodes: [...updatedNodes, ...newNodes],
          edges: [...state.edges, ...newEdges],
        });

        return newNodes.length;
      },

      duplicateSelected: () => {
        const copied = get().copySelected();
        if (copied === 0) return 0;
        return get().pasteClipboard();
      },

      deleteSelected: () => {
        const state = get();
        const selectedNodes = state.nodes.filter((node) => node.selected);
        if (selectedNodes.length === 0) return 0;

        const selectedIds = new Set(selectedNodes.map((n) => n.id));
        const remainingNodes = state.nodes.filter((node) => !node.selected);
        const remainingEdges = state.edges.filter(
          (edge) => !selectedIds.has(edge.source) && !selectedIds.has(edge.target)
        );

        set({
          nodes: remainingNodes,
          edges: remainingEdges,
          selectedNodeId: null,
        });

        return selectedNodes.length;
      },

      selectAll: () => {
        set((state) => ({
          nodes: state.nodes.map((node) => ({ ...node, selected: true })),
        }));
      },

      deselectAll: () => {
        set((state) => ({
          nodes: state.nodes.map((node) => ({ ...node, selected: false })),
          selectedNodeId: null,
        }));
      },

      nudgeSelected: (dx, dy) => {
        set((state) => ({
          nodes: state.nodes.map((node) =>
            node.selected
              ? {
                  ...node,
                  position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                  },
                }
              : node
          ),
        }));
      },

      // ─────────────────────────────────────────────────────────────────────
      // Context menu operations
      // ─────────────────────────────────────────────────────────────────────

      openContextMenu: (position, nodeId) => {
        set({
          contextMenu: { isOpen: true, position, nodeId },
        });
      },

      closeContextMenu: () => {
        set({
          contextMenu: { isOpen: false, position: { x: 0, y: 0 }, nodeId: null },
        });
      },

      // ─────────────────────────────────────────────────────────────────────
      // Bulk operations
      // ─────────────────────────────────────────────────────────────────────

      clearCanvas: () => {
        set({
          nodes: [],
          edges: [],
          selectedNodeId: null,
          clipboard: null,
        });
      },
    })),
    { name: 'canvas-store' }
  )
);

// ─────────────────────────────────────────────────────────────────────────────
// Selectors (for optimized subscriptions)
// ─────────────────────────────────────────────────────────────────────────────

export const selectNodes = (state: CanvasState) => state.nodes;
export const selectEdges = (state: CanvasState) => state.edges;
export const selectSelectedNodeId = (state: CanvasState) => state.selectedNodeId;
export const selectSelectedNodes = (state: CanvasState) =>
  state.nodes.filter((node) => node.selected);
export const selectNodeById = (nodeId: string) => (state: CanvasState) =>
  state.nodes.find((node) => node.id === nodeId);

export default useCanvasStore;
