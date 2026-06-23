import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks
const { mockLineage } = vi.hoisted(() => ({
  mockLineage: {
    buildGraph: vi.fn(),
    getProvenance: vi.fn(),
  },
}));

// Mock services
vi.mock('@/services/mission-control/services', () => ({
  lineage: mockLineage,
}));

// Mock cn utility
vi.mock('@/lib/cn', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

// Mock Badge
vi.mock('@/components/ui/Badge', () => ({
  __esModule: true,
  default: ({ children, variant }: any) => (
    <span data-testid={`badge-${variant || 'default'}`}>{children}</span>
  ),
  Badge: ({ children, variant }: any) => (
    <span data-testid={`badge-${variant || 'default'}`}>{children}</span>
  ),
}));

import LineageOverlay from '../LineageOverlay';

// Helper data
function makeGraph(nodeCount = 3) {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `artifact-${i}`,
    type: i === 0 ? 'input' : i === nodeCount - 1 ? 'output' : 'intermediate',
    nodePin: `node${i}.output`,
    meta: { bytes: 1024 * (i + 1), createdAt: '2026-01-15T10:00:00Z', mimeType: 'application/json' },
  }));
  const edges = nodeCount > 1
    ? [{ from: 'node0.output', to: 'node1.input', artifactId: 'artifact-0', meta: { bytes: 2048 } }]
    : [];
  return {
    nodes,
    edges,
    roots: ['artifact-0'],
    leaves: [`artifact-${nodeCount - 1}`],
  };
}

describe('LineageOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLineage.buildGraph.mockReturnValue(makeGraph());
    mockLineage.getProvenance.mockReturnValue({
      artifact: { id: 'artifact-0', type: 'input', nodePin: 'node0.output', meta: {} },
      ancestors: [],
      descendants: [],
    });
  });

  test('shows "no lineage data" message when runId is null', () => {
    render(<LineageOverlay runId={null} onClose={vi.fn()} />);
    expect(screen.getByText(/No lineage data available/)).toBeTruthy();
  });

  test('shows Close button in no-data state', () => {
    const onClose = vi.fn();
    render(<LineageOverlay runId={null} onClose={onClose} />);
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('renders Artifact Lineage header when graph is loaded', () => {
    render(<LineageOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('Artifact Lineage')).toBeTruthy();
  });

  test('renders Full Graph and Provenance view toggles', () => {
    render(<LineageOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('Full Graph')).toBeTruthy();
    expect(screen.getByText('Provenance')).toBeTruthy();
  });

  test('renders close button with aria-label', () => {
    const onClose = vi.fn();
    render(<LineageOverlay runId="run-1" onClose={onClose} />);
    const closeBtn = screen.getByLabelText('Close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('closes when clicking backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(<LineageOverlay runId="run-1" onClose={onClose} />);
    // Click the outer backdrop div (first child)
    const backdrop = container.firstElementChild;
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('does not close when clicking dialog content', () => {
    const onClose = vi.fn();
    render(<LineageOverlay runId="run-1" onClose={onClose} />);
    // Click on dialog header text (should not bubble to backdrop)
    fireEvent.click(screen.getByText('Artifact Lineage'));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('shows artifact count in footer', () => {
    mockLineage.buildGraph.mockReturnValue(makeGraph(5));
    render(<LineageOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('5')).toBeTruthy(); // 5 artifacts
  });

  test('shows transformation count in footer', () => {
    const graph = makeGraph(3);
    graph.edges = [
      { from: 'a.out', to: 'b.in', artifactId: 'x' },
      { from: 'b.out', to: 'c.in', artifactId: 'y' },
    ];
    mockLineage.buildGraph.mockReturnValue(graph);
    render(<LineageOverlay runId="run-1" onClose={vi.fn()} />);
    // Footer shows "2 transformations"
    const footer = screen.getByText(/transformations/);
    expect(footer).toBeTruthy();
  });

  test('shows truncated run ID in footer', () => {
    render(<LineageOverlay runId="abcdefghijklmnop" onClose={vi.fn()} />);
    expect(screen.getByText(/Run ID: abcdefgh\.\.\./)).toBeTruthy();
  });

  test('displays Input badge for input artifacts', () => {
    render(<LineageOverlay runId="run-1" onClose={vi.fn()} />);
    const infoBadges = screen.getAllByTestId('badge-info');
    expect(infoBadges.length).toBeGreaterThan(0);
  });

  test('displays Output badge for output artifacts', () => {
    render(<LineageOverlay runId="run-1" onClose={vi.fn()} />);
    const successBadges = screen.getAllByTestId('badge-success');
    expect(successBadges.length).toBeGreaterThan(0);
  });

  test('switches to Provenance view when button clicked', async () => {
    mockLineage.getProvenance.mockReturnValue({
      artifact: { id: 'artifact-0', type: 'input', nodePin: 'node0.output', meta: {} },
      ancestors: [],
      descendants: [],
    });

    render(<LineageOverlay runId="run-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Provenance'));

    await waitFor(() => {
      expect(screen.getByText('Selected Artifact')).toBeTruthy();
    });
  });

  test('shows root message for artifacts with no ancestors', async () => {
    mockLineage.getProvenance.mockReturnValue({
      artifact: { id: 'artifact-0', type: 'input', nodePin: 'node0.output', meta: {} },
      ancestors: [],
      descendants: [],
    });

    render(<LineageOverlay runId="run-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Provenance'));

    await waitFor(() => {
      expect(screen.getByText(/no parent artifacts/)).toBeTruthy();
    });
  });

  test('shows leaf message for artifacts with no descendants', async () => {
    mockLineage.getProvenance.mockReturnValue({
      artifact: { id: 'artifact-0', type: 'input', nodePin: 'node0.output', meta: {} },
      ancestors: [],
      descendants: [],
    });

    render(<LineageOverlay runId="run-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Provenance'));

    await waitFor(() => {
      expect(screen.getByText(/no child artifacts/)).toBeTruthy();
    });
  });

  test('auto-selects first artifact when loaded', () => {
    const graph = makeGraph(2);
    mockLineage.buildGraph.mockReturnValue(graph);
    render(<LineageOverlay runId="run-1" onClose={vi.fn()} />);
    // The getProvenance should be called with first artifact
    expect(mockLineage.getProvenance).toHaveBeenCalledWith('run-1', 'artifact-0');
  });

  test('uses selectedArtifactId prop when provided', () => {
    const graph = makeGraph(3);
    mockLineage.buildGraph.mockReturnValue(graph);
    render(<LineageOverlay runId="run-1" selectedArtifactId="artifact-2" onClose={vi.fn()} />);
    expect(mockLineage.getProvenance).toHaveBeenCalledWith('run-1', 'artifact-2');
  });

  test('switches to Provenance view when selectedArtifactId changes', () => {
    const graph = makeGraph(3);
    mockLineage.buildGraph.mockReturnValue(graph);

    const { rerender } = render(
      <LineageOverlay runId="run-1" selectedArtifactId={null} onClose={vi.fn()} />
    );

    // Rerender with new artifact selected
    rerender(
      <LineageOverlay runId="run-1" selectedArtifactId="artifact-1" onClose={vi.fn()} />
    );

    // Provenance should be fetched for new artifact
    expect(mockLineage.getProvenance).toHaveBeenCalledWith('run-1', 'artifact-1');
  });
});
