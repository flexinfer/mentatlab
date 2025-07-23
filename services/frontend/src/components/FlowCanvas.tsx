import React, { useCallback, useState, useEffect } from 'react';
import ReactFlow, { Controls, Background, MiniMap, applyNodeChanges, applyEdgeChanges, Node, Edge, NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import { loadFlow } from '../loadFlow';
import { Node as GraphNode, Edge as GraphEdge } from '../types/graph';

const CustomNode: React.FC<NodeProps> = ({ id, type, data }) => {
  return (
    <div style={{ border: '1px solid black', padding: 10, background: 'white' }}>
      <div>ID: {id}</div>
      <div>Type: {type}</div>
      {data.label && <div>Label: {data.label}</div>}
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
  input: CustomNode,
  default: CustomNode,
  output: CustomNode,
};

const FlowCanvas: React.FC = () => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const fetchFlow = async () => {
      try {
        const flowData = await loadFlow("example-flow"); // Use the hardcoded flow
        const reactFlowNodes: Node[] = flowData.graph.nodes.map((node: GraphNode) => ({
          id: node.id,
          type: node.type,
          position: { x: node.position.x || 0, y: node.position.y || 0 },
          data: { label: node.params?.label || node.id },
        }));

        const reactFlowEdges: Edge[] = flowData.graph.edges.map((edge: GraphEdge) => ({
          id: `e-${edge.from}-${edge.to}`,
          source: edge.from,
          target: edge.to,
        }));

        setNodes(reactFlowNodes);
        setEdges(reactFlowEdges);
      } catch (error) {
        console.error("Failed to load flow:", error);
      }
    };

    fetchFlow();
  }, []);

  const onNodesChange = useCallback(
    (changes: any) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes: any) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
      >
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
    </div>
  );
};

export default FlowCanvas;