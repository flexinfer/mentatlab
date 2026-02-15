/**
 * useAgentList - Fetches and tracks registered agents from the orchestrator
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getAgentService, type Agent } from '@/services/api/agentService';
import { httpClient } from '@/services/api/httpClient';

export interface UseAgentListResult {
  agents: Agent[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  selectedAgent: Agent | null;
  selectAgent: (agent: Agent | null) => void;
}

export function useAgentList(): UseAgentListResult {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const mountedRef = useRef(true);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const service = getAgentService(httpClient, null);
      const result = await service.listAgents();
      if (!mountedRef.current) return;
      // Handle both array and { agents: [] } response shapes
      const list = Array.isArray(result) ? result : (result as any)?.agents ?? [];
      setAgents(list);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message ?? 'Failed to load agents');
      setAgents([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAgents();
    return () => { mountedRef.current = false; };
  }, [fetchAgents]);

  return {
    agents,
    loading,
    error,
    refresh: fetchAgents,
    selectedAgent,
    selectAgent: setSelectedAgent,
  };
}

export default useAgentList;
