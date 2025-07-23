import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  Controls,
  Background,
  MiniMap,
  Node,
  Edge,
  NodeProps,
  useReactFlow,
  useStoreApi,
} from 'reactflow';
import 'reactflow/dist/style.css';
import DOMPurify from 'dompurify';
import { loadFlow } from '../loadFlow';
import { Node as GraphNode, Edge as GraphEdge } from '../types/graph';
import { getWebSocketService, WebSocketMessage } from '../services/websocketService';
import { logInfo, logError, logUserAction, logWebSocketEvent, logger } from '../utils/logger';
import useStore from '../store'; // Import the Zustand store
import CollaboratorCursor from './CollaboratorCursor';
import { CursorPosition, WorkflowChange } from '../types/collaboration';

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

  // Sanitize user input to prevent XSS attacks
  const sanitizedLabel = data.label ? DOMPurify.sanitize(data.label) : '';
  const sanitizedId = DOMPurify.sanitize(id);
  const sanitizedType = DOMPurify.sanitize(type);

  return (
    <div style={{ border: '1px solid black', padding: 10, background: backgroundColor }}>
      <div>ID: {sanitizedId}</div>
      <div>Type: {sanitizedType}</div>
      {sanitizedLabel && (
        <div
          dangerouslySetInnerHTML={{
            __html: `Label: ${sanitizedLabel}`
          }}
        />
      )}
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
  const updateNodes = useStore((state) => state.updateNodes); // Get updateNodes from store
  const applyWorkflowChanges = useStore((state) => state.applyWorkflowChanges); // Get applyWorkflowChanges from store
  const store = useStoreApi();
  const [collaboratorCursors, setCollaboratorCursors] = useState<Record<string, CursorPosition>>({});

  useEffect(() => {
    const fetchFlow = async () => {
      try {
        logInfo('Loading flow data', { component: 'FlowCanvas', action: 'loadFlow' });
        
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
        
        logInfo('Flow data loaded successfully', {
          component: 'FlowCanvas',
          action: 'loadFlow',
          nodeCount: reactFlowNodes.length,
          edgeCount: reactFlowEdges.length
        });
      } catch (error) {
        logError('Failed to load flow data', error instanceof Error ? error : new Error(String(error)), {
          component: 'FlowCanvas',
          action: 'loadFlow'
        });
      }
    };

    fetchFlow();
  }, [setNodes, setEdges]);

  useEffect(() => {
    const wsService = getWebSocketService();
    
    // Handle WebSocket messages (original functionality)
    const unsubscribeMessages = wsService.onMessage((message: WebSocketMessage) => {
      logWebSocketEvent('message received', {
        component: 'FlowCanvas',
        eventType: message.event_type,
        nodeId: message.payload.node_id
      });

      // Update node status based on WebSocket message
      updateNodes((currentNodes) =>
        currentNodes.map((node) => {
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
    });

    // Handle connection state changes
    const unsubscribeState = wsService.onStateChange((state) => {
      logWebSocketEvent(`connection ${state}`, {
        component: 'FlowCanvas',
        connectionState: state
      });
    });

    // Handle incoming cursor updates
    const unsubscribeCursorUpdates = wsService.onCursorUpdate((position: CursorPosition) => {
      setCollaboratorCursors(prev => ({
        ...prev,
        [position.userId]: position,
      }));
    });

    // Handle incoming workflow state changes
    const unsubscribeWorkflowChanges = wsService.onWorkflowStateChange((changes: WorkflowChange[]) => {
      // Apply changes to Zustand store
      applyWorkflowChanges(changes);
      logInfo('Workflow state updated from server', { component: 'FlowCanvas', changes });
    });

    // Connect to WebSocket
    wsService.connect().catch((error) => {
      logError('Failed to connect to WebSocket', error, {
        component: 'FlowCanvas',
        action: 'websocket-connect'
      });
    });

    // Cleanup on unmount
    return () => {
      unsubscribeMessages();
      unsubscribeState();
      unsubscribeCursorUpdates();
      unsubscribeWorkflowChanges();
    };
  }, [updateNodes, store, applyWorkflowChanges]);

  const onSelectionChange = useCallback(
    ({ nodes }: { nodes: Node[] }) => {
      if (nodes.length > 0) {
        const selectedNode = nodes[0];
        setSelectedNodeId(selectedNode.id);
        logUserAction('node selected', {
          component: 'FlowCanvas',
          nodeId: selectedNode.id,
          nodeType: selectedNode.type
        });
      } else {
        setSelectedNodeId(null);
        logUserAction('node deselected', { component: 'FlowCanvas' });
      }
    },
    [setSelectedNodeId]
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

  const onMouseMove = useCallback((event: React.MouseEvent) => {
    const wsService = getWebSocketService();
    const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    // In a real app, you'd get the actual user ID and name
    wsService.sendCursorPosition({ x: flowPosition.x, y: flowPosition.y, userId: 'user1', userName: 'User 1' });
  }, [screenToFlowPosition]);

  return (
    <div className="reactflow-wrapper h-full w-full" ref={reactFlowWrapper} data-testid="flow-canvas">
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
        onMouseMove={onMouseMove}
      >
        <MiniMap />
        <Controls />
        <Background />
        {Object.values(collaboratorCursors).map(cursor => (
          <CollaboratorCursor key={cursor.userId} cursor={cursor} />
        ))}
      </ReactFlow>
    </div>
  );
};

export default FlowCanvas;