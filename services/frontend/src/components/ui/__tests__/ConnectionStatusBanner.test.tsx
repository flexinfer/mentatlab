import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionStatusBanner } from '../ConnectionStatusBanner';

// ─────────────────────────────────────────────────────────────────────────────
// Mock streaming store
// ─────────────────────────────────────────────────────────────────────────────

let mockConnectionStatus = 'disconnected';

vi.mock('@/stores', () => ({
  useStreamingStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { connectionStatus: mockConnectionStatus };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ConnectionStatusBanner', () => {
  beforeEach(() => {
    mockConnectionStatus = 'disconnected';
  });

  // ── Visibility ──────────────────────────────────────────────────────────

  it('hides when connected', () => {
    mockConnectionStatus = 'connected';
    const { container } = render(<ConnectionStatusBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('shows when disconnected', () => {
    mockConnectionStatus = 'disconnected';
    render(<ConnectionStatusBanner />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('shows when in error state', () => {
    mockConnectionStatus = 'error';
    render(<ConnectionStatusBanner />);
    expect(screen.getByText('Connection Error')).toBeInTheDocument();
  });

  it('shows when connecting', () => {
    mockConnectionStatus = 'connecting';
    render(<ConnectionStatusBanner />);
    expect(screen.getByText('Connecting')).toBeInTheDocument();
  });

  it('shows when reconnecting', () => {
    mockConnectionStatus = 'reconnecting';
    render(<ConnectionStatusBanner />);
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
  });

  // ── Singleton: only one banner renders ──────────────────────────────────

  it('renders at most one banner element', () => {
    mockConnectionStatus = 'error';
    const { container } = render(<ConnectionStatusBanner onRetry={vi.fn()} />);
    // The component should render exactly one root div (the banner)
    const bannerDivs = container.querySelectorAll(':scope > div');
    expect(bannerDivs).toHaveLength(1);
  });

  it('does not render duplicate banners when re-rendered with same error state', () => {
    mockConnectionStatus = 'error';
    const { container, rerender } = render(<ConnectionStatusBanner onRetry={vi.fn()} />);
    rerender(<ConnectionStatusBanner onRetry={vi.fn()} />);
    const bannerDivs = container.querySelectorAll(':scope > div');
    expect(bannerDivs).toHaveLength(1);
  });

  // ── Retry button ────────────────────────────────────────────────────────

  it('shows retry button in error state when onRetry provided', () => {
    mockConnectionStatus = 'error';
    render(<ConnectionStatusBanner onRetry={vi.fn()} />);
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('shows reconnect button in disconnected state when onRetry provided', () => {
    mockConnectionStatus = 'disconnected';
    render(<ConnectionStatusBanner onRetry={vi.fn()} />);
    expect(screen.getByText('Reconnect')).toBeInTheDocument();
  });

  it('calls onRetry when retry button is clicked', () => {
    mockConnectionStatus = 'error';
    const onRetry = vi.fn();
    render(<ConnectionStatusBanner onRetry={onRetry} />);
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not show retry button when onRetry is not provided', () => {
    mockConnectionStatus = 'error';
    render(<ConnectionStatusBanner />);
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
  });

  it('does not show retry button in connecting state', () => {
    mockConnectionStatus = 'connecting';
    render(<ConnectionStatusBanner onRetry={vi.fn()} />);
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    expect(screen.queryByText('Reconnect')).not.toBeInTheDocument();
  });

  // ── Critical state (no dismiss) ────────────────────────────────────────

  it('does not show dismiss button in error (critical) state', () => {
    mockConnectionStatus = 'error';
    render(<ConnectionStatusBanner />);
    expect(screen.queryByTitle('Dismiss')).not.toBeInTheDocument();
  });

  it('shows dismiss button in non-critical states', () => {
    mockConnectionStatus = 'disconnected';
    render(<ConnectionStatusBanner />);
    expect(screen.getByTitle('Dismiss')).toBeInTheDocument();
  });
});
