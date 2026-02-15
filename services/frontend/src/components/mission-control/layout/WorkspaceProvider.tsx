/**
 * WorkspaceProvider - Context for Mission Control workspace state
 *
 * Centralizes shared state that was previously scattered in MissionControlLayout:
 * - Active run/session management
 * - UI config and feature flags
 * - Overlay visibility states
 * - CogPak UI mounting
 *
 * This enables compound components to access shared state without prop drilling.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { FeatureFlags } from '@/config/features';
import { useLayoutStore } from '@/stores';
import { useCanvasStore } from '@/stores/canvas';
import { flightRecorder } from '@/services/mission-control/services';
import { orchestratorService } from '@/services/api/orchestratorService';
import { useFlowLoader } from '@/hooks/useFlowLoader';
import type { PlanNode, PlanEdge, RunPlan } from '@/types/orchestrator';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureFlagKey = keyof typeof FeatureFlags;

export interface CogpakUi {
  url: string;
  title: string;
}

export interface WorkspaceContextValue {
  // Run management
  activeRunId: string | null;
  setActiveRunId: (id: string | null) => void;
  startDemoRun: () => void;
  startOrchestratorRun: () => Promise<void>;
  startLiveConnection: () => Promise<void>;

  // CogPak UI
  cogpakUi: CogpakUi | null;
  setCogpakUi: (ui: CogpakUi | null) => void;

  // Feature flags (with local overrides)
  isEnabled: (flag: FeatureFlagKey) => boolean;
  setFeatureOverride: (flag: FeatureFlagKey, enabled: boolean) => void;
  uiConfig: Partial<Record<FeatureFlagKey, boolean>>;

  // View mode (proxied from layout store)
  setMainView: (view: 'canvas' | 'network' | 'flow' | 'code') => void;

  // Overlays
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  shortcutsDialogOpen: boolean;
  setShortcutsDialogOpen: (open: boolean) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  lineageOverlayOpen: boolean;
  setLineageOverlayOpen: (open: boolean) => void;
  policyOverlayOpen: boolean;
  setPolicyOverlayOpen: (open: boolean) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkspaceProviderProps {
  children: React.ReactNode;
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  // ─────────────────────────────────────────────────────────────────────────
  // Flow persistence — load flows from backend on mount
  // ─────────────────────────────────────────────────────────────────────────

  useFlowLoader();

  // ─────────────────────────────────────────────────────────────────────────
  // Run management
  // ─────────────────────────────────────────────────────────────────────────

  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const startDemoRun = useCallback(() => {
    const id = `demo-${Date.now()}`;
    flightRecorder.startRun(id, 'demo-flow');
    flightRecorder.addCheckpoint({ runId: id, label: 'node:exec', data: { node: 'Source', step: 1 } });
    flightRecorder.addCheckpoint({ runId: id, label: 'edge:transmit', data: { from: 'Source.out', to: 'Agent.in' } });
    flightRecorder.addCheckpoint({ runId: id, label: 'tool:call', data: { tool: 'Summarize', tokens: 256 } });
    flightRecorder.endRun(id, 'completed');
    setActiveRunId(id);
  }, []);

  const startOrchestratorRun = useCallback(async () => {
    try {
      const { nodes, edges } = useCanvasStore.getState();

      // Convert canvas state to RunPlan
      const planNodes: PlanNode[] = nodes.map((n) => {
        const base: PlanNode = {
          id: n.id,
          type: n.type || 'agent',
          label: n.data?.label,
          inputs: edges.filter((e) => e.target === n.id).map((e) => e.source),
        };

        // Control flow nodes store config flat in node.data — nest into PlanNode fields
        if (n.type === 'conditional') {
          return {
            ...base,
            type: 'conditional',
            conditional: {
              type: n.data?.type || 'if',
              expression: n.data?.expression || '',
              branches: n.data?.branches || {},
              default: n.data?.default,
            },
          };
        }

        if (n.type === 'forEach') {
          return {
            ...base,
            type: 'for_each',
            for_each: {
              collection: n.data?.collection || '',
              item_var: n.data?.itemVar || 'item',
              index_var: n.data?.indexVar,
              max_parallel: n.data?.maxParallel,
              body: n.data?.body || [],
            },
          };
        }

        if (n.type === 'gate') {
          return {
            ...base,
            type: 'gate',
            gate: {
              description: n.data?.description || '',
              timeout: n.data?.timeout,
              auto_reject: n.data?.autoReject ?? true,
            },
          };
        }

        // Regular task/agent node — include retry policy and timeout if configured
        const node: PlanNode = {
          ...base,
          agent_id: n.data?.agent_id || n.data?.agentId,
          command: n.data?.command,
          image: n.data?.image,
          env: n.data?.env,
        };
        if (n.data?.retry_policy) {
          node.retry_policy = n.data.retry_policy;
        }
        if (n.data?.timeout) {
          node.timeout = n.data.timeout;
        }
        return node;
      });

      const planEdges: PlanEdge[] = edges.map((e) => ({
        from: e.sourceHandle ? `${e.source}.${e.sourceHandle}` : e.source,
        to: e.targetHandle ? `${e.target}.${e.targetHandle}` : e.target,
      }));

      const plan: RunPlan = { nodes: planNodes, edges: planEdges };

      // Create and auto-start the run
      const response = await orchestratorService.createRun({ plan, auto_start: true });
      const runId = response.runId || response.run_id || response.id;
      if (runId) {
        setActiveRunId(runId);
      }
    } catch (e) {
      console.error('[Workspace] Start Orchestrator Run failed', e);
    }
  }, []);

  const startLiveConnection = useCallback(async () => {
    try {
      const mod = await import('@/services/api/streamingService');
      await mod.default.connect();
    } catch (e) {
      console.error('[Workspace] Live connect failed', e);
    }
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // CogPak UI
  // ─────────────────────────────────────────────────────────────────────────

  const [cogpakUi, setCogpakUi] = useState<CogpakUi | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Feature flags with local overrides
  // ─────────────────────────────────────────────────────────────────────────

  const [uiConfig, setUiConfig] = useState<Partial<Record<FeatureFlagKey, boolean>>>(() => {
    try {
      const raw = localStorage.getItem('mc_ui_config');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('mc_ui_config', JSON.stringify(uiConfig));
    } catch {
      // ignore storage errors
    }
  }, [uiConfig]);

  const isEnabled = useCallback(
    (flag: FeatureFlagKey): boolean => {
      return uiConfig[flag] ?? FeatureFlags[flag];
    },
    [uiConfig]
  );

  const setFeatureOverride = useCallback((flag: FeatureFlagKey, enabled: boolean) => {
    setUiConfig((prev) => ({ ...prev, [flag]: enabled }));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Overlay states
  // ─────────────────────────────────────────────────────────────────────────

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [lineageOverlayOpen, setLineageOverlayOpen] = useState(false);
  const [policyOverlayOpen, setPolicyOverlayOpen] = useState(false);

  // ─────────────────────────────────────────────────────────────────────────
  // Listen for openCogpak events
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (ev: Event) => {
      try {
        if (!isEnabled('ALLOW_REMOTE_COGPAK_UI')) {
          console.warn('[Workspace] openCogpak ignored: ALLOW_REMOTE_COGPAK_UI=false');
          return;
        }
        const detail = (ev as CustomEvent).detail as CogpakUi;
        if (detail?.url) {
          setCogpakUi(detail);
        }
      } catch (err) {
        console.error('[Workspace] openCogpak handler error', err);
      }
    };
    window.addEventListener('openCogpak', handler as EventListener);
    return () => window.removeEventListener('openCogpak', handler as EventListener);
  }, [isEnabled]);

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-select latest run
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isEnabled('NEW_STREAMING') || activeRunId) return;

    const interval = setInterval(() => {
      try {
        const runs = flightRecorder.listRuns();
        const filtered = (runs || []).filter((r: unknown) => {
          const run = r as { type?: string; runId?: string };
          return run?.type && run.type !== 'simulated';
        });
        if (filtered.length && !activeRunId) {
          const firstRun = filtered[0] as { runId: string };
          setActiveRunId(firstRun.runId);
        }
      } catch {
        /* ignore */
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRunId, isEnabled]);

  // ─────────────────────────────────────────────────────────────────────────
  // Context value
  // ─────────────────────────────────────────────────────────────────────────

  // Get setMainView from layout store
  const { setMainView } = useLayoutStore();

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      activeRunId,
      setActiveRunId,
      startDemoRun,
      startOrchestratorRun,
      startLiveConnection,
      cogpakUi,
      setCogpakUi,
      isEnabled,
      setFeatureOverride,
      uiConfig,
      setMainView,
      settingsOpen,
      setSettingsOpen,
      shortcutsDialogOpen,
      setShortcutsDialogOpen,
      commandPaletteOpen,
      setCommandPaletteOpen,
      lineageOverlayOpen,
      setLineageOverlayOpen,
      policyOverlayOpen,
      setPolicyOverlayOpen,
    }),
    [
      activeRunId,
      startDemoRun,
      startOrchestratorRun,
      startLiveConnection,
      cogpakUi,
      isEnabled,
      setFeatureOverride,
      uiConfig,
      setMainView,
      settingsOpen,
      shortcutsDialogOpen,
      commandPaletteOpen,
      lineageOverlayOpen,
      policyOverlayOpen,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export default WorkspaceProvider;
