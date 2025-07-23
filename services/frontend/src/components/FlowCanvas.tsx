import React, { useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Controls,
  Background,
  MiniMap,
  Node,
  Edge,
  NodeProps,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { loadFlow } from '../loadFlow';
import { Node as GraphNode, Edge as GraphEdge } from '../types/graph';
import useStore from '../store'; // Import the Zustand store

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

const FlowCanvas: React.FC = () => { // Removed onNodeSelect prop
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // Fetch state and actions from the Zustand store
  const nodes = useStore((state) => state.nodes);
  const edges = useStore((state) => state.edges);
  const onNodesChange = useStore((state) => state.onNodesChange);
  const onEdgesChange = useStore((state) => state.onEdgesChange);
  const onConnect = useStore((state) => state.onConnect);
  const addNode = useStore((state) => state.addNode);
  const setSelectedNodeId = useStore((state) => state.setSelectedNodeId);
  const setNodes = useStore((state) => state.setNodes); // Get setNodes from store
  const setEdges = useStore((state) => state.setEdges); // Get setEdges from store


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

        setNodes(reactFlowNodes); // Use setNodes from store
        setEdges(reactFlowEdges); // Use setEdges from store
      } catch (error) {
        console.error("Failed to load flow:", error);
      }
    };

    fetchFlow();
  }, [setNodes, setEdges]); // Add setNodes and setEdges to dependency array

  useEffect(() => {
    const websocket = new WebSocket("ws://localhost:8000/ws/orchestrator-events");

    websocket.onopen = () => {
      console.log("WebSocket connection established.");
    };

    websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log("Received WebSocket message:", message);

      setNodes(
        nodes.map((node) => {
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
  }, [setNodes]); // Add setNodes to dependency array

  const onSelectionChange = useCallback(
    ({ nodes }: { nodes: Node[] }) => {
      if (nodes.length > 0) {
        const selectedNode = nodes[0];
        setSelectedNodeId(selectedNode.id); // Use setSelectedNodeId from store
      } else {
        setSelectedNodeId(null); // Use setSelectedNodeId from store
      }
    },
    [setSelectedNodeId] // Add setSelectedNodeId to dependency array
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      const agentData = JSON.parse(event.dataTransfer.getData('agent'));

      if (typeof type === 'undefined' || !type) {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node<CustomNodeData> = {
        id: `${agentData.id}-${Math.random().toString(36).substring(7)}`, // Unique ID
        type,
        position,
        data: { label: agentData.name, status: undefined },
      };

      addNode(newNode); // Use addNode from store
    },
    [screenToFlowPosition, addNode] // Add addNode to dependency array
  );

  return (
    <div className="reactflow-wrapper h-full w-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onSelectionChange={onSelectionChange}
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