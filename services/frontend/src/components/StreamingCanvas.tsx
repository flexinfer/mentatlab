/**
 * StreamingCanvas - Real-time flow execution visualization for streaming data
 *
 * Reads session/message data from the streaming store (populated by
 * useStreamingTransport in WorkspaceProvider). No direct HTTP polling or
 * WebSocket management happens here -- this component is a pure consumer.
 */

import React, { useEffect, useRef, useCallback } from 'react';

import { useStreamingStore, type StreamSession } from '@/stores/streaming';
import type { StreamMessage } from '@/types/streaming';

interface StreamingCanvasProps {
  width?: number;
  height?: number;
}

export const StreamingCanvas: React.FC<StreamingCanvasProps> = ({
  width = 800,
  height = 600,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Read from the streaming store -- single source of truth
  const sessions = useStreamingStore((s) => s.sessions);
  const connectionStatus = useStreamingStore((s) => s.connectionStatus);
  const isStreaming = connectionStatus === 'connected';

  // Build a flat map of sessionId -> messages for the canvas renderer
  const sessionEntries = Array.from(sessions.entries());

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

    // Set up drawing parameters
    const streamHeight = Math.min(height / Math.max(sessionEntries.length, 1), 120);
    const margin = 20;
    let yOffset = margin;

    // Draw each active session
    for (const [sessionId, session] of sessionEntries) {
      const messages = session.messages as StreamMessage[];

      // Text Color
      const textColor = `hsl(${foregroundVar || '180 100% 90%'})`;
      ctx.fillStyle = textColor;
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.fillText(`${session.runId ?? sessionId} (${sessionId.substring(0, 8)}...)`, margin, yOffset + 20);

      // Draw session status indicator
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
        drawStreamTrace(ctx, messages, margin, yOffset + 30, width - 2 * margin, streamHeight - 60);
      }

      // Draw session info
      ctx.fillStyle = `hsl(${foregroundVar || '180 100% 90%'} / 0.7)`;
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.fillText(`Messages: ${messages.length}`, margin, yOffset + streamHeight - 10);

      yOffset += streamHeight + margin;
    }

    // Draw overall streaming status
    ctx.fillStyle = isStreaming ? '#00f0ff' : '#6b7280';
    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.fillText(
      isStreaming ? `Streaming ${sessionEntries.length} sessions` : 'Not streaming',
      margin,
      height - margin,
    );
  }, [sessionEntries, isStreaming, width, height]);

  const drawStreamTrace = (
    ctx: CanvasRenderingContext2D,
    messages: StreamMessage[],
    x: number,
    y: number,
    w: number,
    h: number,
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
      const dataSize = JSON.stringify((message as any).data ?? '').length;
      const normalizedHeight = Math.min(dataSize / 1000, 1); // Normalize to 0-1
      const plotY = y + h - normalizedHeight * h * 0.8 - h * 0.1;

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
      case 'connected':
      case 'active':
        return '#00f0ff'; // Cyan
      case 'connecting':
      case 'initializing':
        return '#f59e0b'; // Amber
      case 'disconnected':
      case 'paused':
        return '#6b7280'; // Gray
      case 'error':
        return '#ff0055'; // Neon Red
      default:
        return '#6b7280';
    }
  };

  const getMessageTypeColor = (type: string): string => {
    switch (type) {
      case 'stream_start':
        return '#00f0ff'; // Cyan
      case 'stream_data':
        return '#a020f0'; // Purple
      case 'stream_end':
        return '#ff1493'; // Pink
      case 'stream_error':
        return '#ff0055'; // Red
      case 'heartbeat':
        return '#f59e0b'; // Amber
      default:
        return '#6b7280';
    }
  };

  // Redraw on data changes
  useEffect(() => {
    drawStreamingVisualization();
  }, [drawStreamingVisualization]);

  // Build summary stats from store
  const totalMessages = sessionEntries.reduce((acc, [, s]) => acc + s.messages.length, 0);

  return (
    <div className="glass-panel p-4 rounded-xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-primary neon-text">Live Streaming Visualization</h3>
        <div className="flex items-center space-x-2">
          <div
            className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-primary shadow-[0_0_10px_#00f0ff]' : 'bg-gray-600'}`}
          />
          <span className="text-sm text-muted-foreground">{isStreaming ? 'Live' : 'Offline'}</span>
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
        Active sessions: {sessionEntries.length} | Total messages: {totalMessages}
      </div>

      {/* Active sessions preview panel */}
      {sessionEntries.length > 0 && (
        <div className="mt-3 text-xs text-foreground/80 font-mono">
          <div className="font-medium mb-1 text-primary">Active Sessions</div>
          {sessionEntries.map(([sessionId, session]) => {
            const msgs = session.messages as StreamMessage[];
            const last = msgs.length ? msgs[msgs.length - 1] : null;
            const preview = last
              ? typeof (last as any).data === 'object'
                ? JSON.stringify((last as any).data).slice(0, 140)
                : String((last as any).data ?? '').slice(0, 140)
              : 'no messages yet';
            return (
              <div key={sessionId} className="py-1 border-b border-white/5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-secondary">
                    {session.runId ?? sessionId}
                  </div>
                  <div className="text-xs text-muted-foreground">{sessionId.substring(0, 8)}</div>
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
