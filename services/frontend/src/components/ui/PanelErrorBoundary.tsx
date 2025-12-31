import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Panel name for error reporting */
  panelName?: string;
  /** Compact mode for smaller panels */
  compact?: boolean;
  /** Custom error handler */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary designed for Mission Control panels.
 * Provides a compact error UI that fits within panel constraints
 * and allows retry without refreshing the entire page.
 */
export class PanelErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const panelName = this.props.panelName || 'Unknown Panel';
    console.error(`[PanelErrorBoundary] ${panelName} crashed:`, error, errorInfo);

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const { panelName = 'Panel', compact = false } = this.props;
      const errorMessage = this.state.error?.message || 'An unexpected error occurred';

      if (compact) {
        return (
          <div className="flex items-center justify-center h-full p-2 text-xs">
            <div className="flex items-center gap-2 text-red-400">
              <span className="text-red-500">!</span>
              <span className="truncate max-w-[150px]" title={errorMessage}>
                {panelName} error
              </span>
              <button
                onClick={this.handleRetry}
                className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="flex flex-col items-center justify-center h-full p-4 text-center">
          <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center mb-3">
            <svg
              className="w-5 h-5 text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          <h3 className="text-sm font-medium text-white mb-1">
            {panelName} Error
          </h3>

          <p className="text-xs text-muted-foreground mb-3 max-w-[200px] line-clamp-2">
            {errorMessage}
          </p>

          <button
            onClick={this.handleRetry}
            className="px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-xs font-medium transition-colors border border-primary/30"
          >
            Try Again
          </button>

          <details className="mt-3 w-full max-w-[250px]">
            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-white transition-colors">
              Technical Details
            </summary>
            <pre className="mt-2 p-2 rounded bg-black/20 text-[10px] text-left text-red-300 overflow-auto max-h-20">
              {this.state.error?.toString()}
            </pre>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PanelErrorBoundary;
