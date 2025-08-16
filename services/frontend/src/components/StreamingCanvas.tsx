/**
 * StreamingCanvas - Real-time flow execution visualization for streaming data
 * Phase 2 Beta milestone component for MentatLab
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';

import { StreamSession, StreamMessage } from '../types/streaming';

interface StreamingCanvasProps {
  flowId?: string;
  streamingSessions?: StreamSession[];
  width?: number;
  height?: number;
  onStreamData?: (streamId: string, data: any) => void;
  onStreamStatusChange?: (streamId: string, status: string) => void;
}

export const StreamingCanvas: React.FC<StreamingCanvasProps> = ({
  flowId,
  streamingSessions = [],
  width = 800,
  height = 600,
  onStreamData,
  onStreamStatusChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [activeStreams, setActiveStreams] = useState<Map<string, StreamSession>>(new Map());
  const [streamData, setStreamData] = useState<Map<string, StreamMessage[]>>(new Map());
  const [isStreaming, setIsStreaming] = useState(false);
  const streamConnections = useRef<Map<string, WebSocket>>(new Map());

  // Initialize streaming sessions
  useEffect(() => {
    const sessionMap = new Map();
    streamingSessions.forEach(session => {
      sessionMap.set(session.stream_id, session);
    });
    setActiveStreams(sessionMap);
  }, [streamingSessions]);

  // Discover active streams from the Gateway (helpful for local-dev)
  useEffect(() => {
    const env = (import.meta as any)?.env || {};
    const gatewayBase = (env.VITE_GATEWAY_URL as string) || 'http://127.0.0.1:8080';
    const fetchStreams = async () => {
      try {
        const url = gatewayBase.replace(/\/$/, '') + '/api/v1/streams';
        const resp = await fetch(url);
        if (!resp.ok) {
          console.warn('[StreamingCanvas] failed to fetch streams', resp.status);
          return;
        }
        const json = await resp.json();
        const sessions = json.streams || [];
        const map = new Map<string, StreamSession>();
        sessions.forEach((s: any) => {
          // Normalize shape expected by this component
          const session: any = {
            stream_id: s.stream_id,
            ws_url: s.ws_url || s.ws || `/ws/streams/${s.stream_id}`,
            status: s.status || 'active',
            agent_id: s.agent_id,
            node_id: s.node_id || s.agent_id
          };
          map.set(session.stream_id, session);
        });
        setActiveStreams(map);
      } catch (err) {
        console.error('[StreamingCanvas] fetchStreams error', err);
      }
    };

    // Fetch immediately and then poll periodically while component mounted
    fetchStreams();
    const interval = setInterval(fetchStreams, 2000);
    return () => clearInterval(interval);
  }, []);

  // Connect to streaming sessions
  useEffect(() => {
    if (activeStreams.size === 0) return;

    const connectToStreams = async () => {
      console.debug('[StreamingCanvas] connectToStreams - activeStreams:', Array.from(activeStreams.keys()));
      for (const [streamId, session] of activeStreams) {
        try {
          // Connect to stream WebSocket
          // Derive gateway base URL from Vite env (supports VITE_GATEWAY_URL) with a sensible default.
          const env = (import.meta as any)?.env || {};
          const gatewayBase = (env.VITE_GATEWAY_URL as string) || 'http://127.0.0.1:8080';
          const gatewayProto = gatewayBase.startsWith('https') ? 'wss' : 'ws';
          // Strip protocol and trailing slash
          const gatewayHost = gatewayBase.replace(/^https?:\/\//, '').replace(/\/$/, '');
          const wsPath = session.ws_url && session.ws_url.startsWith('/') ? session.ws_url : `/${session.ws_url}`;
          const wsUrl = `${gatewayProto}://${gatewayHost}${wsPath}`;
          
          // Debug: announce the URL we're about to connect to
          console.debug(`[StreamingCanvas] attempting WS connect for stream=${streamId} wsUrl=${wsUrl} session=`, session);
          const ws = new WebSocket(wsUrl);
          
          ws.onopen = () => {
            console.log(`Connected to stream: ${streamId}`);
            onStreamStatusChange?.(streamId, 'connected');
            // Best-effort subscribe message in case server expects an explicit subscribe payload
            try {
              const subscribeMsg = JSON.stringify({ type: 'subscribe', stream_id: streamId });
              ws.send(subscribeMsg);
              console.debug(`[StreamingCanvas] sent subscribe message for stream=${streamId}`);
            } catch (err) {
              console.debug(`[StreamingCanvas] failed to send subscribe for ${streamId}:`, err);
            }
          };

          ws.onmessage = (event) => {
            try {
              const message: StreamMessage = JSON.parse(event.data);
              handleStreamMessage(streamId, message);
            } catch (error) {
              console.error('Failed to parse stream message:', error);
            }
          };

          ws.onclose = () => {
            console.log(`Stream disconnected: ${streamId}`);
            onStreamStatusChange?.(streamId, 'disconnected');
            streamConnections.current.delete(streamId);
          };

          ws.onerror = (error) => {
            console.error(`Stream error for ${streamId}:`, error);
            onStreamStatusChange?.(streamId, 'error');
          };

          streamConnections.current.set(streamId, ws);
        } catch (error) {
          console.error(`Failed to connect to stream ${streamId}:`, error);
        }
      }
    };

    connectToStreams();
    setIsStreaming(true);

    // Cleanup on unmount
    return () => {
      streamConnections.current.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
      streamConnections.current.clear();
      setIsStreaming(false);
    };
  }, [activeStreams, onStreamStatusChange]);

  const handleStreamMessage = useCallback((streamId: string, message: StreamMessage) => {
    setStreamData(prev => {
      const newData = new Map(prev);
      const messages = newData.get(streamId) || [];
      
      // Add new message with sequence ordering
      const updatedMessages = [...messages, message].sort((a, b) => 
        (a.sequence || 0) - (b.sequence || 0)
      );
      
      // Keep last 100 messages per stream
      if (updatedMessages.length > 100) {
        updatedMessages.splice(0, updatedMessages.length - 100);
      }
      
      newData.set(streamId, updatedMessages);
      return newData;
    });

    // Notify parent component
    onStreamData?.(streamId, message.data);

    // Update stream status based on message type
    if (message.type === 'stream_start') {
      onStreamStatusChange?.(streamId, 'active');
    } else if (message.type === 'stream_end') {
      onStreamStatusChange?.(streamId, 'completed');
    } else if (message.type === 'stream_error') {
      onStreamStatusChange?.(streamId, 'error');
    }

    // Trigger canvas redraw
    requestAnimationFrame(() => drawStreamingVisualization());
  }, [onStreamData, onStreamStatusChange]);

  const drawStreamingVisualization = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Detect dark mode and load theme CSS vars for card and border
    const docStyle = window.getComputedStyle(document.documentElement);
    const cardVar = (docStyle.getPropertyValue('--card') || '').trim();
    const borderVar = (docStyle.getPropertyValue('--border') || '').trim();
    const foregroundVar = (docStyle.getPropertyValue('--foreground') || '').trim();
    const isDark = document.documentElement.classList.contains('dark');

    // Set up drawing parameters
    const streamHeight = Math.min(height / Math.max(activeStreams.size, 1), 120);
    const margin = 20;
    let yOffset = margin;

    // Draw each active stream
    for (const [streamId, session] of activeStreams) {
      const messages = streamData.get(streamId) || [];

      // Choose text color from theme
      const textColor = isDark && foregroundVar ? `hsl(${foregroundVar})` : '#111827';
      ctx.fillStyle = textColor;
      ctx.font = '14px Arial';
      ctx.fillText(`${session.node_id} (${streamId.substring(0, 8)}...)`, margin, yOffset + 20);

      // Draw stream status indicator
      const statusColor = getStatusColor(session.status);
      ctx.fillStyle = statusColor;
      ctx.beginPath();
      ctx.arc(width - 30, yOffset + 15, 8, 0, 2 * Math.PI);
      ctx.fill();

      // Draw streaming data visualization
      if (messages.length > 0) {
        drawStreamTrace(ctx, messages, margin, yOffset + 30, width - 2 * margin, streamHeight - 60, { isDark, cardVar, borderVar });
      }

      // Draw stream info
      const metaColor = isDark && foregroundVar ? `hsl(${foregroundVar})` : '#6b7280';
      ctx.fillStyle = metaColor;
      ctx.font = '12px Arial';
      ctx.fillText(`Messages: ${messages.length}`, margin, yOffset + streamHeight - 10);

      yOffset += streamHeight + margin;
    }

    // Draw overall streaming status
    ctx.fillStyle = isStreaming ? '#22c55e' : (isDark ? '#9ca3af' : '#6b7280');
    ctx.font = 'bold 16px Arial';
    ctx.fillText(
      isStreaming ? `Streaming ${activeStreams.size} sessions` : 'Not streaming',
      margin,
      height - margin
    );

  }, [activeStreams, streamData, isStreaming, width, height]);

  const drawStreamTrace = (
    ctx: CanvasRenderingContext2D,
    messages: StreamMessage[],
    x: number,
    y: number,
    w: number,
    h: number,
    opts?: { isDark?: boolean; cardVar?: string; borderVar?: string }
  ) => {
    if (messages.length === 0) return;

    const maxMessages = Math.floor(w / 2); // 2 pixels per message
    const displayMessages = messages.slice(-maxMessages);
    
    const stepX = w / Math.max(displayMessages.length - 1, 1);
    
    // Draw background (use theme card in dark mode)
    const isDark = !!opts?.isDark;
    const cardVar = opts?.cardVar ?? '';
    const borderVar = opts?.borderVar ?? '';
    const bgColor = isDark && cardVar ? `hsl(${cardVar})` : '#f3f4f6';
    const borderColor = isDark && borderVar ? `hsl(${borderVar})` : '#d1d5db';
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, w, h);
    
    // Draw border
    ctx.strokeStyle = borderColor;
    ctx.strokeRect(x, y, w, h);

    // Draw data trace
    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;

    displayMessages.forEach((message, index) => {
      const plotX = x + index * stepX;
      
      // Simple visualization: vary height based on data content size
      const dataSize = JSON.stringify(message.data).length;
      const normalizedHeight = Math.min(dataSize / 1000, 1); // Normalize to 0-1
      const plotY = y + h - (normalizedHeight * h * 0.8) - h * 0.1;
      
      if (index === 0) {
        ctx.moveTo(plotX, plotY);
      } else {
        ctx.lineTo(plotX, plotY);
      }

      // Draw data points
      ctx.fillStyle = getMessageTypeColor(message.type);
      ctx.beginPath();
      ctx.arc(plotX, plotY, 3, 0, 2 * Math.PI);
      ctx.fill();
    });

    ctx.stroke();
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'active': return '#22c55e';
      case 'initializing': return '#f59e0b';
      case 'paused': return '#6b7280';
      case 'completed': return '#3b82f6';
      case 'error': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getMessageTypeColor = (type: string): string => {
    switch (type) {
      case 'stream_start': return '#22c55e';
      case 'stream_data': return '#3b82f6';
      case 'stream_end': return '#8b5cf6';
      case 'stream_error': return '#ef4444';
      case 'heartbeat': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  // Redraw on canvas size or data changes
  useEffect(() => {
    drawStreamingVisualization();
  }, [drawStreamingVisualization]);

  return (
    <div className="streaming-canvas-container">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Live Streaming Visualization</h3>
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-green-500' : 'bg-gray-400'}`} />
          <span className="text-sm text-gray-600">
            {isStreaming ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>
      
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="border border-gray-300 dark:border-border rounded-lg bg-white dark:mc-card-bg"
        style={{ maxWidth: '100%', height: 'auto' }}
      />
      
      <div className="mt-2 text-xs text-gray-500">
        Active streams: {activeStreams.size} | 
        Total messages: {Array.from(streamData.values()).reduce((acc, messages) => acc + messages.length, 0)}
      </div>
      
      {/* Active streams preview panel - shows last received message for quick debugging */}
      {activeStreams.size > 0 && (
        <div className="mt-3 text-xs text-gray-700">
          <div className="font-medium mb-1">Active Streams</div>
          {[...activeStreams.entries()].map(([streamId, session]) => {
            const msgs = streamData.get(streamId) || [];
            const last = msgs.length ? msgs[msgs.length - 1] : null;
            const preview = last ? (typeof last.data === 'object' ? JSON.stringify(last.data).slice(0, 140) : String(last.data).slice(0,140)) : 'no messages yet';
            return (
              <div key={streamId} className="py-1 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold">{session.node_id || session.agent_id}</div>
                  <div className="text-xs text-gray-500">{streamId.substring(0,8)}</div>
                </div>
                <div className="text-xs text-gray-600 truncate">{preview}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StreamingCanvas;