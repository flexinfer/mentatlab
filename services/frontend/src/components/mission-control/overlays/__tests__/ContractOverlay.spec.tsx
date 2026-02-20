import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ToastProvider } from '../../../../contexts/ToastContext';

// Hoisted mocks
const { storeState, mockSetEdges } = vi.hoisted(() => ({
  storeState: {
    nodes: [] as any[],
    edges: [] as any[],
  },
  mockSetEdges: vi.fn(),
}));

// Mock feature flags
vi.mock('../../../../config/features', () => ({
  FeatureFlags: { CONTRACT_OVERLAY: true, CONNECT_WS: false },
  isStreamWorkerEnabled: () => false,
}));

// Mock the Zustand store hook used by the overlay
vi.mock('@/stores', () => ({
  useCanvasStore: (selector: (s: any) => any) => {
    return selector({
      nodes: storeState.nodes,
      edges: storeState.edges,
      setNodes: vi.fn(),
      setEdges: mockSetEdges,
    });
  },
}));

// Mock useAgentSchemas hook (no-op in tests)
vi.mock('@/hooks/useAgentSchemas', () => ({
  useAgentSchemas: () => {},
  default: () => {},
}));

// Mock graph type helpers
vi.mock('../../../../types/graph', () => ({
  isPinMediaType: () => false,
  isPinStreamType: () => false,
}));

import ContractOverlay from '../ContractOverlay';

function renderWithProviders(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('ContractOverlay (integration)', () => {
  beforeEach(() => {
    storeState.nodes = [];
    storeState.edges = [];
    mockSetEdges.mockClear();
  });

  test('renders the overlay dialog with issue count when edges have unknown pin types', () => {
    // Single edge referencing nodes that do not exist -> "Unknown pin type" issue
    storeState.edges = [{ id: 'edge-1', source: 'n1', target: 'n2' }];

    renderWithProviders(<ContractOverlay />);

    // The overlay dialog should appear
    const dialog = screen.getByRole('dialog', { name: /Contract issues/i });
    expect(dialog).toBeTruthy();

    // Issue count badge
    expect(screen.getByTitle(/1 issues/i)).toBeTruthy();

    // The edge id should be visible in the list
    expect(screen.getByText('edge-1')).toBeTruthy();

    // The reason should mention "Unknown pin type"
    expect(screen.getByText(/Unknown pin type/i)).toBeTruthy();
  });

  test('Remove Edge button calls setEdges to remove the problematic edge', () => {
    storeState.edges = [{ id: 'edge-1', source: 'n1', target: 'n2' }];

    renderWithProviders(<ContractOverlay />);

    // Click the "Remove Edge" button
    const removeBtn = screen.getAllByRole('button', { name: /Remove Edge/i })[0];
    fireEvent.click(removeBtn);

    // setEdges should have been called with the edge removed
    expect(mockSetEdges).toHaveBeenCalled();
    const updatedEdges = mockSetEdges.mock.calls[0][0];
    expect(updatedEdges.length).toBe(0);
  });

  test('Dismiss button hides the issue from the visible list', async () => {
    storeState.edges = [
      { id: 'edge-1', source: 'n1', target: 'n2' },
      { id: 'edge-2', source: 'n3', target: 'n4' },
    ];

    renderWithProviders(<ContractOverlay />);

    // Should have 2 issues
    expect(screen.getByTitle(/2 issues/i)).toBeTruthy();
    expect(screen.getByText('edge-1')).toBeTruthy();
    expect(screen.getByText('edge-2')).toBeTruthy();

    // Click Dismiss on the first edge's issue
    const dismissBtns = screen.getAllByRole('button', { name: /Dismiss/i });
    fireEvent.click(dismissBtns[0]);

    // After dismissal, edge-1 should be gone from visible list
    await waitFor(() => expect(screen.queryByText('edge-1')).toBeNull());
    // edge-2 should still be visible
    expect(screen.getByText('edge-2')).toBeTruthy();
  });

  test('enforces 200-item rendering cap when many issues exist', () => {
    // Create 300 edges that reference missing nodes -> 300 issues
    storeState.edges = Array.from({ length: 300 }).map((_, i) => ({
      id: `edge-${i}`,
      source: `s${i}`,
      target: `t${i}`,
    }));

    renderWithProviders(<ContractOverlay />);

    const dialog = screen.getByRole('dialog', { name: /Contract issues/i });
    expect(dialog).toBeTruthy();

    // Query list items within the overlay dialog only
    const listItems = dialog.querySelectorAll('li');
    expect(listItems.length).toBe(200);
  });

  test('returns null when no issues exist', () => {
    storeState.edges = [];
    storeState.nodes = [];

    const { container } = renderWithProviders(<ContractOverlay />);

    // Should not render the dialog
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('listens to lint:trigger and re-renders', async () => {
    storeState.edges = [{ id: 'edge-xyz', source: 'a', target: 'b' }];

    renderWithProviders(<ContractOverlay />);

    // Verify initial render
    expect(screen.getByText('edge-xyz')).toBeTruthy();

    // Dispatch lint:trigger custom event
    window.dispatchEvent(new CustomEvent('lint:trigger'));

    // Should still render (the re-render path was exercised)
    await waitFor(() => {
      expect(screen.getByText('edge-xyz')).toBeTruthy();
    });
  });
});
