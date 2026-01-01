/**
 * Auto-Save Hook - Automatically syncs flow changes to backend
 *
 * Features:
 * - Debounced saves (prevents excessive API calls)
 * - Tracks save status (idle, saving, saved, error)
 * - Retries on failure with exponential backoff
 * - Conflict detection (server version newer)
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useFlowStore } from '../store/index';
import { FlowService, Flow, CreateFlowRequest, getFlowService } from '../services/api/flowService';
import { httpClient } from '../services/api/httpClient';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

export interface AutoSaveOptions {
  /** Debounce delay in milliseconds (default: 1000) */
  debounceMs?: number;
  /** Whether auto-save is enabled (default: true) */
  enabled?: boolean;
  /** Callback when save completes */
  onSave?: (flowId: string) => void;
  /** Callback when save fails */
  onError?: (error: Error, flowId: string) => void;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
}

export interface AutoSaveState {
  status: SaveStatus;
  lastSavedAt: Date | null;
  pendingChanges: boolean;
  error: Error | null;
  /** Manually trigger save */
  saveNow: () => Promise<void>;
}

/**
 * Hook to automatically save flow changes to backend
 */
export function useAutoSave(options: AutoSaveOptions = {}): AutoSaveState {
  const {
    debounceMs = 1000,
    enabled = true,
    onSave,
    onError,
    maxRetries = 3,
  } = options;

  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [pendingChanges, setPendingChanges] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Refs for debouncing and tracking
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flowServiceRef = useRef<FlowService | null>(null);
  const lastSavedVersionRef = useRef<Map<string, string>>(new Map());
  const retryCountRef = useRef<Map<string, number>>(new Map());

  // Initialize flow service
  useEffect(() => {
    flowServiceRef.current = getFlowService(httpClient, null);
  }, []);

  // Convert store flow to API format
  const toApiFlow = useCallback((flowId: string, flowData: any): CreateFlowRequest => {
    return {
      id: flowId,
      name: flowData?.name || flowData?.meta?.name || 'Untitled Flow',
      description: flowData?.description || flowData?.meta?.description,
      graph: {
        nodes: flowData?.graph?.nodes || [],
        edges: flowData?.graph?.edges || [],
      },
      layout: flowData?.layout,
      metadata: {
        ...flowData?.metadata,
        lastModifiedLocally: new Date().toISOString(),
      },
    };
  }, []);

  // Save a single flow
  const saveFlow = useCallback(async (flowId: string, flowData: any): Promise<boolean> => {
    if (!flowServiceRef.current) return false;

    const retryCount = retryCountRef.current.get(flowId) || 0;

    try {
      const apiFlow = toApiFlow(flowId, flowData);
      const saved = await flowServiceRef.current.saveFlow(apiFlow);

      // Update last saved version
      lastSavedVersionRef.current.set(flowId, saved.updated_at);
      retryCountRef.current.set(flowId, 0);

      return true;
    } catch (err) {
      const error = err as Error;

      // Check for conflict (409) or version mismatch
      if ((error as any).status === 409) {
        setStatus('conflict');
        setError(new Error('Flow was modified on server. Please refresh.'));
        return false;
      }

      // Retry with exponential backoff
      if (retryCount < maxRetries) {
        retryCountRef.current.set(flowId, retryCount + 1);
        const delay = Math.pow(2, retryCount) * 500; // 500ms, 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay));
        return saveFlow(flowId, flowData);
      }

      throw error;
    }
  }, [toApiFlow, maxRetries]);

  // Save all pending flows
  const saveAllFlows = useCallback(async () => {
    const flows = useFlowStore.getState().flows;
    if (flows.size === 0) return;

    setStatus('saving');
    setError(null);
    setPendingChanges(false);

    const errors: Array<{ flowId: string; error: Error }> = [];

    for (const [flowId, flowData] of flows.entries()) {
      try {
        await saveFlow(flowId, flowData);
        onSave?.(flowId);
      } catch (err) {
        const error = err as Error;
        errors.push({ flowId, error });
        onError?.(error, flowId);
      }
    }

    if (errors.length > 0) {
      setStatus('error');
      setError(errors[0].error);
    } else {
      setStatus('saved');
      setLastSavedAt(new Date());

      // Reset to idle after a brief display of "saved"
      setTimeout(() => {
        setStatus((current) => (current === 'saved' ? 'idle' : current));
      }, 2000);
    }
  }, [saveFlow, onSave, onError]);

  // Debounced save trigger
  const triggerSave = useCallback(() => {
    if (!enabled) return;

    setPendingChanges(true);

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new debounce timer
    debounceTimerRef.current = setTimeout(() => {
      saveAllFlows();
    }, debounceMs);
  }, [enabled, debounceMs, saveAllFlows]);

  // Subscribe to flow store changes
  useEffect(() => {
    if (!enabled) return;

    // Use subscribeWithSelector to watch for flow changes
    const unsubscribe = useFlowStore.subscribe(
      (state) => state.flows,
      (flows, previousFlows) => {
        // Check if flows actually changed (not just reference)
        if (flows === previousFlows) return;

        // Check for actual content changes
        let hasChanges = false;
        if (flows.size !== previousFlows.size) {
          hasChanges = true;
        } else {
          for (const [id, flow] of flows.entries()) {
            const prevFlow = previousFlows.get(id);
            if (!prevFlow || JSON.stringify(flow) !== JSON.stringify(prevFlow)) {
              hasChanges = true;
              break;
            }
          }
        }

        if (hasChanges) {
          triggerSave();
        }
      },
      { fireImmediately: false }
    );

    return () => {
      unsubscribe();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [enabled, triggerSave]);

  // Manual save function
  const saveNow = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    await saveAllFlows();
  }, [saveAllFlows]);

  return {
    status,
    lastSavedAt,
    pendingChanges,
    error,
    saveNow,
  };
}

/**
 * Hook to get just the save status (for UI components)
 */
export function useSaveStatus() {
  const { status, lastSavedAt, pendingChanges, error } = useAutoSave({ enabled: false });

  return {
    status,
    lastSavedAt,
    pendingChanges,
    error,
    statusText: getStatusText(status, lastSavedAt),
  };
}

function getStatusText(status: SaveStatus, lastSavedAt: Date | null): string {
  switch (status) {
    case 'saving':
      return 'Saving...';
    case 'saved':
      return lastSavedAt ? `Saved at ${formatTime(lastSavedAt)}` : 'Saved';
    case 'error':
      return 'Save failed';
    case 'conflict':
      return 'Conflict detected';
    default:
      return lastSavedAt ? `Last saved ${formatRelativeTime(lastSavedAt)}` : 'Not saved';
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return formatTime(date);
}

export default useAutoSave;
