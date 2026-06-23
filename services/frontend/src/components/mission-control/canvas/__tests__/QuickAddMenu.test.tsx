import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuickAddMenu } from '../QuickAddMenu';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockCreateNode = vi.hoisted(() => vi.fn());
const mockScreenToFlowPosition = vi.hoisted(() =>
  vi.fn().mockReturnValue({ x: 200, y: 200 })
);
const mockGetViewport = vi.hoisted(() =>
  vi.fn().mockReturnValue({ x: 0, y: 0, zoom: 1 })
);

vi.mock('reactflow', () => ({
  useReactFlow: () => ({
    screenToFlowPosition: mockScreenToFlowPosition,
    getViewport: mockGetViewport,
  }),
}));

vi.mock('@/stores', () => ({
  useCanvasStore: (selector: (s: any) => any) =>
    selector({ createNode: mockCreateNode }),
}));

vi.mock('@/components/ui/Input', () => ({
  Input: React.forwardRef(
    (props: React.InputHTMLAttributes<HTMLInputElement>, ref: React.Ref<HTMLInputElement>) => (
      <input ref={ref} {...props} />
    )
  ),
}));

vi.mock('@/nodes', () => ({
  NODE_TYPES: {
    CHAT: 'chat',
    PYTHON_CODE: 'pythonCode',
    CONDITIONAL: 'conditional',
    FOR_EACH: 'forEach',
    GATE: 'gate',
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('QuickAddMenu', () => {
  let onClose: ReturnType<typeof vi.fn>;
  let onNodeInserted: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn();
    onNodeInserted = vi.fn();
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <QuickAddMenu isOpen={false} onClose={onClose} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the search input when open', () => {
    render(<QuickAddMenu isOpen={true} onClose={onClose} />);
    expect(screen.getByPlaceholderText('Search nodes... (type to filter)')).toBeInTheDocument();
  });

  it('displays default node options when no search query', () => {
    render(<QuickAddMenu isOpen={true} onClose={onClose} />);
    // Should show first 8 options by default
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Python Code')).toBeInTheDocument();
  });

  it('filters options based on search query', () => {
    render(<QuickAddMenu isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Search nodes... (type to filter)');
    fireEvent.change(input, { target: { value: 'Chat' } });
    expect(screen.getByText('Chat')).toBeInTheDocument();
    // Python Code should not match "Chat"
    expect(screen.queryByText('Python Code')).not.toBeInTheDocument();
  });

  it('shows no results message for unmatched search', () => {
    render(<QuickAddMenu isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Search nodes... (type to filter)');
    fireEvent.change(input, { target: { value: 'xyznoexist' } });
    expect(screen.getByText(/No nodes match/)).toBeInTheDocument();
  });

  it('navigates with ArrowDown', () => {
    render(<QuickAddMenu isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Search nodes... (type to filter)');
    // First item should be highlighted initially
    const buttons = screen.getAllByRole('button');
    // ArrowDown should move selection
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // We can check that the second option is highlighted by checking
    // the class of the button elements - the second one should have bg-primary/10
    const allOptions = screen.getAllByRole('button').filter(
      (b) => b.className.includes('w-full')
    );
    if (allOptions.length >= 2) {
      expect(allOptions[1].className).toContain('bg-primary/10');
    }
  });

  it('navigates with ArrowUp', () => {
    render(<QuickAddMenu isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Search nodes... (type to filter)');
    // Move down then back up
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // First item should be highlighted again
    const allOptions = screen.getAllByRole('button').filter(
      (b) => b.className.includes('w-full')
    );
    if (allOptions.length >= 1) {
      expect(allOptions[0].className).toContain('bg-primary/10');
    }
  });

  it('inserts node on Enter and calls callbacks', () => {
    render(
      <QuickAddMenu
        isOpen={true}
        onClose={onClose}
        onNodeInserted={onNodeInserted}
        insertPosition={{ x: 100, y: 100 }}
      />
    );
    const input = screen.getByPlaceholderText('Search nodes... (type to filter)');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockCreateNode).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(onNodeInserted).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    render(<QuickAddMenu isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Search nodes... (type to filter)');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when backdrop is clicked', () => {
    const { container } = render(<QuickAddMenu isOpen={true} onClose={onClose} />);
    // The backdrop is the first fixed div with bg-black/20
    const backdrop = container.querySelector('.fixed.inset-0');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('inserts node on clicking a result item', () => {
    render(
      <QuickAddMenu
        isOpen={true}
        onClose={onClose}
        onNodeInserted={onNodeInserted}
        insertPosition={{ x: 50, y: 50 }}
      />
    );
    // Click on "Chat" option
    fireEvent.click(screen.getByText('Chat'));
    expect(mockCreateNode).toHaveBeenCalledWith('chat', { x: 50, y: 50 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows keyboard navigation hints in footer', () => {
    render(<QuickAddMenu isOpen={true} onClose={onClose} />);
    // The footer has kbd elements for arrow keys, Enter, and Esc
    expect(screen.getByText(/navigate/)).toBeInTheDocument();
    expect(screen.getByText(/insert/)).toBeInTheDocument();
    expect(screen.getByText('Esc')).toBeInTheDocument();
  });

  it('shows category label for each result', () => {
    render(<QuickAddMenu isOpen={true} onClose={onClose} />);
    // Chat is in the "ai" category
    const aiLabels = screen.getAllByText('ai');
    expect(aiLabels.length).toBeGreaterThan(0);
  });

  it('cycles through results with Tab', () => {
    render(<QuickAddMenu isOpen={true} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Search nodes... (type to filter)');
    // Tab should move selection forward
    fireEvent.keyDown(input, { key: 'Tab' });
    const allOptions = screen.getAllByRole('button').filter(
      (b) => b.className.includes('w-full')
    );
    if (allOptions.length >= 2) {
      expect(allOptions[1].className).toContain('bg-primary/10');
    }
  });

  it('uses screenToFlowPosition when no insertPosition given', () => {
    render(
      <QuickAddMenu
        isOpen={true}
        onClose={onClose}
        onNodeInserted={onNodeInserted}
      />
    );
    const input = screen.getByPlaceholderText('Search nodes... (type to filter)');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockScreenToFlowPosition).toHaveBeenCalled();
    expect(mockCreateNode).toHaveBeenCalled();
  });
});
