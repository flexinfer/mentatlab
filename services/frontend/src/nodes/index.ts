/**
 * Node type registry for MentatLab DAG canvas.
 *
 * Exports all custom node components and a nodeTypes map for ReactFlow.
 */

// Standard nodes
export { default as ChatNode } from './ChatNode';
export { default as PythonCodeNode } from './PythonCodeNode';

// Control flow nodes
export { default as ConditionalNode } from './ConditionalNode';
export type { ConditionalNodeData, ConditionalBranch } from './ConditionalNode';

export { default as ForEachNode } from './ForEachNode';
export type { ForEachNodeData } from './ForEachNode';

// Re-export node status type (shared across control flow nodes)
export type { NodeStatus } from './ConditionalNode';

/**
 * Node type constants for use in node creation.
 */
export const NODE_TYPES = {
  CHAT: 'chat',
  PYTHON_CODE: 'pythonCode',
  CONDITIONAL: 'conditional',
  FOR_EACH: 'forEach',
} as const;

export type NodeTypeName = typeof NODE_TYPES[keyof typeof NODE_TYPES];
