import React from 'react';
import { FeatureFlags } from '../../../config/features';
import { StreamingCanvas } from '../../StreamingCanvas';
import { Button } from '../../ui/button';
import TimelinePanel from '../panels/TimelinePanel';
 // ADD: Issues panel import
 import IssuesPanel from '../panels/IssuesPanel';
 // ADD: Console panel import
 import ConsolePanel from '../panels/ConsolePanel';
// ADD: Runs panel import (dev)
import RunsPanel from '../panels/RunsPanel';
import { flightRecorder } from '../../../services/mission-control/services';
import { ReactFlowProvider } from 'reactflow';
// ADD: streaming store + enum for status badge and connect state
import { useStreamingStore } from '../../../store/index';
import { StreamConnectionState } from '../../../types/streaming';
import ContractOverlay from '../overlays/ContractOverlay';
import LineageOverlay from '../overlays/LineageOverlay';
import PolicyOverlay from '../overlays/PolicyOverlay';
import InspectorPanel from '../panels/InspectorPanel';
import NetworkPanel from '../panels/NetworkPanel';
import { getOrchestratorBaseUrl, getGatewayBaseUrl } from '@/config/orchestrator';
import { openCogpakUi, resolveRemoteEntry } from '@/utils/remoteUi';
// ADD: orchestrator run helper
import { startDemoRunAndStream } from '../../../services/api/orchestrator';
import GraphPanel from '../panels/GraphPanel';
// ADD: keyboard shortcuts
import { useKeyboardShortcuts, type KeyboardShortcut, commonShortcuts } from '@/hooks/useKeyboardShortcuts';
import { KeyboardShortcutsDialog } from '@/components/ui/KeyboardShortcutsDialog';
// ADD: flow store for undo/redo
import { useFlowStore } from '@/store/index';

export function MissionControlLayout() {
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  // Currently mounted CogPak UI (mounts into the main canvas)
  const [cogpakUi, setCogpakUi] = React.useState<{ url: string; title: string } | null>(null);

  // Flow store actions for undo/redo
  const { undo, redo, canUndo, canRedo } = useFlowStore();
  // THEME: dark mode persisted
  const [dark, setDark] = React.useState<boolean>(() => {
    try { return (localStorage.getItem('theme') ?? 'light') === 'dark'; } catch { return false; }
  });
  React.useEffect(() => {
    try {
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch { /* ignore */ }
  }, [dark]);

  // UI config (overrides for feature flags) persisted to localStorage
  const [uiConfig, setUiConfig] = React.useState<Partial<Record<keyof typeof FeatureFlags, boolean>>>(() => {
    try {
      const raw = localStorage.getItem('mc_ui_config');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem('mc_ui_config', JSON.stringify(uiConfig));
    } catch {
      // ignore storage errors
    }
  }, [uiConfig]);

  const isEnabled = (flag: keyof typeof FeatureFlags) => {
    return uiConfig[flag] ?? FeatureFlags[flag];
  };

  // Listen for openCogpak events dispatched by CogPaksList, gated by feature flag
  React.useEffect(() => {
    const handler = (ev: Event) => {
      try {
        if (!isEnabled('ALLOW_REMOTE_COGPAK_UI')) {
          console.warn('[MissionControlLayout] openCogpak ignored: ALLOW_REMOTE_COGPAK_UI=false');
          return;
        }
        const detail = (ev as CustomEvent).detail as { url: string; title: string };
        console.log('[MissionControlLayout] openCogpak event received', detail);
        if (detail && detail.url) setCogpakUi(detail);
      } catch (err) {
        console.log('[MissionControlLayout] openCogpak handler error', err);
      }
    };
    window.addEventListener('openCogpak', handler as EventListener);
    return () => window.removeEventListener('openCogpak', handler as EventListener);
  }, [uiConfig]);

  // Settings Drawer open state
  const [settingsOpen, setSettingsOpen] = React.useState<boolean>(false);

  // Keyboard shortcuts help dialog
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = React.useState<boolean>(false);

  // Lineage overlay state
  const [lineageOverlayOpen, setLineageOverlayOpen] = React.useState<boolean>(false);

  // Policy overlay state
  const [policyOverlayOpen, setPolicyOverlayOpen] = React.useState<boolean>(false);

  // When a CogPak UI is requested, load its remoteEntry and attempt to mount into #cogpak-mount
  React.useEffect(() => {
    if (!cogpakUi) return;
    if (!isEnabled('ALLOW_REMOTE_COGPAK_UI')) {
      console.warn('[MissionControlLayout] Skipping remote UI load (flag disabled)');
      return;
    }
    const container = document.getElementById('cogpak-mount');
    if (!container) return;

    const script = document.createElement('script');
    script.src = cogpakUi.url;
    script.async = true;
    script.onload = () => {
      try {
        // Try common global first, then scan for any global with mount()
        const globalAny = window as any;
        if (globalAny.PsycheSimRemote && typeof globalAny.PsycheSimRemote.mount === 'function') {
          globalAny.PsycheSimRemote.mount(container, null);
          return;
        }
        for (const k in globalAny) {
          try {
            const v = globalAny[k];
            if (v && typeof v.mount === 'function') {
              v.mount(container, null);
              return;
            }
          } catch {}
        }
        container.innerHTML = '<pre>Loaded remoteEntry but could not find mount() function.</pre>';
      } catch (err) {
        container.innerHTML = `<pre>Error mounting remoteEntry: ${String(err)}</pre>`;
      }
    };
    script.onerror = () => {
      container.innerHTML = `<pre>Failed to load remoteEntry: ${cogpakUi.url}</pre>`;
    };

    document.body.appendChild(script);
    return () => {
      try { document.body.removeChild(script); } catch {}
      if (container) container.innerHTML = '';
    };
  }, [cogpakUi, uiConfig]);

  // Auto-select latest run when streaming recorder starts runs (e.g., EnhancedStream)
  React.useEffect(() => {
    if (!isEnabled('NEW_STREAMING') || activeRunId) return;
    const interval = setInterval(() => {
      const runs = flightRecorder.listRuns();
      if (runs.length && !activeRunId) {
        setActiveRunId(runs[0].runId);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRunId]);

  const startDemoRun = React.useCallback(() => {
    const id = `demo-${Date.now()}`;
    // Start run + seed a few checkpoints
    flightRecorder.startRun(id, 'demo-flow');
    flightRecorder.addCheckpoint({ runId: id, label: 'node:exec', data: { node: 'Source', step: 1 } });
    flightRecorder.addCheckpoint({ runId: id, label: 'edge:transmit', data: { from: 'Source.out', to: 'Agent.in' } });
    flightRecorder.addCheckpoint({ runId: id, label: 'tool:call', data: { tool: 'Summarize', tokens: 256 } });
    flightRecorder.endRun(id, 'completed');
    setActiveRunId(id);
  }, []);

  // Live connection starter (EnhancedStream) via dynamic import
  const startLive = React.useCallback(async () => {
    if (!isEnabled('CONNECT_WS')) return;
    try {
      const mod = await import('../../../services/api/streamingService');
      await mod.default.connect();
      // EnhancedStream will start a FlightRecorder run automatically on connect
    } catch (e) {
      console.error('[MissionControl] Live connect failed', e);
    }
  }, []);

  const openRemoteUi = (remoteEntry: string | undefined, title: string) => {
    if (!remoteEntry) return;
    openCogpakUi(remoteEntry, title);
  };

  // Main view state (network or flow)
  const [mainView, setMainView] = React.useState<'network' | 'flow'>('network');

  // ADD: Start an orchestrator run (FastAPI backend) and subscribe to SSE
  const startOrchestratorRun = React.useCallback(async () => {
    try {
      const { runId } = await startDemoRunAndStream();
      setActiveRunId(runId);
    } catch (e) {
      console.error('[MissionControl] Start Orchestrator Run failed', e);
    }
  }, []);

  // Keyboard shortcuts configuration
  const shortcuts = React.useMemo<KeyboardShortcut[]>(() => [
    {
      ...commonShortcuts.commandPalette(() => {
        console.log('[Shortcuts] Command palette (not yet implemented)');
        // TODO: Implement command palette
      }),
      description: 'Navigation: Open command palette',
    },
    {
      ...commonShortcuts.undo(() => {
        if (canUndo()) {
          undo();
        }
      }),
      description: 'Edit: Undo last change',
      enabled: canUndo(),
    },
    {
      ...commonShortcuts.redo(() => {
        if (canRedo()) {
          redo();
        }
      }),
      description: 'Edit: Redo last change',
      enabled: canRedo(),
    },
    {
      key: 'r',
      ctrlKey: true,
      description: 'Flow: Run current flow',
      action: () => {
        startOrchestratorRun();
      },
      preventDefault: true,
    },
    {
      key: 's',
      ctrlKey: true,
      description: 'Flow: Save flow',
      action: () => {
        console.log('[Shortcuts] Save flow (not yet implemented)');
        // TODO: Implement flow save
      },
      preventDefault: true,
    },
    {
      key: '/',
      ctrlKey: true,
      description: 'UI: Toggle console panel',
      action: () => {
        console.log('[Shortcuts] Toggle console');
        // TODO: Implement console toggle
      },
      preventDefault: true,
    },
    {
      ...commonShortcuts.escape(() => {
        if (shortcutsDialogOpen) {
          setShortcutsDialogOpen(false);
        } else if (lineageOverlayOpen) {
          setLineageOverlayOpen(false);
        } else if (policyOverlayOpen) {
          setPolicyOverlayOpen(false);
        } else if (settingsOpen) {
          setSettingsOpen(false);
        } else if (cogpakUi) {
          setCogpakUi(null);
        }
      }),
      description: 'UI: Close dialogs/overlays',
    },
    {
      key: 'l',
      ctrlKey: true,
      description: 'View: Toggle lineage overlay',
      action: () => {
        setLineageOverlayOpen(!lineageOverlayOpen);
      },
      preventDefault: true,
    },
    {
      key: 'p',
      ctrlKey: true,
      description: 'View: Toggle policy overlay',
      action: () => {
        setPolicyOverlayOpen(!policyOverlayOpen);
      },
      preventDefault: true,
    },
    {
      key: '?',
      shiftKey: true,
      description: 'Help: Show keyboard shortcuts',
      action: () => {
        setShortcutsDialogOpen(!shortcutsDialogOpen);
      },
      preventDefault: true,
    },
    {
      key: 'd',
      ctrlKey: true,
      description: 'Flow: Start demo run',
      action: () => {
        startDemoRun();
      },
      preventDefault: true,
    },
    {
      key: 't',
      ctrlKey: true,
      description: 'UI: Toggle dark mode',
      action: () => {
        setDark((d) => !d);
      },
      preventDefault: true,
    },
  ], [shortcutsDialogOpen, lineageOverlayOpen, policyOverlayOpen, settingsOpen, cogpakUi, startOrchestratorRun, startDemoRun, undo, redo, canUndo, canRedo]);

  // Enable keyboard shortcuts
  useKeyboardShortcuts(shortcuts);

  return (
    <div className="h-screen w-screen grid grid-rows-[48px_1fr_28px] grid-cols-[240px_1fr] bg-background text-foreground" style={{
      position: 'relative',
      height: '100vh',
      width: '100vw',
    }}>
      {/* Top Bar */}
      <header className="row-start-1 col-span-2 flex items-center justify-between px-4 border-b bg-card/70 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">MentatLab</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-900/40">
            Mission Control
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <FlagPill label="MULTIMODAL_UPLOAD" enabled={isEnabled('MULTIMODAL_UPLOAD')} />
          <FlagPill label="NEW_STREAMING" enabled={isEnabled('NEW_STREAMING')} />
          <FlagPill label="S3_STORAGE" enabled={isEnabled('S3_STORAGE')} />
          {/* Dark Mode Toggle */}
          <button
            className="ml-2 h-6 px-2 rounded border bg-card hover:bg-muted text-[11px]"
            onClick={() => setDark((d) => !d)}
            title="Toggle theme"
          >
            {dark ? '☾ Dark' : '☀ Light'}
          </button>
          {/* Settings Drawer Toggle */}
          <button
            className="ml-2 h-6 px-2 rounded border bg-card hover:bg-muted text-[11px]"
            onClick={() => setSettingsOpen(true)}
            title="Open settings"
          >
            ⚙
          </button>
          {/* Keyboard Shortcuts Help */}
          <button
            className="ml-2 h-6 px-2 rounded border bg-card hover:bg-muted text-[11px]"
            onClick={() => setShortcutsDialogOpen(true)}
            title="Keyboard shortcuts (Shift+?)"
          >
            ?
          </button>
        </div>
      </header>

      {/* Left Nav */}
      <aside className="row-start-2 col-start-1 border-r bg-card/70 backdrop-blur">
        {/* Workspace sidebar: Workspaces / CogPaks / Flows */}
        <nav className="p-2 text-xs space-y-2">
          <SectionTitle>Workspaces</SectionTitle>
          <ul className="space-y-1 text-gray-600 dark:text-gray-300">
            <li className="px-2 py-1 rounded hover:bg-muted cursor-pointer">Default</li>
          </ul>

          <SectionTitle className="mt-3">CogPaks</SectionTitle>
          <CogPaksList allowRemoteUi={isEnabled('ALLOW_REMOTE_COGPAK_UI')} onSelectNetwork={() => setMainView('network')} />

          <SectionTitle className="mt-3">Flows</SectionTitle>
          <ul className="space-y-1 text-gray-600 dark:text-gray-300">
            <li className="px-2 py-1 rounded hover:bg-muted cursor-pointer" onClick={() => setMainView('flow')}>example-flow</li>
          </ul>
        </nav>
      </aside>

      {/* Canvas */}
      <main
        className="row-start-2 col-start-2 relative overflow-hidden"
        style={{ position: 'relative', overflow: 'hidden' }}
      >
        <div
          className="absolute inset-0"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 0 }}
        >
          {/* Canvas center of gravity */}
          <div style={{ height: '100%', width: '100%' }}>
            {mainView === 'network' ? (
              <NetworkPanel runId={activeRunId} />
            ) : (
              <ReactFlowProvider>
                <StreamingCanvas />
                {/* Mounted CogPak UI overlay (mounts remoteEntry into #cogpak-mount) */}
                <CogpakOverlay cogpakUi={cogpakUi} onClose={() => setCogpakUi(null)} />
              </ReactFlowProvider>
            )}
          </div>
        </div>

        {/* Overlays */}
        <div className="pointer-events-none absolute inset-0" style={{ zIndex: 10 }}>
          {isEnabled('NEW_STREAMING') && (
            <div className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-900/50">
              Streaming overlays enabled
            </div>
          )}
          {/* contract overlay removed from global overlays — moved to per-panel transparency */}
        </div>

        {/* Right Dock */}
        <RightDock uiConfig={uiConfig} setUiConfig={setUiConfig} isEnabled={isEnabled} />
        {/* Bottom Dock */}
        <BottomDock
          runId={activeRunId}
          onStartDemo={startDemoRun}
          onStartLive={startLive}
          // ADD: pass handler to bottom dock
          onStartOrchestratorRun={startOrchestratorRun}
          isEnabled={isEnabled}
        />

        {/* Settings Drawer */}
        {settingsOpen && (
          <div
            className="absolute top-16 right-12 w-80 rounded-lg border bg-card text-foreground shadow-lg p-3 z-50"
            style={{ backgroundColor: 'hsl(var(--card))' }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-sm">UI Settings</div>
              <button className="text-xs px-2 py-1 border rounded" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
            </div>
            <div className="space-y-2 text-xs">
              {(Object.keys(FeatureFlags) as Array<keyof typeof FeatureFlags>).map((k) => {
                const enabled = uiConfig[k] ?? FeatureFlags[k];
                return (
                  <label key={k} className="flex items-center justify-between">
                    <span className="capitalize">{k.replace(/_/g, ' ').toLowerCase()}</span>
                    <input
                      type="checkbox"
                      checked={!!enabled}
                      onChange={(e) => {
                        setUiConfig((prev) => ({ ...prev, [k]: e.target.checked }));
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Status Bar */}
      <StatusBar isEnabled={isEnabled} />

      {/* Keyboard Shortcuts Help Dialog */}
      <KeyboardShortcutsDialog
        shortcuts={shortcuts}
        isOpen={shortcutsDialogOpen}
        onClose={() => setShortcutsDialogOpen(false)}
      />

      {/* Lineage Overlay */}
      {lineageOverlayOpen && (
        <LineageOverlay
          runId={activeRunId}
          onClose={() => setLineageOverlayOpen(false)}
        />
      )}

      {/* Policy Overlay */}
      {policyOverlayOpen && (
        <PolicyOverlay
          runId={activeRunId}
          onClose={() => setPolicyOverlayOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Right Dock: Inspector, Media Preview, Properties (placeholder)
 */
function RightDock({ uiConfig, setUiConfig, isEnabled }: { uiConfig: Partial<Record<keyof typeof FeatureFlags, boolean>>; setUiConfig: React.Dispatch<React.SetStateAction<Partial<Record<keyof typeof FeatureFlags, boolean>>>>; isEnabled: (f: keyof typeof FeatureFlags) => boolean }) {
  return (
    <div className="pointer-events-auto absolute top-2 right-2 bottom-32 w-[360px] rounded-lg border text-foreground shadow-sm overflow-hidden flex flex-col bg-card/70 backdrop-blur"
      style={{ position: 'absolute', top: 8, right: 8, bottom: 128, width: 360, zIndex: 40 }}
    >
      <div className="h-9 border-b flex items-center px-3 text-xs font-medium bg-muted/50">Inspector</div>
      <div className="flex-1 overflow-auto p-3 text-xs text-gray-600 dark:text-gray-300">
        <InspectorPanel runId={activeRunId} />
      </div>
    </div>
  );
}

/**
 * Bottom Dock: Console, Runs, Timeline (placeholder)
 */
function BottomDock({
  runId,
  onStartDemo,
  onStartLive
  , isEnabled
  // ADD: orchestrator run handler
  , onStartOrchestratorRun
}: {
  runId: string | null;
  onStartDemo: () => void;
  onStartLive?: () => void;
  isEnabled?: (flag: keyof typeof FeatureFlags) => boolean;
  // ADD: orchestrator run handler
  onStartOrchestratorRun?: () => void;
}) {
  // Interactive tabs
  const isEnabledLocal = isEnabled ?? (() => true);
  const initialTab = ((): 'Console' | 'Run Queue' | 'Timeline' | 'Issues' | 'Runs' | 'Network' | 'Graph' => {
    try {
      const stored = localStorage.getItem('mc_bottom_active_tab') as any;
      if (stored) return stored;
    } catch {}
    // Prefer Network by default when available
    if (isEnabledLocal('NETWORK_PANEL')) return 'Network';
    if (isEnabledLocal('NEW_STREAMING')) return 'Timeline';
    return isEnabledLocal('MISSION_CONSOLE') ? 'Console' : 'Run Queue';
  })();
  const [activeTab, setActiveTabRaw] = React.useState<'Console' | 'Run Queue' | 'Timeline' | 'Issues' | 'Runs' | 'Network' | 'Graph'>(initialTab);
  const setActiveTab = (t: typeof activeTab) => {
    setActiveTabRaw(t);
    try { localStorage.setItem('mc_bottom_active_tab', t); } catch {}
  };
  // Live connect state (disable button when connecting/connected)
  const connectionStatus = useStreamingStore((s) => s.connectionStatus);
  const liveDisabled =
    connectionStatus === StreamConnectionState.CONNECTING ||
    connectionStatus === StreamConnectionState.RECONNECTING ||
    connectionStatus === StreamConnectionState.CONNECTED;

  // NEW: badge counts
  const [issuesCount, setIssuesCount] = React.useState<number>(0);
  const [timelineCount, setTimelineCount] = React.useState<number>(0);
  // Selected node from Graph (bridged via CustomEvent)
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);

  // Bridge: Listen for node selection changes from GraphPanel via window events.
  // GraphPanel can dispatch:
  //   window.dispatchEvent(new CustomEvent('graphNodeSelected', { detail: { nodeId } }))
  //   window.dispatchEvent(new CustomEvent('graphNodeCleared'))
  React.useEffect(() => {
    const onNodeSelected = (e: Event) => {
      try {
        const nodeId = (e as CustomEvent).detail?.nodeId as string | undefined;
        setSelectedNodeId(nodeId ?? null);
      } catch {
        setSelectedNodeId(null);
      }
    };
    const onNodeCleared = () => setSelectedNodeId(null);
    window.addEventListener('graphNodeSelected', onNodeSelected as EventListener);
    window.addEventListener('graphNodeCleared', onNodeCleared as EventListener);
    return () => {
      window.removeEventListener('graphNodeSelected', onNodeSelected as EventListener);
      window.removeEventListener('graphNodeCleared', onNodeCleared as EventListener);
    };
  }, []);

  // Subscribe to timeline updates for current run
  React.useEffect(() => {
    if (!runId) {
      setTimelineCount(0);
      return;
    }
    try {
      setTimelineCount(flightRecorder.listCheckpoints(runId).length);
      const unsub = flightRecorder.subscribe(runId, () => {
        setTimelineCount(flightRecorder.listCheckpoints(runId).length);
      });
      return () => unsub?.();
    } catch {
      // ignore
    }
  }, [runId]);

  return (
    <div
      className="pointer-events-auto absolute left-2 right-[376px] bottom-2 h-56 rounded-lg border text-foreground shadow-sm overflow-hidden flex flex-col bg-card/70 backdrop-blur"
      style={{ position: 'absolute', left: 8, right: 376, bottom: 8, height: 224, zIndex: 35 }}
    >
      <div className="h-8 border-b bg-muted/50 text-xs">
        <div className="h-full flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            {isEnabledLocal('MISSION_CONSOLE') && (
              <TabBadge label="Console" active={activeTab === 'Console'} onClick={() => setActiveTab('Console')} />
            )}
            <TabBadge label="Run Queue" active={activeTab === 'Run Queue'} onClick={() => setActiveTab('Run Queue')} />
            {isEnabledLocal('NEW_STREAMING') && (
              <TabBadge label="Timeline" active={activeTab === 'Timeline'} onClick={() => setActiveTab('Timeline')} badge={timelineCount} />
            )}
            {isEnabledLocal('NETWORK_PANEL') && (
              <TabBadge label="Network" active={activeTab === 'Network'} onClick={() => setActiveTab('Network')} />
            )}
            {isEnabledLocal('ORCHESTRATOR_PANEL') && (
              <TabBadge label="Runs" active={activeTab === 'Runs'} onClick={() => setActiveTab('Runs')} />
            )}
            <TabBadge label="Issues" active={activeTab === 'Issues'} onClick={() => setActiveTab('Issues')} badge={issuesCount} />
            {/* NEW: Graph tab (feature flagged) */}
            {isEnabledLocal('MISSION_GRAPH') && (
              <TabBadge label="Graph" active={activeTab === 'Graph'} onClick={() => setActiveTab('Graph')} />
            )}
          </div>
          <div className="flex items-center gap-2">
            {isEnabledLocal('MULTIMODAL_UPLOAD') && (
              <Button
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => console.log('[UI] Add Artifact clicked')}
              >
                + Add Artifact
              </Button>
            )}
            {isEnabledLocal('CONNECT_WS') && (
              <Button
                variant="outline"
                className="h-6 px-2 text-[11px] disabled:opacity-60"
                onClick={onStartLive}
                disabled={liveDisabled}
                title={liveDisabled ? 'Already connected/connecting' : 'Connect live stream'}
              >
                {connectionStatus === StreamConnectionState.CONNECTING || connectionStatus === StreamConnectionState.RECONNECTING
                  ? '🔄 Connecting…'
                  : connectionStatus === StreamConnectionState.CONNECTED
                  ? '✅ Live'
                  : '🔌 Connect Live'}
              </Button>
            )}
            {isEnabledLocal('NEW_STREAMING') && (
              <Button variant="outline" className="h-6 px-2 text-[11px]" onClick={onStartDemo}>
                ▶ Start Demo Run
              </Button>
            )}
            {/* ADD: Start Orchestrator Run button (visible when Orchestrator panel is enabled) */}
            {isEnabledLocal('ORCHESTRATOR_PANEL') && (
              <Button
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={onStartOrchestratorRun}
                title="Create a backend run and stream live events"
              >
                ▶ Start Orchestrator Run
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-0 text-xs text-gray-700 dark:text-gray-300">
        {activeTab === 'Console' && isEnabledLocal('MISSION_CONSOLE') && (
          <ConsolePanel runId={runId} selectedNodeId={selectedNodeId} />
        )}
        {activeTab === 'Run Queue' && (
          <div className="p-2 font-mono text-[11px] text-gray-600 dark:text-gray-400">
            › Run Queue placeholder. Queue controls will appear here.
          </div>
        )}
        {activeTab === 'Runs' && isEnabledLocal('ORCHESTRATOR_PANEL') && <RunsPanelComponent />}
        {activeTab === 'Timeline' && isEnabledLocal('NEW_STREAMING') && <TimelinePanel runId={runId} />}
        {activeTab === 'Timeline' && !FeatureFlags.NEW_STREAMING && (
          <div className="p-2 font-mono text-[11px] text-gray-600">
            › Streaming disabled. Enable NEW_STREAMING flag to view Timeline.
          </div>
        )}
        {activeTab === 'Network' && isEnabledLocal('NETWORK_PANEL') && <NetworkPanel runId={runId} />}
        {activeTab === 'Issues' && <IssuesPanel onCountChange={setIssuesCount} />}
        {/* NEW: Graph content (feature flagged) */}
        {activeTab === 'Graph' && isEnabledLocal('MISSION_GRAPH') && (
          <div className="h-full">
            <GraphPanel runId={runId} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Status Bar: env/feature/connection health (placeholder)
 */
function StatusBar({ isEnabled }: { isEnabled?: (f: keyof typeof FeatureFlags) => boolean }) {
  const isEnabledLocal = isEnabled ?? (() => true);
  // Read live connection status and active streams from the streaming store
  const connectionStatus = useStreamingStore((s) => s.connectionStatus);
  const activeStreamsCount = useStreamingStore((s) => s.activeStreams.size);

  // Live stats polled from the EnhancedStream wrapper
  const [stats, setStats] = React.useState<{ messagesReceived: number; bytesReceived: number; uptime: number }>({
    messagesReceived: 0,
    bytesReceived: 0,
    uptime: 0,
  });
  // QoS (p95) state
  const [p95Ms, setP95Ms] = React.useState<number | undefined>(undefined);
  const [qosBadge, setQosBadge] = React.useState<{ color: string; text: string } | null>(null);

  React.useEffect(() => {
    if (!isEnabledLocal('CONNECT_WS')) return;
    let timer: number | null = null;
    let mounted = true;
    (async () => {
      try {
        const mod = await import('../../../services/api/streamingService');
        const pull = () => {
          if (!mounted) return;
          const s = (mod.default.getStats?.() as any) ?? {};
          setStats({
            messagesReceived: Number(s.messagesReceived ?? 0),
            bytesReceived: Number(s.bytesSent ?? 0) + Number(s.bytesReceived ?? 0),
            uptime: Number(s.uptime ?? 0),
          });
          // Derive p95 from available fields (be tolerant of naming)
          const p95 = Number(s.p95Ms ?? s.p95 ?? s.latencyP95Ms ?? s.latencyP95 ?? NaN);
          if (!Number.isFinite(p95) || Number.isNaN(p95)) {
            setP95Ms(undefined);
            setQosBadge(null);
          } else {
            setP95Ms(p95);
            // Compute color/text
            if (p95 < 250) setQosBadge({ color: 'bg-emerald-500', text: 'QoS good' });
            else if (p95 < 500) setQosBadge({ color: 'bg-amber-500', text: 'QoS fair' });
            else setQosBadge({ color: 'bg-red-500', text: 'QoS poor' });
          }
        };
        // Update immediately and on interval while page is active
        pull();
        timer = window.setInterval(pull, 1000);
      } catch {
        // ignore polling errors
      }
    })();
    return () => {
      mounted = false;
      if (timer) window.clearInterval(timer);
    };
  }, [connectionStatus]);

  const throughput = stats.uptime > 0 ? Math.round(stats.messagesReceived / (stats.uptime / 1000)) : 0;

  const statusBadge = (() => {
    switch (connectionStatus) {
      case StreamConnectionState.DISCONNECTED:
        return { color: 'bg-gray-400', text: 'Disconnected' };
      case StreamConnectionState.CONNECTING:
        return { color: 'bg-amber-500', text: 'Connecting' };
      case StreamConnectionState.CONNECTED:
        return { color: 'bg-emerald-500', text: 'Connected' };
      case StreamConnectionState.RECONNECTING:
        return { color: 'bg-blue-500', text: 'Reconnecting' };
      case StreamConnectionState.ERROR:
        return { color: 'bg-red-500', text: 'Error' };
      default:
        if (typeof connectionStatus === 'string') {
          const mapping: Record<string, { color: string; text: string }> = {
            disconnected: { color: 'bg-gray-400', text: 'Disconnected' },
            connecting: { color: 'bg-amber-500', text: 'Connecting' },
            connected: { color: 'bg-emerald-500', text: 'Connected' },
            reconnecting: { color: 'bg-blue-500', text: 'Reconnecting' },
            error: { color: 'bg-red-500', text: 'Error' },
          };
          return mapping[connectionStatus] ?? { color: 'bg-gray-400', text: String(connectionStatus) };
        }
        return { color: 'bg-gray-400', text: String(connectionStatus) };
    }
  })();

  return (
    <footer className="row-start-3 col-span-2 px-3 flex items-center justify-between text-[11px] border-t bg-card/80 backdrop-blur">
      <div className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
        <span className="inline-flex items-center gap-1">
          <span className={['w-1.5 h-1.5 rounded-full', statusBadge.color].join(' ')} />
          {statusBadge.text}
        </span>
        <span className="text-gray-300">|</span>
        <span>Active Streams: {activeStreamsCount}</span>
        <span className="text-gray-300">|</span>
        <span>Msgs: {stats.messagesReceived} · {throughput}/s</span>
        {isEnabledLocal('CONNECT_WS') && qosBadge && (
          <>
            <span className="text-gray-300">|</span>
            <span data-testid="qos-badge" className="inline-flex items-center gap-1">
              <span className={['w-2 h-2 rounded-full', qosBadge.color].join(' ')} />
              <span className="text-[11px]">{qosBadge.text}{p95Ms ? ` (${Math.round(p95Ms)}ms)` : ''}</span>
            </span>
          </>
        )}
        <span className="text-gray-300">|</span>
        <span>Env: Dev</span>
      </div>
      <div className="text-gray-400">v0.1 • MVP Shell</div>
    </footer>
  );
}

function FlagPill({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span
      className={[
        'px-2 py-0.5 rounded-full border',
        enabled
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-900/40'
          : 'bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-900/40 dark:text-gray-400 dark:border-gray-800',
      ].join(' ')}
      title={enabled ? 'Enabled' : 'Disabled'}
    >
      {label}
    </span>
  );
}

function TabBadge({
  label,
  active = false,
  onClick,
  badge,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'px-2 py-0.5 rounded text-[11px] border transition-colors inline-flex items-center gap-1',
        active
          ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-300 dark:border-indigo-900/40'
          : 'bg-card text-gray-600 border-gray-200 hover:bg-muted dark:text-gray-300 dark:border-gray-800 dark:hover:bg-muted/80',
      ].join(' ')}
    >
      {label}
      {typeof badge === 'number' && (
        <span
          className={[
            'ml-1 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full border',
            active
              ? 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-900/50'
              : 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
          ].join(' ')}
          title={`${badge} ${label.toLowerCase()}`}
        >
          <span className="leading-none text-[10px]">{badge}</span>
        </span>
      )}
    </button>
  );
}

function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={['text-[10px] uppercase tracking-wide text-gray-400 px-2', className].join(' ')}>{children}</div>;
}

function CogPaksList({ allowRemoteUi = false, onSelectNetwork }: { allowRemoteUi?: boolean; onSelectNetwork?: () => void }) {
  // Robust local agents fetch + UI
  const [agents, setAgents] = React.useState<any[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = React.useState<string | null>(null);
  const [runningAgents, setRunningAgents] = React.useState<Set<string>>(new Set());
  const [scheduleError, setScheduleError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;
    const endpoint = '/api/v1/agents';

    const tryParseAgentsFromText = (rawText: string) => {
      try {
        const parsed = JSON.parse(rawText);
        return Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.agents) ? parsed.agents : null;
      } catch {
        return null;
      }
    };

    const fetchAgents = async () => {
      try {
        // First attempt: same-origin (works when dev server proxies /api to backend)
        const trySameOrigin = async () => {
          let res = await fetch(endpoint, { credentials: 'same-origin' });
          let rawText = await res.text().catch(() => '');
          return { res, rawText };
        };
        const tryBackend = async () => {
          const base = getOrchestratorBaseUrl().replace(/\/+$/, '');
          let res = await fetch(`${base}${endpoint}`, { credentials: 'same-origin' });
          let rawText = await res.text().catch(() => '');
          return { res, rawText };
        };

        let { res, rawText } = await trySameOrigin();
        // Fallback when same-origin returned non-200 or HTML
        if (!res.ok || (rawText || '').trim().startsWith('<')) {
          ({ res, rawText } = await tryBackend());
        }

        if (!res.ok) {
          const msg = `endpoint ${res.url} returned HTTP ${res.status}${rawText ? ' - ' + rawText.slice(0, 300) : ''}`;
          if (mounted) {
            setError(msg);
            console.error('[CogPaksList] failed to load agents –', msg);
          }
          return;
        }

        // Try to parse JSON now that we have rawText (and not HTML)
        const arr = tryParseAgentsFromText(rawText);
        if (!arr) {
          const snippet = (rawText || '').slice(0, 1000);
          const msg = `JSON Parse error: response not JSON; response snippet: ${snippet}`;
          if (mounted) {
            setError(msg);
            console.error('[CogPaksList] failed to load agents –', msg);
          }
          return;
        }

        // Filter to only show our two cogpacks if they exist
        const filteredAgents = arr.filter((agent: any) =>
          agent?.id === 'psyche-sim' || agent?.id === 'ctm-cogpack' ||
          agent?.name?.toLowerCase().includes('psyche') ||
          agent?.name?.toLowerCase().includes('ctm')
        );
        
        // If no filtered agents, use all agents
        const finalAgents = filteredAgents.length > 0 ? filteredAgents : arr;
        
        if (mounted) setAgents(finalAgents);
      } catch (e: any) {
        if (!mounted) return;
        const msg = e?.message ?? String(e);
        setError(msg);
        console.error('[CogPaksList] failed to load agents –', msg);
      }
    };

    fetchAgents();
    return () => {
      mounted = false;
    };
  }, []);

  const scheduleAgent = async (agentId: string) => {
    if (runningAgents.has(agentId)) {
      console.log(`Agent ${agentId} is already running`);
      return;
    }

    // Find the agent manifest from our loaded agents
    const agent = agents.find(a => a?.id === agentId);
    if (!agent) {
      setScheduleError(`Agent ${agentId} not found`);
      return;
    }

    setScheduleError(null);
    setRunningAgents(prev => new Set(prev).add(agentId));
    
    try {
      // Prefer same-origin gateway proxy for schedule
      const base = '';
      
      // Prepare the request with the full agent manifest
      const requestBody = {
        agent_manifest: {
          id: agent.id,
          version: agent.version,
          image: agent.image,
          description: agent.description,
          runtime: agent.runtime,
          longRunning: agent.longRunning || false,
          ui: agent.ui,
          inputs: agent.inputs || [],
          outputs: agent.outputs || []
        },
        inputs: {
          spec: {
            prompt: "Run from UI sidebar",
            mode: "stream",
            agent_id: agentId
          },
          context: {
            source: 'frontend-sidebar',
            timestamp: new Date().toISOString()
          }
        },
        execution_id: `ui-${agentId}-${Date.now()}`,
        skip_validation: true
      };

      console.log(`Scheduling agent ${agentId} with manifest:`, requestBody);
      
      const response = await fetch(`/api/v1/agents/schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      // Be resilient to non-JSON error bodies (e.g., HTML from proxies)
      const rawText = await response.text().catch(() => '');
      let data: any = {};
      try { data = rawText ? JSON.parse(rawText) : {}; } catch { /* ignore non-JSON */ }
      if (!response.ok) {
        const snippet = rawText?.slice(0, 300) || '';
        const detail = (data && (data.detail || data.error)) || snippet || 'unknown error';
        throw new Error(`HTTP ${response.status} - ${detail}`);
      }

      console.log(`Agent ${agentId} scheduled successfully:`, data);
      // Attach live stream if orchestrator returned a stream id
      try {
        const sid: string | undefined = (data && (data.stream_id as string)) || undefined;
        const wsUrl: string | undefined = (data && (data.ws_url as string)) || undefined;
        const sseUrl: string | undefined = (data && (data.sse_url as string)) || undefined;
        if (sid) {
          const mod = await import('../../../services/api/streamingService');
          const StreamingServiceCtor: any = (mod as any).StreamingService;
          const base = window.location.origin.replace(/\/+$/, '');
          const ws = wsUrl && /^wss?:/.test(wsUrl) ? wsUrl : `${base}${(wsUrl || `/ws/streams/${sid}`).replace(/^\/+/, '/')}`.replace(/^http/, 'ws');
          const sse = sseUrl && /^https?:/.test(sseUrl) ? sseUrl : `${base}${(sseUrl || `/api/v1/streams/${sid}/sse`).replace(/^\/+/, '/')}`;
          const client = new StreamingServiceCtor(sid, ws, sse);
          await client.connect();
        }
      } catch (e) {
        console.warn('[MissionControl] Failed to attach live stream', e);
      }
      
      // Simulate agent completion after 10 seconds
      setTimeout(() => {
        setRunningAgents(prev => {
          const newSet = new Set(prev);
          newSet.delete(agentId);
          return newSet;
        });
      }, 10000);
    } catch (error) {
      console.error(`Failed to schedule agent ${agentId}:`, error);
      setScheduleError(`Failed to schedule ${agentId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Remove from running set on error
      setRunningAgents(prev => {
        const newSet = new Set(prev);
        newSet.delete(agentId);
        return newSet;
      });
    }
  };

  const openRemoteUi = (remoteEntry: string | undefined, title: string) => {
    if (!remoteEntry) return;
    if (!allowRemoteUi) {
      console.warn('[CogPaksList] Remote UI blocked by feature flag');
      return;
    }
    openCogpakUi(remoteEntry, title);
  };

  if (error) {
    return <div className="px-2 text-red-500 text-xs">Error loading CogPaks: {error}</div>;
  }

  if (agents.length === 0) {
    return <div className="px-2 text-gray-500 text-xs">No CogPaks found.</div>;
  }

  return (
    <div>
      {scheduleError && (
        <div className="px-2 mb-2 text-red-500 text-xs">{scheduleError}</div>
      )}
      <ul className="space-y-1 text-gray-600 dark:text-gray-300">
        {agents.map((agent) => {
          const agentId = agent?.id || agent?.name || 'unknown';
          const title = (agent?.ui?.title as string) || agent?.name || agent?.id || 'unknown-cogpak';
          const remote = agent?.ui?.remoteEntry;
          const key = agent?.manifest_path || agent?.id || title;
          const isRunning = runningAgents.has(agentId);
          const isSelected = selectedAgent === agentId;
          
          return (
            <li
              key={key}
              className={`flex flex-col px-2 py-1 rounded cursor-pointer transition-colors ${
                isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-muted'
              } ${isRunning ? 'animate-pulse' : ''}`}
              title={agent?.description || ''}
              onClick={() => setSelectedAgent(isSelected ? null : agentId)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <span className={`text-xs ${isRunning ? 'text-amber-600' : ''}`}>
                    {isRunning ? '🔄' : '●'}
                  </span>
                  <span className="truncate">{title}</span>
                </div>
                <div className="flex items-center gap-1">
                  {remote && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openRemoteUi(remote, title);
                      }}
                      className="text-[11px] px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: allowRemoteUi ? '#2563eb' : 'rgba(148,163,184,0.4)',
                        color: allowRemoteUi ? '#fff' : 'rgba(226,232,240,0.8)',
                        cursor: allowRemoteUi ? 'pointer' : 'not-allowed',
                      }}
                      disabled={!allowRemoteUi}
                      aria-label={`Open ${title} UI`}
                    >
                      UI
                    </button>
                  )}
                </div>
              </div>
              
              {isSelected && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      scheduleAgent(agentId);
                    }}
                    disabled={isRunning}
                    className={`text-[11px] px-3 py-1 rounded transition-colors ${
                      isRunning
                        ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                  >
                    {isRunning ? 'Running...' : '▶ Run'}
                  </button>
                  {isRunning && (
                    <span className="text-[10px] text-amber-600">Agent is running...</span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Mounted CogPak UI overlay rendered inside the canvas
function CogpakOverlay({ cogpakUi, onClose }: { cogpakUi: { url: string; title: string } | null; onClose: () => void }) {
  if (!cogpakUi) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto">
      <div className="w-11/12 h-5/6 bg-card/90 backdrop-blur rounded shadow-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="font-medium text-sm">{cogpakUi.title}</div>
          <button className="px-2 py-1 border rounded" onClick={onClose}>
            Close
          </button>
        </div>
        <div id="cogpak-mount" className="h-full overflow-auto bg-transparent" />
      </div>
    </div>
  );
}

// Provide a JSX-compatible component type for the Runs panel to satisfy TSX typing
const RunsPanelComponent = (RunsPanel as unknown) as React.ComponentType<any>;

export default MissionControlLayout;
