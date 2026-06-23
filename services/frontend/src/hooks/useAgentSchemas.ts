/**
 * useAgentSchemas - Enriches canvas nodes with input/output pin types from agent schemas
 *
 * Fetches agent definitions from the registry and maps their schema
 * information onto the corresponding canvas nodes' data.inputs/data.outputs.
 * This enables the ContractOverlay to perform real type checking.
 */

import { useEffect, useRef } from 'react';
import { useCanvasStore } from '@/stores/canvas';
import { getAgentService, type Agent } from '@/services/api/agentService';
import { httpClient } from '@/services/api/httpClient';

interface PinSchema {
  type: string;
  description?: string;
}

interface AgentSchema {
  inputs?: Record<string, PinSchema>;
  outputs?: Record<string, PinSchema>;
}

function parseSchema(agent: Agent): AgentSchema | null {
  try {
    const meta = agent.metadata ?? agent.config;
    if (!meta) return null;

    // Try agent.metadata.schema or agent.config.schema
    const raw = (meta as any).schema;
    if (!raw) return null;

    const schema = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      inputs: schema.inputs ?? schema.input ?? undefined,
      outputs: schema.outputs ?? schema.output ?? undefined,
    };
  } catch {
    return null;
  }
}

export function useAgentSchemas(): void {
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const service = getAgentService(httpClient, null);
    service
      .listAgents()
      .then((result) => {
        const agents: Agent[] = Array.isArray(result) ? result : (result as any)?.agents ?? [];
        if (agents.length === 0) return;

        // Build a map of agent_id -> schema
        const schemaMap = new Map<string, AgentSchema>();
        for (const agent of agents) {
          const schema = parseSchema(agent);
          if (schema) {
            schemaMap.set(agent.id, schema);
          }
        }

        if (schemaMap.size === 0) return;

        // Enrich canvas nodes that reference agents
        const { nodes, setNodes } = useCanvasStore.getState();
        let changed = false;
        const updated = nodes.map((node: any) => {
          const agentId = node.data?.agent_id || node.data?.agentId;
          if (!agentId) return node;

          const schema = schemaMap.get(agentId);
          if (!schema) return node;

          // Only enrich if not already populated
          const hasInputs = node.data?.inputs && Object.keys(node.data.inputs).length > 0;
          const hasOutputs = node.data?.outputs && Object.keys(node.data.outputs).length > 0;
          if (hasInputs && hasOutputs) return node;

          changed = true;
          return {
            ...node,
            data: {
              ...node.data,
              inputs: node.data?.inputs ?? schema.inputs ?? {},
              outputs: node.data?.outputs ?? schema.outputs ?? {},
            },
          };
        });

        if (changed) {
          setNodes(updated);
        }
      })
      .catch((err) => {
        console.warn('[useAgentSchemas] Failed to fetch agent schemas:', err);
      });
  }, []);
}

export default useAgentSchemas;
