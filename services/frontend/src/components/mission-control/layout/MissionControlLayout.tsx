import React from 'react';
import { FeatureFlags } from '../../../config/features';
import FlowCanvas from '../../FlowCanvas';
import { Button } from '../../ui/button';
import TimelinePanel from '../panels/TimelinePanel';
import { flightRecorder } from '../../../services/mission-control/services';

export function MissionControlLayout() {
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);

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

  return (
    <div className="h-screen w-screen grid grid-rows-[48px_1fr_28px] grid-cols-[56px_1fr] bg-white text-gray-900">
      {/* Top Bar */}
      <header className="row-start-1 col-span-2 flex items-center justify-between px-4 border-b bg-white/70 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">MentatLab</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
            Mission Control
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <FlagPill label="MULTIMODAL_UPLOAD" enabled={FeatureFlags.MULTIMODAL_UPLOAD} />
          <FlagPill label="NEW_STREAMING" enabled={FeatureFlags.NEW_STREAMING} />
          <FlagPill label="S3_STORAGE" enabled={FeatureFlags.S3_STORAGE} />
        </div>
      </header>

      {/* Left Nav */}
      <aside className="row-start-2 col-start-1 border-r bg-gray-50">
        {/* Placeholder: Workspaces / Flows / Search */}
        <nav className="p-2 text-xs space-y-2">
          <SectionTitle>Workspaces</SectionTitle>
          <ul className="space-y-1 text-gray-600">
            <li className="px-2 py-1 rounded hover:bg-gray-100 cursor-pointer">Default</li>
          </ul>
          <SectionTitle className="mt-3">Flows</SectionTitle>
          <ul className="space-y-1 text-gray-600">
            <li className="px-2 py-1 rounded hover:bg-gray-100 cursor-pointer">example-flow</li>
          </ul>
        </nav>
      </aside>

      {/* Canvas */}
      <main className="row-start-2 col-start-2 relative overflow-hidden">
        <div className="absolute inset-0">
          {/* Canvas center of gravity */}
          <FlowCanvas />
        </div>

        {/* Overlays */}
        <div className="pointer-events-none absolute inset-0">
          {FeatureFlags.NEW_STREAMING && (
            <div className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              Streaming overlays enabled
            </div>
          )}
        </div>

        {/* Right Dock */}
        <RightDock />
        {/* Bottom Dock */}
        <BottomDock runId={activeRunId} onStartDemo={startDemoRun} />
      </main>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
}

/**
 * Right Dock: Inspector, Media Preview, Properties (placeholder)
 */
function RightDock() {
  return (
    <div className="pointer-events-auto absolute top-2 right-2 bottom-32 w-[360px] rounded-lg border bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="h-9 border-b flex items-center px-3 text-xs font-medium bg-gray-50">Inspector</div>
      <div className="flex-1 overflow-auto p-3 text-xs text-gray-600">
        <p className="mb-2">Select a node to configure pins and parameters.</p>
        <div className="mt-3 rounded border p-2 bg-gray-50">
          <div className="text-[11px] font-semibold mb-1">Media Preview</div>
          <div className="h-24 rounded bg-white border flex items-center justify-center text-[11px] text-gray-400">
            No preview
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Bottom Dock: Console, Runs, Timeline (placeholder)
 */
function BottomDock({ runId, onStartDemo }: { runId: string | null; onStartDemo: () => void }) {
  return (
    <div className="pointer-events-auto absolute left-2 right-[376px] bottom-2 h-56 rounded-lg border bg-white shadow-sm overflow-hidden flex flex-col">
      <div className="h-8 border-b bg-gray-50 text-xs">
        <div className="h-full flex items-center justify-between px-3">
          <div className="flex items-center gap-3">
            <TabBadge label="Console" active />
            <TabBadge label="Run Queue" />
            {FeatureFlags.NEW_STREAMING && <TabBadge label="Timeline" />}
            <TabBadge label="Issues" />
          </div>
          <div className="flex items-center gap-2">
            {FeatureFlags.MULTIMODAL_UPLOAD && (
              <Button
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={() => console.log('[UI] Add Artifact clicked')}
              >
                + Add Artifact
              </Button>
            )}
            {FeatureFlags.NEW_STREAMING && (
              <Button
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={onStartDemo}
              >
                ▶ Start Demo Run
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-0 text-xs text-gray-700">
        {FeatureFlags.NEW_STREAMING ? (
          <TimelinePanel runId={runId} />
        ) : (
          <div className="p-2 font-mono text-[11px] text-gray-600">› Streaming disabled. Enable NEW_STREAMING flag to view Timeline.</div>
        )}
      </div>
    </div>
  );
}

/**
 * Status Bar: env/feature/connection health (placeholder)
 */
function StatusBar() {
  return (
    <footer className="row-start-3 col-span-2 px-3 flex items-center justify-between text-[11px] border-t bg-white/80 backdrop-blur">
      <div className="flex items-center gap-3 text-gray-600">
        <span className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Connected
        </span>
        <span className="text-gray-300">|</span>
        <span>WS: &lt;100ms target</span>
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
        enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200',
      ].join(' ')}
      title={enabled ? 'Enabled' : 'Disabled'}
    >
      {label}
    </span>
  );
}

function TabBadge({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <span
      className={[
        'px-2 py-0.5 rounded text-[11px] border',
        active ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-gray-600 border-gray-200',
      ].join(' ')}
    >
      {label}
    </span>
  );
}

function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={['text-[10px] uppercase tracking-wide text-gray-400 px-2', className].join(' ')}>{children}</div>;
}

export default MissionControlLayout;