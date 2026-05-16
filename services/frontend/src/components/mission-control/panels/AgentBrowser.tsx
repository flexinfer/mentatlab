import React, { useState, useCallback } from 'react';
import { useAgentList } from '@/hooks/useAgentList';
import type { Agent } from '@/services/api/agentService';
import { getAgentService } from '@/services/api/agentService';
import { httpClient } from '@/services/api/httpClient';
import { ManifestValidatorOverlay } from '@/components/mission-control/overlays/ManifestValidatorOverlay';

function StatusBadge({ status }: { status: Agent['status'] }) {
  const colors: Record<string, string> = {
    online: 'bg-green-500',
    offline: 'bg-gray-400',
    busy: 'bg-yellow-500',
    error: 'bg-red-500',
  };
  return (
    <span className={`inline-flex h-2 w-2 rounded-full ${colors[status] ?? 'bg-gray-400'}`} />
  );
}

function AgentDetail({ agent, onBack }: { agent: Agent; onBack: () => void }) {
  const [reloadStatus, setReloadStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const handleReload = useCallback(async () => {
    setReloadStatus('loading');
    try {
      const service = getAgentService(httpClient, null);
      await service.reloadAgent(agent.id);
      setReloadStatus('success');
      setTimeout(() => setReloadStatus('idle'), 2000);
    } catch {
      setReloadStatus('error');
      setTimeout(() => setReloadStatus('idle'), 3000);
    }
  }, [agent.id]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            &larr; Back
          </button>
          <span className="text-[11px] font-medium">{agent.name || agent.id}</span>
        </div>
        <button
          onClick={handleReload}
          disabled={reloadStatus === 'loading'}
          className="text-[11px] px-2 py-0.5 rounded bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-all"
          data-testid="reload-agent-btn"
        >
          {reloadStatus === 'loading' && 'Reloading…'}
          {reloadStatus === 'success' && '✓ Reloaded'}
          {reloadStatus === 'error' && '✕ Failed'}
          {reloadStatus === 'idle' && 'Reload'}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-3">
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">ID</div>
          <div className="text-[11px] font-mono">{agent.id}</div>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Type</div>
          <div className="text-[11px]">{agent.type || 'unknown'}</div>
        </div>
        <div className="space-y-1">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Status</div>
          <div className="text-[11px] flex items-center gap-1.5">
            <StatusBadge status={agent.status} />
            {agent.status}
          </div>
        </div>
        {agent.capabilities && agent.capabilities.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Capabilities</div>
            <div className="flex flex-wrap gap-1">
              {agent.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="text-[10px] px-1.5 py-0.5 bg-muted rounded"
                >
                  {cap}
                </span>
              ))}
            </div>
          </div>
        )}
        {agent.config && Object.keys(agent.config).length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Config</div>
            <pre className="text-[10px] bg-muted/50 border rounded p-2 overflow-auto max-h-32">
              {JSON.stringify(agent.config, null, 2)}
            </pre>
          </div>
        )}
        {agent.metadata && Object.keys(agent.metadata).length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Metadata</div>
            <pre className="text-[10px] bg-muted/50 border rounded p-2 overflow-auto max-h-32">
              {JSON.stringify(agent.metadata, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentBrowser() {
  const { agents, loading, error, refresh, selectedAgent, selectAgent } = useAgentList();
  const [validatorOpen, setValidatorOpen] = useState(false);

  if (selectedAgent) {
    return <AgentDetail agent={selectedAgent} onBack={() => selectAgent(null)} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-1.5 border-b flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {loading ? 'Loading...' : `${agents.length} agent${agents.length !== 1 ? 's' : ''}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setValidatorOpen(true)}
            className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted"
            data-testid="open-validator-btn"
          >
            Validate
          </button>
          <button
            onClick={refresh}
            className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {error && (
          <div className="p-3 text-[11px] text-red-500">{error}</div>
        )}
        {!loading && agents.length === 0 && !error && (
          <div className="p-3 text-[11px] text-muted-foreground">
            No agents registered. Register agents via the orchestrator API.
          </div>
        )}
        {agents.length > 0 && (
          <ul className="divide-y">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className="px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={() => selectAgent(agent)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={agent.status} />
                    <span className="text-[11px] font-medium">{agent.name || agent.id}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{agent.type}</span>
                </div>
                {agent.capabilities && agent.capabilities.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {agent.capabilities.slice(0, 3).map((cap) => (
                      <span
                        key={cap}
                        className="text-[9px] px-1 py-0.5 bg-muted/50 rounded text-muted-foreground"
                      >
                        {cap}
                      </span>
                    ))}
                    {agent.capabilities.length > 3 && (
                      <span className="text-[9px] text-muted-foreground">
                        +{agent.capabilities.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ManifestValidatorOverlay
        open={validatorOpen}
        onClose={() => setValidatorOpen(false)}
      />
    </div>
  );
}

export default AgentBrowser;
