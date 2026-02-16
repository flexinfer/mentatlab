import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasDropZone } from '../CanvasDropZone';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockDropReturn = vi.hoisted(() => ({
  isDragOver: false,
  draggedNodeType: null as string | null,
  dropProps: {
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
  },
}));

vi.mock('@/hooks/useCanvasDrop', () => ({
  useCanvasDrop: (_opts?: unknown) => mockDropReturn,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('CanvasDropZone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDropReturn.isDragOver = false;
    mockDropReturn.draggedNodeType = null;
  });

  it('renders children content', () => {
    render(
      <CanvasDropZone>
        <div data-testid="canvas-content">Canvas Here</div>
      </CanvasDropZone>
    );
    expect(screen.getByTestId('canvas-content')).toBeInTheDocument();
  });

  it('does not show drop indicator when not dragging', () => {
    render(
      <CanvasDropZone>
        <span>Content</span>
      </CanvasDropZone>
    );
    expect(screen.queryByText(/Drop to add/)).not.toBeInTheDocument();
  });

  it('shows drop indicator overlay when dragging over', () => {
    mockDropReturn.isDragOver = true;
    mockDropReturn.draggedNodeType = 'chat';
    render(
      <CanvasDropZone>
        <span>Content</span>
      </CanvasDropZone>
    );
    expect(screen.getByText(/Drop to add/)).toBeInTheDocument();
    expect(screen.getByText('chat')).toBeInTheDocument();
  });

  it('shows generic "node" label when draggedNodeType is null', () => {
    mockDropReturn.isDragOver = true;
    mockDropReturn.draggedNodeType = null;
    render(
      <CanvasDropZone>
        <span>Content</span>
      </CanvasDropZone>
    );
    expect(screen.getByText('node')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <CanvasDropZone className="my-class">
        <span>Content</span>
      </CanvasDropZone>
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('my-class');
  });

  it('applies relative positioning and full dimensions', () => {
    const { container } = render(
      <CanvasDropZone>
        <span>Content</span>
      </CanvasDropZone>
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.className).toContain('relative');
    expect(wrapper?.className).toContain('h-full');
    expect(wrapper?.className).toContain('w-full');
  });

  it('drop overlay has pointer-events-none class', () => {
    mockDropReturn.isDragOver = true;
    mockDropReturn.draggedNodeType = 'conditional';
    const { container } = render(
      <CanvasDropZone>
        <span>Content</span>
      </CanvasDropZone>
    );
    const overlay = container.querySelector('.pointer-events-none');
    expect(overlay).toBeTruthy();
  });

  it('renders with different node types in drop indicator', () => {
    mockDropReturn.isDragOver = true;
    mockDropReturn.draggedNodeType = 'pythonCode';
    render(
      <CanvasDropZone>
        <span>Content</span>
      </CanvasDropZone>
    );
    expect(screen.getByText('pythonCode')).toBeInTheDocument();
  });
});
