import React, { useCallback, useState, useEffect } from 'react';
import ReactFlow, { Controls, Background, MiniMap, applyNodeChanges, applyEdgeChanges, Node, Edge, NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import { loadFlow } from '../loadFlow';
import { Node as GraphNode, Edge as GraphEdge } from '../types/graph';

interface CustomNodeData {
  label: string;
  status?: 'running' | 'completed' | 'failed';
}

const CustomNode: React.FC<NodeProps<CustomNodeData>> = ({ id, type, data }) => {
  let backgroundColor = 'white';
  if (data.status === 'running') {
    backgroundColor = 'yellow';
  } else if (data.status === 'completed') {
    backgroundColor = 'lightgreen';
  } else if (data.status === 'failed') {
    backgroundColor = 'red';
  }

  return (
    <div style={{ border: '1px solid black', padding: 10, background: backgroundColor }}>
      <div>ID: {id}</div>
      <div>Type: {type}</div>
      {data.label && <div>Label: {data.label}</div>}
      {data.status && <div>Status: {data.status}</div>}
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
  const [nodes, setNodes] = useState<Node<CustomNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    const fetchFlow = async () => {
      try {
        const flowData = await loadFlow("example-flow");
        const reactFlowNodes: Node<CustomNodeData>[] = flowData.graph.nodes.map((node: GraphNode) => ({
          id: node.id,
          type: node.type,
          position: { x: node.position.x || 0, y: node.position.y || 0 },
          data: { label: (node.params?.label as string) || node.id, status: undefined },
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

  useEffect(() => {
    const websocket = new WebSocket("ws://localhost:8000/ws/orchestrator-events");

    websocket.onopen = () => {
      console.log("WebSocket connection established.");
    };

    websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log("Received WebSocket message:", message);

      setNodes((prevNodes) =>
        prevNodes.map((node) => {
          if (node.id === message.payload.node_id) {
            return {
              ...node,
              data: {
                ...node.data,
                status: message.event_type.toLowerCase().replace('node_', '') as 'running' | 'completed' | 'failed',
              },
            };
          }
          return node;
        })
      );
    };

    websocket.onclose = (event) => {
      console.log("WebSocket connection closed:", event);
    };

    websocket.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    return () => {
      websocket.close();
    };
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