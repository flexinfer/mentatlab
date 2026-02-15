/**
 * useFlowLoader - Loads flows from the backend API on mount
 *
 * Fetches flows from the orchestrator and populates the flow store.
 * Only runs once on mount. Does not conflict with useAutoSave
 * (which handles saving changes back to the backend).
 */

import { useEffect, useRef } from 'react';
import { useFlowStore } from '@/stores';
import { getFlowService } from '@/services/api/flowService';
import { httpClient } from '@/services/api/httpClient';

export function useFlowLoader(): { loaded: boolean; error: string | null } {
  const loadedRef = useRef(false);
  const errorRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (loadedRef.current) return;
    loadedRef.current = true;

    const flowService = getFlowService(httpClient, null);

    flowService
      .listFlows()
      .then((response) => {
        if (!mountedRef.current) return;

        const flows = response.flows;
        if (!flows || flows.length === 0) return;

        const { flows: existingFlows } = useFlowStore.getState();

        // Only populate if the store is empty (localStorage may already have flows)
        if (existingFlows.size > 0) return;

        useFlowStore.setState((state) => {
          for (const flow of flows) {
            const storeFlow = {
              id: flow.id,
              name: flow.name,
              description: flow.description,
              nodes: flow.graph?.nodes ?? [],
              edges: flow.graph?.edges ?? [],
              metadata: flow.metadata,
              createdAt: new Date(flow.created_at).getTime(),
              updatedAt: new Date(flow.updated_at).getTime(),
            };
            state.flows.set(flow.id, storeFlow);
          }
          // Set the first flow as active if none selected
          if (!state.activeFlowId && flows.length > 0) {
            state.activeFlowId = flows[0].id;
          }
        });
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        errorRef.current = err?.message ?? 'Failed to load flows';
        // Non-fatal: localStorage flows still work
        console.warn('[useFlowLoader] Failed to load flows from backend:', err);
      });

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { loaded: loadedRef.current, error: errorRef.current };
}

export default useFlowLoader;
