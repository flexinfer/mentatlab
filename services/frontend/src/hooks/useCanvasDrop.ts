/**
 * useCanvasDrop - Hook for handling node drops from NodePalette onto ReactFlow canvas
 *
 * This hook provides handlers for drag-and-drop interactions between the NodePalette
 * and the ReactFlow canvas. When a node is dragged from the palette and dropped on
 * the canvas, it converts the screen position to flow coordinates and creates a new node.
 */

import { useCallback, useState } from 'react';
import { useReactFlow } from 'reactflow';
import { useCanvasStore } from '@/stores';

// MIME type for ReactFlow drag data
const REACTFLOW_MIME_TYPE = 'application/reactflow';

export interface UseCanvasDropOptions {
  /** Callback when a node is successfully created */
  onNodeCreated?: (nodeType: string, position: { x: number; y: number }) => void;
}

export interface UseCanvasDropReturn {
  /** Whether a node is currently being dragged over the canvas */
  isDragOver: boolean;
  /** The type of node being dragged (if any) */
  draggedNodeType: string | null;
  /** Handler for dragover events - prevents default to allow drop */
  onDragOver: (event: React.DragEvent) => void;
  /** Handler for dragleave events - resets drag state */
  onDragLeave: (event: React.DragEvent) => void;
  /** Handler for drop events - creates the node at drop position */
  onDrop: (event: React.DragEvent) => void;
  /** Props to spread on the drop target element */
  dropProps: {
    onDragOver: (event: React.DragEvent) => void;
    onDragLeave: (event: React.DragEvent) => void;
    onDrop: (event: React.DragEvent) => void;
  };
}

/**
 * Hook for handling node drops from NodePalette onto ReactFlow canvas
 */
export function useCanvasDrop(options: UseCanvasDropOptions = {}): UseCanvasDropReturn {
  const { onNodeCreated } = options;
  const [isDragOver, setIsDragOver] = useState(false);
  const [draggedNodeType, setDraggedNodeType] = useState<string | null>(null);

  // Get ReactFlow instance for coordinate conversion
  const reactFlowInstance = useReactFlow();
  const createNode = useCanvasStore((state) => state.createNode);

  /**
   * Handle drag over - must call preventDefault to allow drops
   */
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (!isDragOver) {
      setIsDragOver(true);
    }

    // Try to read the node type from the drag data
    const nodeType = event.dataTransfer.types.includes(REACTFLOW_MIME_TYPE)
      ? event.dataTransfer.getData(REACTFLOW_MIME_TYPE)
      : null;

    if (nodeType && nodeType !== draggedNodeType) {
      setDraggedNodeType(nodeType);
    }
  }, [isDragOver, draggedNodeType]);

  /**
   * Handle drag leave - reset state
   */
  const onDragLeave = useCallback((event: React.DragEvent) => {
    // Only reset if we're actually leaving the drop zone (not entering a child)
    const relatedTarget = event.relatedTarget as HTMLElement | null;
    const currentTarget = event.currentTarget as HTMLElement;

    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      setIsDragOver(false);
      setDraggedNodeType(null);
    }
  }, []);

  /**
   * Handle drop - create node at drop position
   */
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    setDraggedNodeType(null);

    // Get the node type from the drag data
    const nodeType = event.dataTransfer.getData(REACTFLOW_MIME_TYPE);
    if (!nodeType) {
      console.warn('[useCanvasDrop] No node type in drag data');
      return;
    }

    // Convert screen coordinates to flow coordinates
    // Get the canvas element bounds
    const canvasBounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const screenX = event.clientX - canvasBounds.left;
    const screenY = event.clientY - canvasBounds.top;

    // Convert to flow coordinates using ReactFlow's API
    const flowPosition = reactFlowInstance.screenToFlowPosition({
      x: screenX,
      y: screenY,
    });

    // Create the node
    createNode(nodeType, flowPosition);

    // Notify callback
    onNodeCreated?.(nodeType, flowPosition);

    console.debug('[useCanvasDrop] Created node:', { nodeType, flowPosition });
  }, [reactFlowInstance, createNode, onNodeCreated]);

  return {
    isDragOver,
    draggedNodeType,
    onDragOver,
    onDragLeave,
    onDrop,
    dropProps: {
      onDragOver,
      onDragLeave,
      onDrop,
    },
  };
}

export default useCanvasDrop;
