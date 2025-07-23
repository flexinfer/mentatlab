import { create } from 'zustand';
import {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  addEdge,
  applyNodeChanges as onNodesChange,
  applyEdgeChanges as onEdgesChange,
} from 'reactflow';

export type RFState = {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
};

export const useFlowStore = create<RFState>((set, get) => ({
  nodes: [],
  edges: [],
  onNodesChange: (changes: NodeChange[]) => {
    set({
      nodes: onNodesChange(changes, get().nodes),
    });
  },
  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      edges: onEdgesChange(changes, get().edges),
    });
  },
  onConnect: (connection: Connection) => {
    set({
      edges: addEdge(connection, get().edges),
    });
  },
  setNodes: (nodes: Node[]) => {
    set({ nodes });
  },
  setEdges: (edges: Edge[]) => {
    set({ edges });
  },
}));

// TypeScript interfaces for the Flow payload
export interface IFlowPosition {
  x: number;
  y: number;
}

export interface IFlowNode {
  id: string;
  type: string;
  position: IFlowPosition;
  outputs?: { [key: string]: any };
  params?: { [key: string]: any };
}

export interface IFlowEdge {
  from: string;
  to: string;
}

export interface IFlowMeta {
  id: string;
  name: string;
  version: string;
  createdAt: string; // ISO 8601 string
  description?: string;
  createdBy?: string;
}

export interface IFlowGraph {
  nodes: IFlowNode[];
  edges: IFlowEdge[];
}

export interface IFlowLayout {
  zoom?: number;
  viewport?: IFlowPosition;
}

export interface IFlowRunConfig {
  maxTokens?: number;
  temperature?: number;
  secrets?: string[];
}

export interface IFlow {
  apiVersion: string;
  kind: "Flow";
  meta: IFlowMeta;
  graph: IFlowGraph;
  layout?: IFlowLayout;
  runConfig?: IFlowRunConfig;
}