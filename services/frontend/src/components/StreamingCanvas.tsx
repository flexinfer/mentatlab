/**
 * StreamingCanvas - Real-time flow execution visualization for streaming data
 *
 * Reads session/message data from the streaming store (populated by
 * useStreamingTransport in WorkspaceProvider). No direct HTTP polling or
 * WebSocket management happens here -- this component is a pure consumer.
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';

import { useStreamingStore } from '@/stores/streaming';
import type { StreamMessage } from '@/types/streaming';

interface StreamingCanvasProps {
  width?: number;
  height?: number;
}

export const StreamingCanvas: React.FC<StreamingCanvasProps> = ({
  width,
  height,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({
    width: width ?? 800,
    height: height ?? 600,
  });

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

    const drawWidth = viewportSize.width;
    const drawHeight = viewportSize.height;

    // Clear canvas
    ctx.clearRect(0, 0, drawWidth, drawHeight);

    // Detect dark mode and load theme CSS vars
    const docStyle = window.getComputedStyle(document.documentElement);
    const foregroundVar = (docStyle.getPropertyValue('--foreground') || '').trim();

    // Set up drawing parameters
    const streamHeight = Math.min(drawHeight / Math.max(sessionEntries.length, 1), 120);
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
      ctx.arc(drawWidth - 30, yOffset + 15, 6, 0, 2 * Math.PI);
      ctx.fill();
      // Glow effect
      ctx.shadowBlur = 10;
      ctx.shadowColor = statusColor;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Draw streaming data visualization
      if (messages.length > 0) {
        drawStreamTrace(ctx, messages, margin, yOffset + 30, drawWidth - 2 * margin, streamHeight - 60);
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
      drawHeight - margin,
    );
  }, [sessionEntries, isStreaming, viewportSize.height, viewportSize.width]);

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

  useEffect(() => {
    if (width !== undefined || height !== undefined) {
      setViewportSize((current) => {
        const next = {
          width: width ?? current.width,
          height: height ?? current.height,
        };
        return next.width === current.width && next.height === current.height ? current : next;
      });
      return;
    }

    const element = canvasViewportRef.current;
    if (!element) return;

    const updateViewportSize = () => {
      const nextWidth = Math.max(320, Math.floor(element.clientWidth));
      const nextHeight = Math.max(260, Math.floor(element.clientHeight));
      setViewportSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight }
      );
    };

    updateViewportSize();

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => updateViewportSize());
      resizeObserver.observe(element);
      return () => resizeObserver.disconnect();
    }

    window.addEventListener('resize', updateViewportSize);
    return () => window.removeEventListener('resize', updateViewportSize);
  }, [height, width]);

  // Build summary stats from store
  const totalMessages = sessionEntries.reduce((acc, [, s]) => acc + s.messages.length, 0);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border bg-card/80 p-4 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-primary">Live Streaming Visualization</h3>
        <div className="flex items-center space-x-2">
          <div
            className={`w-3 h-3 rounded-full ${isStreaming ? 'bg-emerald-400' : 'bg-gray-500'}`}
          />
          <span className="text-sm text-muted-foreground">{isStreaming ? 'Live' : 'Offline'}</span>
        </div>
      </div>

      <div ref={canvasViewportRef} className="min-h-[260px] flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/20">
        <canvas
          ref={canvasRef}
          width={viewportSize.width}
          height={viewportSize.height}
          className="h-full w-full bg-[radial-gradient(circle_at_top,rgba(24,40,64,0.45),rgba(2,6,23,0.92))] backdrop-blur-sm"
        />
      </div>

      <div className="mt-2 font-mono text-xs text-muted-foreground">
        Active sessions: {sessionEntries.length} | Total messages: {totalMessages}
      </div>

      {/* Active sessions preview panel */}
      {sessionEntries.length > 0 && (
        <div className="mt-3 max-h-44 overflow-auto font-mono text-xs text-foreground/80">
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
