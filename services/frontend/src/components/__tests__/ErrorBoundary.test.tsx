import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorBoundary, withErrorBoundary } from '../ErrorBoundary';

function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test error');
  return <div>No error</div>;
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children normally', () => {
    render(
      <ErrorBoundary>
        <div>Safe content</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('Safe content')).toBeInTheDocument();
  });

  it('shows default fallback on error with "Something went wrong" text', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.queryByText('No error')).not.toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText('An unexpected error occurred. Please try refreshing the page.')
    ).toBeInTheDocument();
  });

  it('shows custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback UI</div>}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Custom fallback UI')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('calls onError callback', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('Test error');
    // Second argument is ErrorInfo with componentStack
    expect(onError.mock.calls[0][1]).toHaveProperty('componentStack');
  });

  it('"Try Again" button resets state', () => {
    let shouldThrow = true;

    function ConditionalThrow() {
      if (shouldThrow) throw new Error('Resettable error');
      return <div>Recovered</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Fix the error condition
    shouldThrow = false;
    fireEvent.click(screen.getByText('Try Again'));

    rerender(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('shows error details section', () => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Error Details')).toBeInTheDocument();
  });
});

describe('withErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('wraps component with error boundary', () => {
    function MyComponent() {
      return <div>My Component</div>;
    }

    const WrappedComponent = withErrorBoundary(MyComponent);
    render(<WrappedComponent />);
    expect(screen.getByText('My Component')).toBeInTheDocument();
  });

  it('catches errors from wrapped component', () => {
    function FailingComponent(): React.JSX.Element {
      throw new Error('Wrapped error');
    }

    const WrappedComponent = withErrorBoundary(FailingComponent);
    render(<WrappedComponent />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('uses custom fallback when provided', () => {
    function FailingComponent(): React.JSX.Element {
      throw new Error('Wrapped error');
    }

    const WrappedComponent = withErrorBoundary(
      FailingComponent,
      <div>Custom wrapped fallback</div>
    );
    render(<WrappedComponent />);
    expect(screen.getByText('Custom wrapped fallback')).toBeInTheDocument();
  });

  it('calls onError when provided', () => {
    const onError = vi.fn();

    function FailingComponent(): React.JSX.Element {
      throw new Error('Callback error');
    }

    const WrappedComponent = withErrorBoundary(FailingComponent, undefined, onError);
    render(<WrappedComponent />);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe('Callback error');
  });

  it('sets correct displayName', () => {
    function MyNamedComponent() {
      return <div>Named</div>;
    }

    const WrappedComponent = withErrorBoundary(MyNamedComponent);
    expect(WrappedComponent.displayName).toBe('withErrorBoundary(MyNamedComponent)');
  });
});
