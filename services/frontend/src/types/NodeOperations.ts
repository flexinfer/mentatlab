import { Node, Position } from './graph';

export type NodeType = string;

export interface NodeOperations {
  createNode: (type: NodeType, position: Position) => void;
  duplicateNode: (nodeId: string) => void;
  deleteNodes: (nodeIds: string[]) => void;
}