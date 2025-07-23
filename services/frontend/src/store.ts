import { create } from 'zustand';
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
import { Node as GraphNode, Edge as GraphEdge, Position } from './types/graph';
import { NodeOperations, NodeType } from './types/NodeOperations';
import { WorkflowChange } from './types/collaboration';
import { v4 as uuidv4 } from 'uuid';

export type RFState = NodeOperations & {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  updateNodes: (updater: (nodes: Node[]) => Node[]) => void;
  addNode: (node: Node) => void; // This is the createNode from NodeOperations
  setSelectedNodeId: (nodeId: string | null) => void;
  updateNodeConfig: (nodeId: string, data: object) => void;
  applyWorkflowChanges: (changes: WorkflowChange[]) => void;
};

const useStore = create<RFState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
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
  setNodes: (nodes: Node[]) => set({ nodes }),
  setEdges: (edges: Edge[]) => set({ edges }),
  updateNodes: (updater: (nodes: Node[]) => Node[]) => {
    set((state) => ({
      nodes: updater(state.nodes),
    }));
  },
  // NodeOperations implementations
  createNode: (type: NodeType, position: Position) => {
    const newNode: Node = {
      id: uuidv4(),
      type,
      position,
      data: { label: `${type} Node` }, // Default label
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
      const newSelectedNodeId = nodeIds.includes(state.selectedNodeId || '') ? null : state.selectedNodeId;

      return {
        nodes: remainingNodes,
        edges: remainingEdges,
        selectedNodeId: newSelectedNodeId,
      };
    });
  },
  addNode: (node: Node) => { // Keeping this for compatibility with existing drag-and-drop
    set((state) => ({
      nodes: [...state.nodes, node],
    }));
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

      changes.forEach(change => {
        if (change.type === 'add') {
          if ((change.payload as Node).id) {
            newNodes.push(change.payload as Node);
          } else if ((change.payload as Edge).id) {
            newEdges.push(change.payload as Edge);
          }
        } else if (change.type === 'remove') {
          if ((change.payload as Node).id) {
            newNodes = newNodes.filter(node => node.id !== (change.payload as Node).id);
            newEdges = newEdges.filter(edge => edge.source !== (change.payload as Node).id && edge.target !== (change.payload as Node).id);
          } else if ((change.payload as Edge).id) {
            newEdges = newEdges.filter(edge => edge.id !== (change.payload as Edge).id);
          }
        } else if (change.type === 'update') {
          if ((change.payload as Node).id) {
            newNodes = newNodes.map(node =>
              node.id === (change.payload as Node).id ? { ...node, ...(change.payload as Node) } : node
            );
          } else if ((change.payload as Edge).id) {
            newEdges = newEdges.map(edge =>
              edge.id === (change.payload as Edge).id ? { ...edge, ...(change.payload as Edge) } : edge
            );
          }
        }
      });

      return { nodes: newNodes, edges: newEdges };
    });
  },
}));

export default useStore;