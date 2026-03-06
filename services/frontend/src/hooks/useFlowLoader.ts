/**
 * useFlowLoader - Loads flows from the backend API on mount
 *
 * Fetches flows from the orchestrator and populates the flow store.
 * Falls back to bundled example flows when the backend returns empty
 * and DEMO_MODE is enabled.
 */

import { useEffect, useRef } from 'react';
import { useFlowStore } from '@/stores';
import { getFlowService } from '@/services/api/flowService';
import { httpClient } from '@/services/api/httpClient';
import { FeatureFlags } from '@/config/features';
import { EXAMPLE_FLOWS } from '@/data/exampleFlows';

function loadExampleFlows() {
  const { flows: existingFlows } = useFlowStore.getState();
  if (existingFlows.size > 0) return;

  useFlowStore.setState((state) => {
    for (const flow of EXAMPLE_FLOWS) {
      const id = flow.meta.id;
      state.flows.set(id, {
        id,
        name: flow.meta.name,
        description: flow.meta.description ?? '',
        nodes: (flow.graph.nodes ?? []).map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: { ...n.params, ...n.outputs },
        })),
        edges: (flow.graph.edges ?? []).map((e, i) => ({
          id: `e-${i}`,
          source: e.from.split('.')[0],
          sourceHandle: e.from.split('.')[1],
          target: e.to.split('.')[0],
          targetHandle: e.to.split('.')[1],
        })),
        metadata: { example: true },
        createdAt: new Date(flow.meta.createdAt).getTime(),
        updatedAt: Date.now(),
      });
    }
    if (!state.activeFlowId) {
      state.activeFlowId = EXAMPLE_FLOWS[0].meta.id;
    }
  });
}

export function useFlowLoader(): { loaded: boolean; error: string | null } {
  const loadedRef = useRef(false);
  const errorRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    if (loadedRef.current) return;
    loadedRef.current = true;

    const flowService = getFlowService(httpClient);

    flowService
      .listFlows()
      .then((response) => {
        if (!mountedRef.current) return;

        const flows = response.flows;
        if (!flows || flows.length === 0) {
          if (FeatureFlags.DEMO_MODE) {
            loadExampleFlows();
          }
          return;
        }

        const { flows: existingFlows } = useFlowStore.getState();
        if (existingFlows.size > 0) return;

        useFlowStore.setState((state) => {
          for (const flow of flows) {
            state.flows.set(flow.id, {
              id: flow.id,
              name: flow.name,
              description: flow.description,
              nodes: flow.graph?.nodes ?? [],
              edges: flow.graph?.edges ?? [],
              metadata: flow.metadata,
              createdAt: new Date(flow.created_at).getTime(),
              updatedAt: new Date(flow.updated_at).getTime(),
            });
          }
          if (!state.activeFlowId && flows.length > 0) {
            state.activeFlowId = flows[0].id;
          }
        });
      })
      .catch((err) => {
        if (!mountedRef.current) return;
        errorRef.current = err?.message ?? 'Failed to load flows';
        if (FeatureFlags.DEMO_MODE) {
          loadExampleFlows();
        }
        console.warn('[useFlowLoader] Failed to load flows from backend:', err);
      });

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { loaded: loadedRef.current, error: errorRef.current };
}

export default useFlowLoader;
