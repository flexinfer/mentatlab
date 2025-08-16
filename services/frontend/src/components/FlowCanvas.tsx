/**
 * @deprecated This component is deprecated. Use StreamingCanvas from
 * './StreamingCanvas.tsx' for real-time flow visualization instead.
 * This component will be removed in a future version.
 *
 * Migration Guide:
 * - Replace FlowCanvas with StreamingCanvas for real-time flow visualization
 * - Use StreamingPage for the complete streaming experience
 * - Streaming components provide better performance and real-time updates
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactFlow, {
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  Node,
  Edge,
  NodeProps,
  useReactFlow,
  useStoreApi,
  Connection, // Import Connection type
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import DOMPurify from 'dompurify';
import { FeatureFlags } from '../config/features';
import { loadFlow } from '../loadFlow';
import {
  Node as GraphNode,
  Edge as GraphEdge,
  PinType,
  Pin,
  NodeCategory, // Imported
  isPinMediaType,
  isPinStreamType,
  isStreamingNode
} from '../types/graph'; // Import relevant types from graph
import { MediaType, MediaProcessingOptions, MediaReference } from '../types/media'; // Import MediaType, MediaProcessingOptions, MediaReference from media.ts
import { getWebSocketService, WebSocketMessage } from '../services/websocketService';
import { logInfo, logError, logUserAction, logWebSocketEvent } from '../utils/logger';
import useStore from '../store'; // Import the Zustand store
import CollaboratorCursor from './CollaboratorCursor';
import { CursorPosition, WorkflowChange } from '../types/collaboration';

// Define CustomNodeData to hold all custom properties for a ReactFlow node's `data` field
interface CustomNodeData {
  label: string;
  status?: 'running' | 'completed' | 'failed';
  // Include all other properties from GraphNode that should be in `data`
  outputs?: Record<string, Pin>;
  params?: Record<string, any>;
  category?: NodeCategory;
  isMediaNode?: boolean;
  mediaCapabilities?: {
    supportedInputTypes?: MediaType[];
    supportedOutputTypes?: MediaType[];
    supportsStreaming?: boolean;
    maxFileSize?: number;
    processingOptions?: MediaProcessingOptions;
  };
  mediaState?: {
    currentMedia?: MediaReference;
    progress?: number;
    status?: 'idle' | 'processing' | 'completed' | 'error';
    error?: string;
  };
  mediaDisplay?: {
    showPreview?: boolean;
    previewUrl?: string;
    previewType?: 'image' | 'video' | 'audio' | 'waveform';
  };
  // Explicitly add inputs here as they are part of the node's data for pins
  inputs?: Record<string, Pin>;
}

// Define RFNode as a ReactFlow Node with CustomNodeData as its data type
type RFNode = Node<CustomNodeData>;

const CustomNode: React.FC<NodeProps<CustomNodeData>> = ({ id, type, data }) => {
  // Theme-aware styling
  const nodeStyle: React.CSSProperties = {
    border: '1px solid hsl(var(--border))',
    // Use muted surface by default to avoid stark white in light mode
    background: 'hsl(var(--muted))',
    color: 'hsl(var(--foreground))',
    padding: 10,
    position: 'relative',
    borderRadius: 8,
    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
  };
  // Status tint with proper dark mode support
  if (data.status === 'running') {
    nodeStyle.background = 'hsl(var(--amber-50, 39 100% 97%))'; // amber-50 tint on top of card
    nodeStyle.borderColor = 'hsl(var(--amber-200, 48 97% 77%))';
  } else if (data.status === 'completed') {
    nodeStyle.background = 'hsl(var(--emerald-50, 152 81% 96%))'; // emerald-50 tint
    nodeStyle.borderColor = 'hsl(var(--emerald-200, 152 76% 80%))';
  } else if (data.status === 'failed') {
    nodeStyle.background = 'hsl(var(--red-50, 0 86% 97%))'; // red-50 tint
    nodeStyle.borderColor = 'hsl(var(--red-200, 0 73% 77%))';
  }

  // Sanitize user input to prevent XSS attacks
  const sanitizedLabel = data.label ? DOMPurify.sanitize(data.label) : '';
  const sanitizedId = DOMPurify.sanitize(id);
  const sanitizedType = DOMPurify.sanitize(type);

  return (
    <div style={nodeStyle}>
       {/* Default handles to allow edges without explicit handle ids */}
      <Handle type="target" position={Position.Left} id="in" style={{ background: 'hsl(var(--ring))' }} />
      <Handle type="source" position={Position.Right} id="out" style={{ background: 'hsl(var(--ring))' }} />

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
       {/* Media Preview Section */}
       {data.mediaDisplay?.showPreview && data.mediaDisplay.previewUrl && (
         <div className="media-preview mt-2">
           {data.mediaDisplay.previewType === 'image' && (
             <img src={data.mediaDisplay.previewUrl} alt="Preview" className="max-w-full h-auto" />
           )}
           {data.mediaDisplay.previewType === 'video' && (
             <video src={data.mediaDisplay.previewUrl} controls className="max-w-full h-auto" />
           )}
           {data.mediaDisplay.previewType === 'audio' && (
             <audio src={data.mediaDisplay.previewUrl} controls className="w-full" />
           )}
           {/* Add more preview types as needed, e.g., 'waveform' for audio, 'document' */}
         </div>
       )}
     </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
  input: CustomNode,
  default: CustomNode,
  output: CustomNode,
};

// Workaround: cast a few ReactFlow components to any to avoid strict prop incompatibilities
// We'll use the any-typed variants when rendering to unblock type-check; these can be tightened later.
const MiniMapAny = MiniMap as any;
const ControlsAny = Controls as any;
const BackgroundAny = Background as any;

/**
 * @deprecated Use StreamingCanvas instead for real-time flow visualization
 *
 * NOTE: added local debounced lint triggers on node/edge changes (300ms)
 */
function useDebouncedCallback<T extends (...args: any[]) => any>(cb: T, wait = 300) {
  const timer = React.useRef<number | null>(null);
  return React.useCallback(
    (...args: any[]) => {
      if (timer.current) {
        window.clearTimeout(timer.current);
      }
      // window.setTimeout returns number in browsers
      timer.current = window.setTimeout(() => {
        try {
          cb(...args);
        } finally {
          // Dispatch lint trigger whenever debounced change fires
          try {
            window.dispatchEvent(new CustomEvent('lint:trigger'));
          } catch {
            // ignore
          }
          timer.current = null;
        }
      }, wait) as unknown as number;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cb, wait]
  );
}

const FlowCanvas: React.FC = () => { // Removed onNodeSelect prop
  // Add deprecation warning in development
  React.useEffect(() => {
    console.warn(
      'FlowCanvas is deprecated. Use StreamingCanvas from ./StreamingCanvas.tsx instead. ' +
      'This component will be removed in a future version.'
    );
  }, []);
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
        const reactFlowNodes: RFNode[] = flowData.graph.nodes.map((node: GraphNode) => ({
          id: node.id,
          type: node.type,
          position: { x: node.position.x || 0, y: node.position.y || 0 },
          // Add a wrapper class so we can reliably override the outer react-flow node background
          className: 'mc-node',
          // Inline style on the node object applies to the outer wrapper element created by React Flow.
          // Use inline style to force transparency and remove border/shadow that causes white rim.
          style: {
            background: 'transparent',
            border: 'none',
            boxShadow: 'none',
            padding: 0,
          },
          data: {
            label: (node.params?.label as string) || node.id,
            status: undefined,
            outputs: node.outputs,
            params: node.params as Record<string, any> | undefined,
            category: node.category,
            isMediaNode: node.isMediaNode,
            mediaCapabilities: node.mediaCapabilities,
            mediaState: node.mediaState,
            mediaDisplay: node.mediaDisplay,
            inputs: node.inputs,
          },
        }));

        // React Flow expects node ids and optional handle ids separately.
        // Our graph edges are "nodeId.handleId" (e.g., "agentA.out" -> "agentB.in").
        const parseEndpoint = (endpoint: string): { nodeId: string; handleId?: string } => {
          // Defensive parsing: some manifests may contain literal strings "undefined" or "null"
          // as the handle portion. Normalize those to undefined so React Flow doesn't try to
          // use an invalid handle id.
          if (typeof endpoint !== 'string' || endpoint.trim() === '') {
            return { nodeId: '', handleId: undefined };
          }
          const parts = endpoint.split('.');
          const nodeId = parts[0] || '';
          let handleId: string | undefined = parts.length > 1 ? parts.slice(1).join('.') : undefined;
          if (handleId !== undefined) {
            handleId = handleId.trim();
            if (!handleId || handleId === 'undefined' || handleId === 'null') {
              handleId = undefined;
            }
          }
          return { nodeId, handleId };
        };

        const reactFlowEdges: Edge[] = flowData.graph.edges.map((edge: GraphEdge) => {
          const from = parseEndpoint(edge.from);
          const to = parseEndpoint(edge.to);

          const e: Partial<Edge> = {
            id: `e-${edge.from}-${edge.to}`,
            source: from.nodeId,
            target: to.nodeId,
          };

          // Only set handle ids when they are valid (not literal 'undefined'/'null')
          const valid = (h?: string) => !!h && h !== 'undefined' && h !== 'null';
          if (valid(from.handleId)) e.sourceHandle = from.handleId!;
          if (valid(to.handleId)) e.targetHandle = to.handleId!;

          return e as Edge;
        });

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

  // Wire live stream sessions from the Gateway into the Flow view.
  // This is a best-effort mapping:
  //  - Queries gateway: GET {GATEWAY_BASE}/api/v1/streams
  //  - Opens WS to each session.ws_url and listens for stream messages
  //  - Maps message kinds (node:exec, edge:transmit, tool:call, stream_end) to node/edge updates
  useEffect(() => {
    if (!FeatureFlags.NEW_STREAMING) return;

    const env = (import.meta as any)?.env || {};
    const gatewayBase = (env.VITE_GATEWAY_URL as string) || 'http://127.0.0.1:8080';
    const gatewayHost = gatewayBase.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const gatewayProto = gatewayBase.startsWith('https') ? 'wss' : 'ws';

    const controllers: { abort: () => void }[] = [];
    const wsMap = new Map<string, WebSocket>();

    const normalizePayload = (raw: any): any => {
      // Accept CloudEvents envelope or raw payloads
      if (!raw) return raw;
      if (raw.data && typeof raw.data === 'object') {
        // Some envelopes use data.data (double-wrapped); prefer inner-most 'data'
        if (raw.data.data && typeof raw.data.data === 'object') return raw.data.data;
        return raw.data;
      }
      return raw;
    };

    const handleStreamMessage = (parsed: any) => {
      try {
        const payload = normalizePayload(parsed);
        const kind = ((payload?.kind || payload?.type || '') + '').toLowerCase();

        // Normalize node identifier heuristics:
        // prefer payload.model.component (agents often set model.component to the node id),
        // then payload.node, payload.node_id, payload.id, payload.data.node, payload.data.id.
        const nodeId =
          (payload?.model && payload.model.component) ||
          payload?.node ||
          payload?.node_id ||
          payload?.id ||
          (payload?.data && (payload.data.node || payload.data.id));

        // node execution: mark node running briefly
        if (kind.includes('node:exec') || kind.includes('node_exec') || kind.includes('nodeexec')) {
          if (nodeId) {
            updateNodes((currentNodes) =>
              currentNodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status: 'running' } } : n))
            );
            // clear to completed after short delay
            setTimeout(() => {
              updateNodes((currentNodes) =>
                currentNodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status: 'completed' } } : n))
              );
            }, 1200);
          }
        }

        // edge transmit: animate matching edges
        if (kind.includes('edge:transmit') || kind.includes('edge_transmit') || kind.includes('edgetransmit')) {
          const from = payload.from || payload.source;
          const to = payload.to || payload.target;
          if (from && to) {
            setEdges(edges.map((e) => (e.source === from && e.target === to ? { ...e, animated: true, style: { ...(e.style || {}), stroke: '#3b82f6' } } : e)));
            // stop animation shortly after
            setTimeout(() => {
              setEdges(edges.map((e) => (e.source === from && e.target === to ? { ...e, animated: false } : e)));
            }, 1200);
          }
        }

        // tool calls: mark node as running and log tokens
        if (kind.includes('tool:call') || kind.includes('tool_call') || kind.includes('toolcall')) {
          const node = payload.node || payload.id || payload.node_id;
          if (node) {
            updateNodes((currentNodes) =>
              currentNodes.map((n) => (n.id === node ? { ...n, data: { ...n.data, status: 'running' } } : n))
            );
            setTimeout(() => {
              updateNodes((currentNodes) =>
                currentNodes.map((n) => (n.id === node ? { ...n, data: { ...n.data, status: 'completed' } } : n))
              );
            }, 800);
          }
        }

        // stream_end -> mark all nodes completed
        if (((payload?.type || '') + '').toLowerCase().includes('stream_end') || ((parsed?.type || '') + '').toLowerCase().includes('stream_end')) {
          updateNodes((currentNodes) => currentNodes.map((n) => ({ ...n, data: { ...n.data, status: 'completed' } })));
        }
      } catch (err) {
        // tolerate errors
      }
    };

    const init = async () => {
      try {
        const controller = new AbortController();
        controllers.push({ abort: () => controller.abort() });
        const resp = await fetch(`${gatewayBase}/api/v1/streams`, { signal: controller.signal });
        if (!resp.ok) return;
        const body = await resp.json();
        const sessions = body.streams || body || [];
        for (const s of sessions) {
          try {
            const wsPath = s.ws_url && s.ws_url.startsWith('/') ? s.ws_url : `/${s.ws_url || ''}`;
            const wsUrl = `${gatewayProto}://${gatewayHost}${wsPath}`;
            const ws = new WebSocket(wsUrl);
            wsMap.set(s.stream_id, ws);
            ws.onmessage = (ev) => {
              try {
                const parsed = JSON.parse(ev.data);
                handleStreamMessage(parsed);
              } catch (e) {
                // non-json frames: ignore
              }
            };
            ws.onopen = () => {
              console.log('[FlowCanvas] Subscribed to gateway stream', s.stream_id);
            };
            ws.onclose = () => {
              wsMap.delete(s.stream_id);
            };
          } catch (e) {
            // ignore per-stream errors
          }
        }
      } catch (e) {
        // ignore discovery errors
      }
    };

    init();

    return () => {
      // cleanup
      controllers.forEach((c) => c.abort());
      wsMap.forEach((w) => {
        try {
          w.close();
        } catch {}
      });
      wsMap.clear();
    };
  }, [setEdges, updateNodes]);

  useEffect(() => {
    // Only wire streaming when enabled and WS connections allowed
    if (!FeatureFlags.NEW_STREAMING || !FeatureFlags.CONNECT_WS) {
      return;
    }

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
    ({ nodes }: { nodes: RFNode[] }) => {
      if (nodes.length > 0) {
        const selectedNode = nodes[0];
        setSelectedNodeId(selectedNode.id);
        logUserAction('node selected', {
          component: 'FlowCanvas',
          nodeId: selectedNode.id,
          nodeType: selectedNode.type // Access type from node directly
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
 
      const newNode: RFNode = { // Use RFNode here
        id: `${agentData.id}-${Math.random().toString(36).substring(7)}`, // Unique ID
        type,
        position,
        data: {
          label: agentData.name,
          status: undefined,
          outputs: agentData.outputs as Record<string, Pin> | undefined,
          params: agentData.params as Record<string, any> | undefined,
          category: agentData.category,
          isMediaNode: agentData.isMediaNode,
          mediaCapabilities: agentData.mediaCapabilities,
          mediaState: agentData.mediaState,
          mediaDisplay: agentData.mediaDisplay,
          inputs: agentData.inputs as Record<string, Pin> | undefined,
        },
      };

      addNode(newNode); // Use addNode from store
    },
    [screenToFlowPosition, addNode] // Add addNode to dependency array
  );

  const onMouseMove = useCallback((event: React.MouseEvent) => {
    if (!FeatureFlags.NEW_STREAMING || !FeatureFlags.CONNECT_WS) return;
    const wsService = getWebSocketService();
    const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    // In a real app, you'd get the actual user ID and name
    wsService.sendCursorPosition({ x: flowPosition.x, y: flowPosition.y, userId: 'user1', userName: 'User 1' });
  }, [screenToFlowPosition]);

  const isValidConnection = useCallback(
    (connection: Connection): boolean => {
      const sourceNode = nodes.find((node) => node.id === connection.source);
      const targetNode = nodes.find((node) => node.id === connection.target);

      if (!sourceNode || !targetNode) {
        return false;
      }

      const sourceHandleId = connection.sourceHandle;
      const targetHandleId = connection.targetHandle;

      // Basic compatibility: handle IDs must exist
      if (!sourceHandleId || !targetHandleId) {
        return false;
      }

      // Extract pin types from handles (assuming handle IDs map to pin names/types)
      // This part assumes that the handleId directly corresponds to the Pin.name and Pin.type
      // In a real application, you might need a more robust way to get pin details
      // from the node's data/schema. For now, we'll assume a simple direct mapping.
      // We'll also need to consider the actual `Pin` definition from `types/graph.ts`
      // to access `supportedMediaTypes` etc.

      // For simplicity, let's assume handleId is "output_pin_name" and "input_pin_name"
      // and we need to map these to actual Pin objects on the node.
      // This might require extending the Node data to include pin definitions.

      // Placeholder for actual pin type extraction
      const getPinType = (node: RFNode, handleId: string, isSource: boolean): PinType | undefined => {
        // This is a simplified example. In a real app, pins would be defined
        // as part of the node's schema or capabilities.
        // For now, let's assume handleId is the pin type for demonstration.
        // This needs to be refined based on actual node/pin structure.
        // The `GraphNode` has outputs and inputs defined as `outputs?: Record<string, unknown>;`
        // and `inputs?: Record<string, unknown>;`
        // We need to retrieve the specific Pin object from these records.
        if (isSource) {
          const outputPins = node.data.outputs;
          return outputPins?.[handleId]?.type;
        } else {
          const inputPins = node.data.inputs;
          return inputPins?.[handleId]?.type;
        }
      };

      const sourcePinType = getPinType(sourceNode, sourceHandleId, true);
      const targetPinType = getPinType(targetNode, targetHandleId, false);

      if (!sourcePinType || !targetPinType) {
        return false; // Cannot determine pin types
      }

      // 1. Exact PinType match
      if (sourcePinType === targetPinType) {
        return true;
      }

      // 2. Media Type Compatibility
      if (isPinMediaType(sourcePinType) && isPinMediaType(targetPinType)) {
        // A generic 'media' pin can connect to any specific media type and vice-versa
        if (sourcePinType === 'media' || targetPinType === 'media') {
          return true;
        }
        // Check if specific media types are compatible
        // This would require checking sourceNode.data.mediaCapabilities.supportedOutputTypes
        // and targetNode.data.mediaCapabilities.supportedInputTypes
        // For now, assume any specific media type can connect to another if both are media
        return true; // Simplified: any media to any media
      }

      // 3. Stream Compatibility
      if (isPinStreamType(sourcePinType) && isPinStreamType(targetPinType)) {
        // Both are stream types, check if both nodes support streaming
        return isStreamingNode(sourceNode.data) && isStreamingNode(targetNode.data);
      }

      // More complex compatibility rules can be added here
      // E.g., string to number conversion, JSON compatibility etc.

      return false; // Default to false for incompatible connections
    },
    [nodes] // Depend on nodes to get updated pin definitions
  );
 
  // Create stable debounced wrappers for node/edge change handlers that also emit a lint trigger.
  const debouncedOnNodesChange = useDebouncedCallback(onNodesChange, 300);
  const debouncedOnEdgesChange = useDebouncedCallback(onEdgesChange, 300);

  return (
    <div className="reactflow-wrapper h-full w-full" style={{ height: '100%', width: '100%' }} ref={reactFlowWrapper} data-testid="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={debouncedOnNodesChange}
        onEdgesChange={debouncedOnEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onSelectionChange={onSelectionChange}
        nodeTypes={nodeTypes}
        fitView
        onMouseMove={onMouseMove}
        isValidConnection={isValidConnection} // Pass the validation function
      >
        <MiniMapAny
          style={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
          }}
          nodeColor={() => 'hsl(var(--ring))'}
          nodeStrokeColor={() => 'hsl(var(--border))'}
          maskColor="rgba(0,0,0,0.15)"
        />
        <ControlsAny
          style={{
            background: 'hsl(var(--card))',
            color: 'hsl(var(--foreground))',
            border: '1px solid hsl(var(--border))',
          }}
        />
        <BackgroundAny
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="hsl(var(--border))"
        />
        {Object.values(collaboratorCursors).map(cursor => (
          <CollaboratorCursor key={cursor.userId} cursor={cursor} />
        ))}
      </ReactFlow>
    </div>
  );
};

export default FlowCanvas;