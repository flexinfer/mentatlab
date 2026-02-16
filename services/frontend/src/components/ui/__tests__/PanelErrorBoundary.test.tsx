import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PanelErrorBoundary } from '../PanelErrorBoundary';

function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test error');
  return <div>No error</div>;
}

describe('PanelErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when no error', () => {
    render(
      <PanelErrorBoundary panelName="Test Panel">
        <div>Safe content</div>
      </PanelErrorBoundary>
    );
    expect(screen.getByText('Safe content')).toBeInTheDocument();
  });

  it('catches errors and shows error UI with panel name', () => {
    render(
      <PanelErrorBoundary panelName="Console">
        <ThrowError shouldThrow={true} />
      </PanelErrorBoundary>
    );
    expect(screen.queryByText('No error')).not.toBeInTheDocument();
    expect(screen.getByText('Console Error')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('shows compact error UI when compact=true', () => {
    render(
      <PanelErrorBoundary panelName="Timeline" compact>
        <ThrowError shouldThrow={true} />
      </PanelErrorBoundary>
    );
    expect(screen.getByText('Timeline error')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    // Should not show the larger non-compact UI elements
    expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
  });

  it('retry button resets error state and renders children again', () => {
    let shouldThrow = true;

    function ConditionalThrow() {
      if (shouldThrow) throw new Error('Conditional error');
      return <div>Recovered</div>;
    }

    const { rerender } = render(
      <PanelErrorBoundary panelName="Test">
        <ConditionalThrow />
      </PanelErrorBoundary>
    );

    expect(screen.getByText('Test Error')).toBeInTheDocument();

    // Fix the error condition before retrying
    shouldThrow = false;
    fireEvent.click(screen.getByText('Try Again'));

    // Force rerender to pick up new shouldThrow
    rerender(
      <PanelErrorBoundary panelName="Test">
        <ConditionalThrow />
      </PanelErrorBoundary>
    );

    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('calls onError callback', () => {
    const onError = vi.fn();
    render(
      <PanelErrorBoundary panelName="Metrics" onError={onError}>
        <ThrowError shouldThrow={true} />
      </PanelErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('Test error');
  });

  it('shows technical details in expandable section', () => {
    render(
      <PanelErrorBoundary panelName="Details">
        <ThrowError shouldThrow={true} />
      </PanelErrorBoundary>
    );
    expect(screen.getByText('Technical Details')).toBeInTheDocument();
    // The details element contains the error string
    expect(screen.getByText(/Error: Test error/)).toBeInTheDocument();
  });
});
