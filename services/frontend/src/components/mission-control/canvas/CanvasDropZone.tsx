/**
 * CanvasDropZone - Wrapper component that adds node drop functionality
 *
 * Wraps any canvas content and provides visual feedback when nodes are being
 * dragged from the NodePalette. Must be used within a ReactFlowProvider.
 */

import React from 'react';
import { useCanvasDrop } from '@/hooks/useCanvasDrop';

export interface CanvasDropZoneProps {
  /** Canvas content (usually ReactFlow or StreamingCanvas) */
  children: React.ReactNode;
  /** Additional class names */
  className?: string;
  /** Callback when a node is dropped and created */
  onNodeCreated?: (nodeType: string, position: { x: number; y: number }) => void;
}

export function CanvasDropZone({
  children,
  className = '',
  onNodeCreated,
}: CanvasDropZoneProps) {
  const { isDragOver, draggedNodeType, dropProps } = useCanvasDrop({ onNodeCreated });

  return (
    <div
      className={`relative h-full w-full ${className}`}
      {...dropProps}
    >
      {children}

      {/* Drop indicator overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 pointer-events-none border-2 border-dashed border-primary/50 bg-primary/5 rounded-lg flex items-center justify-center">
          <div className="bg-card/90 backdrop-blur px-4 py-2 rounded-lg shadow-lg border">
            <span className="text-sm text-foreground">
              Drop to add{' '}
              <span className="font-semibold text-primary">{draggedNodeType ?? 'node'}</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default CanvasDropZone;
