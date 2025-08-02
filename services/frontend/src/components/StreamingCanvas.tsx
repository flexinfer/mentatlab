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

  // Connect to streaming sessions
  useEffect(() => {
    if (activeStreams.size === 0) return;

    const connectToStreams = async () => {
      for (const [streamId, session] of activeStreams) {
        try {
          // Connect to stream WebSocket
          const ws = new WebSocket(`ws://localhost:8001${session.ws_url}`);
          
          ws.onopen = () => {
            console.log(`Connected to stream: ${streamId}`);
            onStreamStatusChange?.(streamId, 'connected');
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

    // Set up drawing parameters
    const streamHeight = Math.min(height / Math.max(activeStreams.size, 1), 120);
    const margin = 20;
    let yOffset = margin;

    // Draw each active stream
    for (const [streamId, session] of activeStreams) {
      const messages = streamData.get(streamId) || [];
      
      // Draw stream header
      ctx.fillStyle = '#333';
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
        drawStreamTrace(ctx, messages, margin, yOffset + 30, width - 2 * margin, streamHeight - 60);
      }

      // Draw stream info
      ctx.fillStyle = '#666';
      ctx.font = '12px Arial';
      ctx.fillText(`Messages: ${messages.length}`, margin, yOffset + streamHeight - 10);

      yOffset += streamHeight + margin;
    }

    // Draw overall streaming status
    ctx.fillStyle = isStreaming ? '#22c55e' : '#6b7280';
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
    h: number
  ) => {
    if (messages.length === 0) return;

    const maxMessages = Math.floor(w / 2); // 2 pixels per message
    const displayMessages = messages.slice(-maxMessages);
    
    const stepX = w / Math.max(displayMessages.length - 1, 1);
    
    // Draw background
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(x, y, w, h);
    
    // Draw border
    ctx.strokeStyle = '#d1d5db';
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
        className="border border-gray-300 rounded-lg bg-white"
        style={{ maxWidth: '100%', height: 'auto' }}
      />
      
      <div className="mt-2 text-xs text-gray-500">
        Active streams: {activeStreams.size} | 
        Total messages: {Array.from(streamData.values()).reduce((acc, messages) => acc + messages.length, 0)}
      </div>
    </div>
  );
};

export default StreamingCanvas;