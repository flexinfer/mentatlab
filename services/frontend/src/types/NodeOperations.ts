import { Node, Position } from './graph';

export type NodeType = string;
export type NodeData = Record<string, unknown>;

export interface NodeOperations {
  createNode: (type: NodeType, position: Position, data?: NodeData) => void;
  duplicateNode: (nodeId: string) => void;
  deleteNodes: (nodeIds: string[]) => void;
}
