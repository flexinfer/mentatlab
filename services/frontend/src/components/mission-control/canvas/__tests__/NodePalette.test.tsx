import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NodePalette } from '../NodePalette';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/components/ui/Input', () => ({
  Input: React.forwardRef(
    (props: React.InputHTMLAttributes<HTMLInputElement>, ref: React.Ref<HTMLInputElement>) => (
      <input ref={ref} {...props} />
    )
  ),
}));

// Mock NODE_TYPES from @/nodes to provide the type strings
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

describe('NodePalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network disabled in tests');
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders expanded palette with header', () => {
    render(<NodePalette />);
    expect(screen.getByText('Nodes')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<NodePalette />);
    expect(screen.getByPlaceholderText('Search nodes...')).toBeInTheDocument();
  });

  it('renders category sections', () => {
    render(<NodePalette />);
    // Check for some expected category labels
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toBeInTheDocument();
  });

  it('renders node items with labels in expanded categories', () => {
    render(<NodePalette />);
    // Input category (3 nodes <= 5, so expanded by default)
    expect(screen.getByText('Media Upload')).toBeInTheDocument();
    // Processing (3 nodes <= 5)
    expect(screen.getByText('Python Code')).toBeInTheDocument();
    // Logic (2 nodes <= 5)
    expect(screen.getByText('Conditional')).toBeInTheDocument();
  });

  it('filters nodes based on search term', () => {
    render(<NodePalette />);
    const searchInput = screen.getByPlaceholderText('Search nodes...');
    // Search for "Conditional" which is in the Logic category (expanded by default)
    fireEvent.change(searchInput, { target: { value: 'Conditional' } });
    expect(screen.getByText('Conditional')).toBeInTheDocument();
    // Other nodes from expanded categories should be hidden
    expect(screen.queryByText('Media Upload')).not.toBeInTheDocument();
    expect(screen.queryByText('For Each')).not.toBeInTheDocument();
  });

  it('shows no match message when search has no results', () => {
    render(<NodePalette />);
    const searchInput = screen.getByPlaceholderText('Search nodes...');
    fireEvent.change(searchInput, { target: { value: 'xyznonexistent' } });
    expect(screen.getByText(/No nodes match/)).toBeInTheDocument();
  });

  it('renders collapsed state when collapsed prop is true', () => {
    render(<NodePalette collapsed={true} />);
    expect(screen.queryByText('Nodes')).not.toBeInTheDocument();
    expect(screen.getByTitle('Expand node palette')).toBeInTheDocument();
  });

  it('calls onToggleCollapse when expand button is clicked in collapsed state', () => {
    const onToggle = vi.fn();
    render(<NodePalette collapsed={true} onToggleCollapse={onToggle} />);
    fireEvent.click(screen.getByTitle('Expand node palette'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleCollapse when collapse button is clicked in expanded state', () => {
    const onToggle = vi.fn();
    render(<NodePalette onToggleCollapse={onToggle} />);
    fireEvent.click(screen.getByTitle('Collapse palette'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not show collapse button when onToggleCollapse is not provided', () => {
    render(<NodePalette />);
    expect(screen.queryByTitle('Collapse palette')).not.toBeInTheDocument();
  });

  it('renders footer with keyboard hint', () => {
    render(<NodePalette />);
    expect(screen.getByText(/Drag nodes to canvas/)).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<NodePalette className="custom-palette" />);
    const paletteDiv = container.firstElementChild;
    expect(paletteDiv?.className).toContain('custom-palette');
  });

  it('toggles category section expansion on click', () => {
    render(<NodePalette />);
    // Logic category should have Conditional node
    const logicBtn = screen.getByText('Logic');
    expect(screen.getByText('Conditional')).toBeInTheDocument();

    // Click to collapse the Logic category
    fireEvent.click(logicBtn);
    // Now Conditional should be hidden
    expect(screen.queryByText('Conditional')).not.toBeInTheDocument();

    // Click to expand again
    fireEvent.click(logicBtn);
    expect(screen.getByText('Conditional')).toBeInTheDocument();
  });

  it('shows category node counts', () => {
    render(<NodePalette />);
    // Logic category has 2 nodes (Conditional, For Each)
    // Multiple categories may share the same count, so use getAllByText
    const counts = screen.getAllByText('(2)');
    expect(counts.length).toBeGreaterThan(0);
  });

  it('calls onNodeDragStart when a node item is dragged', () => {
    const onDragStart = vi.fn();
    render(<NodePalette onNodeDragStart={onDragStart} />);

    // Use a node from an expanded category (Logic: Conditional is expanded)
    const condNode = screen.getByText('Conditional').closest('[draggable]');
    expect(condNode).toBeTruthy();

    // Simulate dragstart
    fireEvent.dragStart(condNode!, {
      dataTransfer: {
        setData: vi.fn(),
        effectAllowed: '',
      },
    });
    expect(onDragStart).toHaveBeenCalledWith('conditional');
  });

  it('sets correct data transfer type on drag start', () => {
    const setDataMock = vi.fn();
    render(<NodePalette />);

    // Use Media Upload from Input category (expanded by default)
    const uploadNode = screen.getByText('Media Upload').closest('[draggable]');
    fireEvent.dragStart(uploadNode!, {
      dataTransfer: {
        setData: setDataMock,
        effectAllowed: '',
      },
    });
    expect(setDataMock).toHaveBeenCalledWith('application/reactflow', 'media:upload');
  });

  it('loads MCP tools and groups them by server category', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('unsupported scheme'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tools: [
            {
              name: 'k8s_apps_k3s__k8s_get',
              server: 'k8s_apps_k3s',
              description: 'Get Kubernetes resources',
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<NodePalette />);

    await waitFor(() => {
      expect(screen.getByText('MCP · K8s Apps K3s')).toBeInTheDocument();
      expect(screen.getByText('K8s Get')).toBeInTheDocument();
    });
  });

  it('attaches MCP tool metadata to drag payload', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('unsupported scheme'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tools: [
            {
              name: 'k8s_apps_k3s__k8s_get',
              server: 'k8s_apps_k3s',
              description: 'Get Kubernetes resources',
              inputSchema: {
                type: 'object',
                properties: {
                  namespace: { type: 'string' },
                },
              },
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    render(<NodePalette />);

    await waitFor(() => {
      expect(screen.getByText('K8s Get')).toBeInTheDocument();
    });

    const mcpNode = screen.getByText('K8s Get').closest('[draggable]');
    const setDataMock = vi.fn();
    fireEvent.dragStart(mcpNode!, {
      dataTransfer: {
        setData: setDataMock,
        effectAllowed: '',
      },
    });

    expect(setDataMock).toHaveBeenCalledWith('application/reactflow', 'mcp:k8s_apps_k3s__k8s_get');
    expect(setDataMock).toHaveBeenCalledWith(
      'application/reactflow-metadata',
      expect.stringContaining('"agent_id":"loom-mcp-executor"')
    );
    expect(setDataMock).toHaveBeenCalledWith(
      'application/reactflow-metadata',
      expect.stringContaining('"tool_name":"k8s_apps_k3s__k8s_get"')
    );
  });
});
