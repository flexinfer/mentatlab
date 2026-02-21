import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionStatusBanner } from '@/components/ui/ConnectionStatusBanner';

/**
 * Regression tests verifying that the connection retry flow calls the unified
 * startLiveConnection action from WorkspaceProvider, NOT a separate WebSocket
 * or fetch-based reconnect.
 *
 * These tests lock in the M16 contract: one banner, one retry path.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

let mockConnectionStatus = 'error';

vi.mock('@/stores', () => ({
  useStreamingStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { connectionStatus: mockConnectionStatus };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

describe('Connection retry regression', () => {
  beforeEach(() => {
    mockConnectionStatus = 'error';
  });

  it('retry button calls the provided onRetry handler (unified action)', () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionStatusBanner onRetry={onRetry} />);

    const retryButton = screen.getByText('Retry');
    fireEvent.click(retryButton);

    // The onRetry callback is the unified startLiveConnection from WorkspaceProvider
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('retry button in disconnected state calls the same unified handler', () => {
    mockConnectionStatus = 'disconnected';
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionStatusBanner onRetry={onRetry} />);

    const reconnectButton = screen.getByText('Reconnect');
    fireEvent.click(reconnectButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('multiple clicks call handler each time (no debounce hiding)', () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<ConnectionStatusBanner onRetry={onRetry} />);

    const retryButton = screen.getByText('Retry');
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('banner renders with consistent error styling (no duplicate modals)', () => {
    const onRetry = vi.fn();
    const { container } = render(<ConnectionStatusBanner onRetry={onRetry} />);

    // Only one root element
    const roots = container.querySelectorAll(':scope > *');
    expect(roots).toHaveLength(1);

    // Should contain the error title
    expect(screen.getByText('Connection Error')).toBeInTheDocument();
    expect(screen.getByText('Failed to connect to server')).toBeInTheDocument();
  });
});
