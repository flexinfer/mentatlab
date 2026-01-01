/**
 * Save Status Indicator - Shows auto-save status in the UI
 *
 * Displays:
 * - Saving spinner when actively saving
 * - Checkmark when saved
 * - Warning icon on error
 * - Last saved timestamp
 */

import React from 'react';
import { useAutoSave, SaveStatus } from '@/hooks/useAutoSave';

interface SaveStatusIndicatorProps {
  /** Whether auto-save is enabled */
  enabled?: boolean;
  /** Compact mode (icon only) */
  compact?: boolean;
  /** Custom class name */
  className?: string;
}

export function SaveStatusIndicator({
  enabled = true,
  compact = false,
  className = '',
}: SaveStatusIndicatorProps) {
  const { status, lastSavedAt, pendingChanges, error, saveNow } = useAutoSave({
    enabled,
    debounceMs: 1500,
  });

  const statusConfig = getStatusConfig(status, pendingChanges);

  return (
    <div
      className={`inline-flex items-center gap-1.5 text-xs ${className}`}
      title={error?.message || statusConfig.tooltip}
    >
      {/* Status Icon */}
      <span className={`flex-shrink-0 ${statusConfig.iconClass}`}>
        {statusConfig.icon}
      </span>

      {/* Status Text (hidden in compact mode) */}
      {!compact && (
        <span className={statusConfig.textClass}>
          {statusConfig.text}
          {status === 'idle' && lastSavedAt && (
            <span className="text-muted-foreground ml-1">
              · {formatRelativeTime(lastSavedAt)}
            </span>
          )}
        </span>
      )}

      {/* Manual Save Button (shown on error) */}
      {status === 'error' && !compact && (
        <button
          onClick={saveNow}
          className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

interface StatusConfig {
  icon: React.ReactNode;
  iconClass: string;
  text: string;
  textClass: string;
  tooltip: string;
}

function getStatusConfig(status: SaveStatus, pendingChanges: boolean): StatusConfig {
  // Pending changes indicator
  if (pendingChanges && status !== 'saving') {
    return {
      icon: <CircleIcon />,
      iconClass: 'text-amber-500',
      text: 'Unsaved changes',
      textClass: 'text-amber-600 dark:text-amber-400',
      tooltip: 'Changes will be saved automatically',
    };
  }

  switch (status) {
    case 'saving':
      return {
        icon: <SpinnerIcon />,
        iconClass: 'text-primary animate-spin',
        text: 'Saving...',
        textClass: 'text-primary',
        tooltip: 'Saving changes to server',
      };

    case 'saved':
      return {
        icon: <CheckIcon />,
        iconClass: 'text-emerald-500',
        text: 'Saved',
        textClass: 'text-emerald-600 dark:text-emerald-400',
        tooltip: 'All changes saved',
      };

    case 'error':
      return {
        icon: <WarningIcon />,
        iconClass: 'text-red-500',
        text: 'Save failed',
        textClass: 'text-red-600 dark:text-red-400',
        tooltip: 'Failed to save changes. Click to retry.',
      };

    case 'conflict':
      return {
        icon: <ConflictIcon />,
        iconClass: 'text-amber-500',
        text: 'Conflict',
        textClass: 'text-amber-600 dark:text-amber-400',
        tooltip: 'Flow was modified on server. Please refresh.',
      };

    default:
      return {
        icon: <CloudIcon />,
        iconClass: 'text-muted-foreground',
        text: 'Auto-save on',
        textClass: 'text-muted-foreground',
        tooltip: 'Changes are saved automatically',
      };
  }
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return date.toLocaleDateString();
}

// Simple SVG Icons
function SpinnerIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
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
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

function ConflictIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
      />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 8 8">
      <circle cx="4" cy="4" r="4" />
    </svg>
  );
}

export default SaveStatusIndicator;
