import { Edge, ApiEdge, Flow, Node } from '../types/graph';

/**
 * Transform frontend Edge to backend ApiEdge format
 * Frontend: { from: "nodeA", to: "nodeB" }
 * Backend: { from_node: "nodeA.output", to_node: "nodeB.input" }
 */
export const transformEdgeToApi = (edge: Edge): ApiEdge => {
  // For now, use default pin names if not specified
  const fromPin = edge.sourceHandle || 'output';
  const toPin = edge.targetHandle || 'input';
  
  return {
    from_node: `${edge.from}.${fromPin}`,
    to_node: `${edge.to}.${toPin}`,
  };
};

/**
 * Transform backend ApiEdge to frontend Edge format
 */
export const transformEdgeFromApi = (apiEdge: ApiEdge): Edge => {
  // Extract node IDs from the pin notation
  const [fromNode, sourceHandle] = apiEdge.from_node.split('.');
  const [toNode, targetHandle] = apiEdge.to_node.split('.');
  
  return {
    from: fromNode,
    to: toNode,
    sourceHandle,
    targetHandle,
  };
};

/**
 * Transform entire Flow for API submission
 */
export const transformFlowForApi = (flow: Flow) => {
  return {
    ...flow,
    graph: {
      ...flow.graph,
      edges: flow.graph.edges.map(transformEdgeToApi),
    },
  };
};

/**
 * Transform Flow from API response
 */
export const transformFlowFromApi = (apiFlow: any): Flow => {
  return {
    ...apiFlow,
    graph: {
      ...apiFlow.graph,
      edges: apiFlow.graph.edges.map(transformEdgeFromApi),
    },
  };
};

/**
 * Validate edge pin notation format
 */
export const validatePinNotation = (pinNotation: string): boolean => {
  const pinPattern = /^[^.]+\.[^.]+$/;
  return pinPattern.test(pinNotation);
};

/**
 * Generate ReactFlow-compatible edge ID
 */
export const generateEdgeId = (edge: Edge): string => {
  return `e-${edge.from}-${edge.to}`;
};

/**
 * Ensure Position has required x,y coordinates
 */
export const ensureValidPosition = (position: { x?: number; y?: number }) => {
  return {
    x: position.x ?? 0,
    y: position.y ?? 0,
  };
};

/**
 * Validate and sanitize Node data
 */
export const validateNode = (node: Partial<Node>): Node => {
  if (!node.id || !node.type) {
    throw new Error('Node must have id and type');
  }

  return {
    id: node.id,
    type: node.type,
    position: ensureValidPosition(node.position || {}),
    outputs: node.outputs || {},
    params: node.params || {},
  };
};

/**
 * Type guard for Edge
 */
export const isValidEdge = (edge: any): edge is Edge => {
  return (
    typeof edge === 'object' &&
    edge !== null &&
    typeof edge.from === 'string' &&
    typeof edge.to === 'string'
  );
};

/**
 * Type guard for ApiEdge
 */
export const isValidApiEdge = (edge: any): edge is ApiEdge => {
  return (
    typeof edge === 'object' &&
    edge !== null &&
    typeof edge.from_node === 'string' &&
    typeof edge.to_node === 'string' &&
    validatePinNotation(edge.from_node) &&
    validatePinNotation(edge.to_node)
  );
};