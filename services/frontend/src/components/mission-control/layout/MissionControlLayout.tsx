import React from 'react';
import { FeatureFlags } from '../../../config/features';
import FlowCanvas from '../../FlowCanvas';
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
import PropertyInspector from '../../PropertyInspector';

export function MissionControlLayout() {
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
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

  // Settings Drawer open state
  const [settingsOpen, setSettingsOpen] = React.useState<boolean>(false);

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

  // RunsPanel is already a React component; use it directly in JSX

  return (
    <div
      className="h-screen w-screen grid grid-rows-[48px_1fr_28px] grid-cols-[56px_1fr] bg-background text-foreground"
      style={{
        position: 'relative',
        height: '100vh', // explicit viewport sizing so React Flow gets a real height
        width: '100vw',
      }}
    >
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
        </div>
      </header>

      {/* Left Nav */}
      <aside className="row-start-2 col-start-1 border-r bg-muted/50">
        {/* Placeholder: Workspaces / Flows / Search */}
        <nav className="p-2 text-xs space-y-2">
          <SectionTitle>Workspaces</SectionTitle>
          <ul className="space-y-1 text-gray-600 dark:text-gray-300">
            <li className="px-2 py-1 rounded hover:bg-muted cursor-pointer">Default</li>
          </ul>
          <SectionTitle className="mt-3">Flows</SectionTitle>
          <ul className="space-y-1 text-gray-600 dark:text-gray-300">
            <li className="px-2 py-1 rounded hover:bg-muted cursor-pointer">example-flow</li>
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
            <ReactFlowProvider>
              <FlowCanvas />
            </ReactFlowProvider>
          </div>
        </div>

        {/* Overlays */}
        <div className="pointer-events-none absolute inset-0" style={{ zIndex: 10 }}>
          {isEnabled('NEW_STREAMING') && (
            <div className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-900/50">
              Streaming overlays enabled
            </div>
          )}
          {isEnabled('CONTRACT_OVERLAY') && <ContractOverlay />}
        </div>

        {/* Right Dock */}
        <RightDock uiConfig={uiConfig} setUiConfig={setUiConfig} isEnabled={isEnabled} />
        {/* Bottom Dock */}
        <BottomDock
          runId={activeRunId}
          onStartDemo={startDemoRun}
          onStartLive={startLive}
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
    </div>
  );
}

/**
 * Right Dock: Inspector, Media Preview, Properties (placeholder)
 */
function RightDock({ uiConfig, setUiConfig, isEnabled }: { uiConfig: Partial<Record<keyof typeof FeatureFlags, boolean>>; setUiConfig: React.Dispatch<React.SetStateAction<Partial<Record<keyof typeof FeatureFlags, boolean>>>>; isEnabled: (f: keyof typeof FeatureFlags) => boolean }) {
  return (
    <div
      className="pointer-events-auto absolute top-2 right-2 bottom-32 w-[360px] rounded-lg border text-foreground shadow-sm overflow-hidden flex flex-col"
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        bottom: 128,
        width: 360,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
        zIndex: 40,
        backgroundColor: 'hsl(var(--card))',
      }}
    >
      <div className="h-9 border-b flex items-center px-3 text-xs font-medium bg-muted/50">Inspector</div>
      <div className="flex-1 overflow-auto p-3 text-xs text-gray-600 dark:text-gray-300">
        <PropertyInspector />
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
}: {
  runId: string | null;
  onStartDemo: () => void;
  onStartLive?: () => void;
  isEnabled?: (flag: keyof typeof FeatureFlags) => boolean;
}) {
  // Interactive tabs
  const isEnabledLocal = isEnabled ?? (() => true);
  const initialTab = ((): 'Console' | 'Run Queue' | 'Timeline' | 'Issues' | 'Runs' => {
    try {
      const stored = localStorage.getItem('mc_bottom_active_tab') as any;
      if (stored) return stored;
    } catch {}
    return isEnabledLocal('NEW_STREAMING') ? 'Timeline' : 'Console';
  })();
  const [activeTab, setActiveTabRaw] = React.useState<'Console' | 'Run Queue' | 'Timeline' | 'Issues' | 'Runs'>(initialTab);
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
      className="pointer-events-auto absolute left-2 right-[376px] bottom-2 h-56 rounded-lg border text-foreground shadow-sm overflow-hidden flex flex-col"
      style={{
        position: 'absolute',
        left: 8,
        right: 376,
        bottom: 8,
        height: 224,
        display: 'flex',
        flexDirection: 'column',
        pointerEvents: 'auto',
        zIndex: 35,
        backgroundColor: 'hsl(var(--card))',
      }}
    >
      <div className="h-8 border-b bg-muted/50 text-xs">
        <div className="h-full flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <TabBadge label="Console" active={activeTab === 'Console'} onClick={() => setActiveTab('Console')} />
            <TabBadge label="Run Queue" active={activeTab === 'Run Queue'} onClick={() => setActiveTab('Run Queue')} />
            {isEnabledLocal('NEW_STREAMING') && (
              <TabBadge label="Timeline" active={activeTab === 'Timeline'} onClick={() => setActiveTab('Timeline')} badge={timelineCount} />
            )}
            {isEnabledLocal('ORCHESTRATOR_PANEL') && (
              <TabBadge label="Runs" active={activeTab === 'Runs'} onClick={() => setActiveTab('Runs')} />
            )}
            <TabBadge label="Issues" active={activeTab === 'Issues'} onClick={() => setActiveTab('Issues')} badge={issuesCount} />
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
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-0 text-xs text-gray-700 dark:text-gray-300">
        {activeTab === 'Console' && <ConsolePanel runId={runId} />}
        {activeTab === 'Run Queue' && (
          <div className="p-2 font-mono text-[11px] text-gray-600 dark:text-gray-400">
            › Run Queue placeholder. Queue controls will appear here.
          </div>
        )}
        {activeTab === 'Runs' && isEnabledLocal('ORCHESTRATOR_PANEL') && <RunsPanel />}
        {activeTab === 'Timeline' && isEnabledLocal('NEW_STREAMING') && <TimelinePanel runId={runId} />}
        {activeTab === 'Timeline' && !FeatureFlags.NEW_STREAMING && (
          <div className="p-2 font-mono text-[11px] text-gray-600">
            › Streaming disabled. Enable NEW_STREAMING flag to view Timeline.
          </div>
        )}
        {activeTab === 'Issues' && <IssuesPanel onCountChange={setIssuesCount} />}
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

export default MissionControlLayout;