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

    // Detect dark mode and load theme CSS vars
    const docStyle = window.getComputedStyle(document.documentElement);
    const foregroundVar = (docStyle.getPropertyValue('--foreground') || '').trim();
    const primaryVar = (docStyle.getPropertyValue('--primary') || '').trim();
    const isDark = document.documentElement.classList.contains('dark');

    // Set up drawing parameters
    const streamHeight = Math.min(height / Math.max(activeStreams.size, 1), 120);
    const margin = 20;
    let yOffset = margin;

    // Draw each active stream
    for (const [streamId, session] of activeStreams) {
      const messages = streamData.get(streamId) || [];

      // Text Color - Neon Cyan/White
      const textColor = `hsl(${foregroundVar || '180 100% 90%'})`;
      ctx.fillStyle = textColor;
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.fillText(`${session.node_id} (${streamId.substring(0, 8)}...)`, margin, yOffset + 20);

      // Draw stream status indicator
      const statusColor = getStatusColor(session.status);
      ctx.fillStyle = statusColor;
      ctx.beginPath();
      ctx.arc(width - 30, yOffset + 15, 6, 0, 2 * Math.PI);
      ctx.fill();
      // Glow effect
      ctx.shadowBlur = 10;
      ctx.shadowColor = statusColor;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Draw streaming data visualization
      if (messages.length > 0) {
        drawStreamTrace(ctx, messages, margin, yOffset + 30, width - 2 * margin, streamHeight - 60, { isDark });
      }

      // Draw stream info
      ctx.fillStyle = `hsl(${foregroundVar || '180 100% 90%'} / 0.7)`;
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.fillText(`Messages: ${messages.length}`, margin, yOffset + streamHeight - 10);

      yOffset += streamHeight + margin;
    }

    // Draw overall streaming status
    ctx.fillStyle = isStreaming ? '#00f0ff' : '#6b7280';
    ctx.font = 'bold 16px "JetBrains Mono", monospace';
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
    opts?: { isDark?: boolean }
  ) => {
    if (messages.length === 0) return;

    const maxMessages = Math.floor(w / 2); // 2 pixels per message
    const displayMessages = messages.slice(-maxMessages);
    
    const stepX = w / Math.max(displayMessages.length - 1, 1);
    
    // Draw background (Glassmorphic)
    ctx.fillStyle = 'rgba(20, 20, 30, 0.5)';
    ctx.fillRect(x, y, w, h);
    
    // Draw border
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    // Draw data trace
    ctx.beginPath();
    ctx.strokeStyle = '#00f0ff'; // Neon Cyan
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
      ctx.arc(plotX, plotY, 2, 0, 2 * Math.PI);
      ctx.fill();
    });

    // Add glow to the line
    ctx.shadowBlur = 5;
    ctx.shadowColor = '#00f0ff';
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'active': return '#00f0ff';    // Cyan
      case 'initializing': return '#f59e0b'; // Amber
      case 'paused': return '#6b7280';    // Gray
      case 'completed': return '#a020f0'; // Purple
      case 'error': return '#ff0055';     // Neon Red
      default: return '#6b7280';
    }
  };

  const getMessageTypeColor = (type: string): string => {
    switch (type) {
      case 'stream_start': return '#00f0ff'; // Cyan
      case 'stream_data': return '#a020f0';  // Purple
      case 'stream_end': return '#ff1493';   // Pink
      case 'stream_error': return '#ff0055'; // Red
      case 'heartbeat': return '#f59e0b';    // Amber
      default: return '#6b7280';
    }
  };

  // Redraw on canvas size or data changes
  useEffect(() => {
    drawStreamingVisualization();
  }, [drawStreamingVisualization]);

  return (
    <div className="glass-panel p-4 rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-primary neon-text">Live Streaming Visualization</h3>
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-primary shadow-[0_0_10px_#00f0ff]' : 'bg-gray-600'}`} />
          <span className="text-sm text-muted-foreground">
            {isStreaming ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>
      
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="rounded-lg border border-white/10 bg-black/20 backdrop-blur-sm"
        style={{ maxWidth: '100%', height: 'auto' }}
      />
      
      <div className="mt-2 text-xs text-muted-foreground font-mono">
        Active streams: {activeStreams.size} | 
        Total messages: {Array.from(streamData.values()).reduce((acc, messages) => acc + messages.length, 0)}
      </div>
      
      {/* Active streams preview panel */}
      {activeStreams.size > 0 && (
        <div className="mt-3 text-xs text-foreground/80 font-mono">
          <div className="font-medium mb-1 text-primary">Active Streams</div>
          {[...activeStreams.entries()].map(([streamId, session]) => {
            const msgs = streamData.get(streamId) || [];
            const last = msgs.length ? msgs[msgs.length - 1] : null;
            const preview = last ? (typeof last.data === 'object' ? JSON.stringify(last.data).slice(0, 140) : String(last.data).slice(0,140)) : 'no messages yet';
            return (
              <div key={streamId} className="py-1 border-b border-white/5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-secondary">{session.node_id || session.agent_id}</div>
                  <div className="text-xs text-muted-foreground">{streamId.substring(0,8)}</div>
                </div>
                <div className="text-xs text-foreground/60 truncate">{preview}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StreamingCanvas;