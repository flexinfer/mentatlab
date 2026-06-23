import React from 'react';
import { useStreamingStore } from '@/stores';
import { StreamConnectionState } from '../../types/streaming';
import { cn } from '@/lib/utils';

interface ConnectionStatusBannerProps {
  /** Called when user clicks retry */
  onRetry?: () => void;
  /** Show only when disconnected/error (hide when connected) */
  hideWhenConnected?: boolean;
  /** Optional className for layout-aware placement */
  className?: string;
}

/**
 * A banner that shows connection status and provides retry functionality.
 * Shows prominently when connection is lost or errored.
 */
export function ConnectionStatusBanner({
  onRetry,
  hideWhenConnected = true,
  className,
}: ConnectionStatusBannerProps) {
  const connectionStatus = useStreamingStore((s) => s.connectionStatus);
  const [dismissed, setDismissed] = React.useState(false);

  // Reset dismissed state when connection status changes
  React.useEffect(() => {
    setDismissed(false);
  }, [connectionStatus]);

  // Hide when connected if requested
  if (hideWhenConnected && connectionStatus === StreamConnectionState.CONNECTED) {
    return null;
  }

  const statusConfig = getStatusConfig(connectionStatus);

  if (!statusConfig.show || dismissed) {
    return null;
  }

  return (
    <div
      role={statusConfig.critical ? 'alert' : 'status'}
      aria-live={statusConfig.critical ? 'assertive' : 'polite'}
      className={cn(
        'mc-shell relative z-20 flex flex-wrap items-center gap-3 rounded-md px-4 py-2.5 animate-in slide-in-from-top-2 duration-200',
        statusConfig.bgClass,
        className,
      )}
      data-testid="connection-status-banner"
    >
      {/* Status indicator */}
      <div className="flex items-center gap-2">
        {statusConfig.icon}
        <span className={`text-sm font-medium ${statusConfig.textClass}`}>
          {statusConfig.title}
        </span>
      </div>

      {/* Message */}
      <span className="text-xs text-muted-foreground">
        {statusConfig.message}
      </span>

      {/* Retry button */}
      {onRetry && statusConfig.showRetry && (
        <button
          onClick={onRetry}
          className={`
            ml-2 px-3 py-1 rounded-md text-xs font-medium
            transition-colors
            ${statusConfig.buttonClass}
          `}
        >
          {statusConfig.buttonText}
        </button>
      )}

      {/* Dismiss for non-critical states */}
      {!statusConfig.critical && (
        <button
          onClick={() => setDismissed(true)}
          className="ml-1 rounded p-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          title="Dismiss"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

interface StatusConfig {
  show: boolean;
  critical: boolean;
  showRetry: boolean;
  title: string;
  message: string;
  buttonText: string;
  icon: React.ReactNode;
  bgClass: string;
  textClass: string;
  buttonClass: string;
}

function getStatusConfig(status: StreamConnectionState): StatusConfig {
  switch (status) {
    case StreamConnectionState.DISCONNECTED:
      return {
        show: true,
        critical: false,
        showRetry: true,
        title: 'Disconnected',
        message: 'Connection to server lost',
        buttonText: 'Reconnect',
        icon: <DisconnectedIcon />,
        bgClass: 'bg-zinc-950/90',
        textClass: 'text-zinc-100',
        buttonClass: 'bg-muted/80 hover:bg-muted text-foreground',
      };

    case StreamConnectionState.CONNECTING:
      return {
        show: true,
        critical: false,
        showRetry: false,
        title: 'Connecting',
        message: 'Establishing connection...',
        buttonText: '',
        icon: <SpinnerIcon />,
        bgClass: 'bg-sky-950/90',
        textClass: 'text-sky-100',
        buttonClass: '',
      };

    case StreamConnectionState.RECONNECTING:
      return {
        show: true,
        critical: false,
        showRetry: false,
        title: 'Reconnecting',
        message: 'Attempting to restore connection...',
        buttonText: '',
        icon: <SpinnerIcon />,
        bgClass: 'bg-amber-950/90',
        textClass: 'text-amber-100',
        buttonClass: '',
      };

    case StreamConnectionState.ERROR:
      return {
        show: true,
        critical: true,
        showRetry: true,
        title: 'Connection Error',
        message: 'Failed to connect to server',
        buttonText: 'Retry',
        icon: <ErrorIcon />,
        bgClass: 'bg-red-950/90',
        textClass: 'text-red-100',
        buttonClass: 'bg-red-500/20 hover:bg-red-500/30 text-red-50 border border-red-500/30',
      };

    case StreamConnectionState.CONNECTED:
    default:
      return {
        show: false,
        critical: false,
        showRetry: false,
        title: '',
        message: '',
        buttonText: '',
        icon: null,
        bgClass: '',
        textClass: '',
        buttonClass: '',
      };
  }
}

function DisconnectedIcon() {
  return (
    <svg className="w-4 h-4 text-zinc-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
      />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="w-4 h-4 animate-spin text-current" fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="w-4 h-4 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

export default ConnectionStatusBanner;
