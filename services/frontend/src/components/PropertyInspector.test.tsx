import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PropertyInspector from './PropertyInspector';
import useStore from '../../src/store'; // Adjust path as necessary

// Mock the useStore hook
vi.mock('../../src/store', () => ({
  default: vi.fn(),
}));

describe('PropertyInspector', () => {
  it('displays a message when no node is selected', () => {
    // Mock the store to return null for selectedNodeId and an empty array for nodes
    (useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector) => {
        const state = {
          selectedNodeId: null,
          nodes: [],
          updateNodeConfig: vi.fn(),
        };
        return selector(state);
      },
    );

    render(<PropertyInspector />);
    expect(screen.getByText('Select a node to configure its properties.')).toBeInTheDocument();
  });
});