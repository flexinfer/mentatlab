/**
 * TopBar - Mission Control header with navigation and controls
 *
 * Extracted from MissionControlLayout to enable compound component pattern.
 * Contains:
 * - Logo and title
 * - View mode switcher (Canvas, Network, Flow, Code)
 * - Run controls
 * - Theme toggle
 * - Settings and help buttons
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { CircleHelp, Moon, Search, Settings, Sun } from 'lucide-react';
import { useLayoutStore, useCanvasStore } from '@/stores';
import { useStreamingStore } from '@/stores';
import { useWorkspace } from './WorkspaceProvider';
import { exportFlowToLoom, importLoomToFlow } from '@/utils/loomWorkflowBridge';
import { StreamConnectionState } from '@/types/streaming';
import { SaveStatusIndicator } from '@/components/ui/SaveStatusIndicator';
import type { AutoSaveState } from '@/hooks/useAutoSave';
import type { MainViewMode } from '@/stores/layout';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ViewModeButtonProps {
  mode: MainViewMode;
  label: string;
  active: boolean;
  onClick: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ViewModeButton({ mode, label, active, onClick }: ViewModeButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TopBar Component
// ─────────────────────────────────────────────────────────────────────────────

export interface TopBarProps {
  className?: string;
  saveState?: Pick<AutoSaveState, 'status' | 'lastSavedAt' | 'pendingChanges' | 'error' | 'saveNow'>;
}

export function TopBar({ className = '', saveState }: TopBarProps) {
  const { mainView, setMainView, darkMode, toggleDarkMode } = useLayoutStore();
  const { nodes, edges, setNodes, setEdges } = useCanvasStore();
  const {
    isEnabled,
    isLiveConnected,
    setSettingsOpen,
    setShortcutsDialogOpen,
    setCommandPaletteOpen,
    startDemoRun,
    startLiveConnection,
    stopLiveConnection,
    startOrchestratorRun,
  } = useWorkspace();

  const viewModes: { mode: MainViewMode; label: string }[] = [
    { mode: 'canvas', label: 'Canvas' },
    { mode: 'network', label: 'Network' },
    { mode: 'flow', label: 'Flow' },
    { mode: 'code', label: 'Code' },
  ];

  const handleExportToLoom = async () => {
    try {
      const name = window.prompt('Enter Loom Workflow Name:', 'mentatlab-export');
      if (!name) return;
      const description = window.prompt('Enter Description:', 'Exported from MentatLab');

      const payload = exportFlowToLoom({ name, description: description || '' }, nodes, edges);

      const res = await fetch('/api/v1/mcp/tools/agent_workflow_define/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`Failed to export: ${res.statusText}`);
      }
      const data = await res.json();
      alert(`Exported successfully! Response: ${JSON.stringify(data)}`);
    } catch (e: any) {
      alert(`Export failed: ${e.message}`);
    }
  };

  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const json = JSON.parse(event.target?.result as string);
          const { nodes: newNodes, edges: newEdges } = importLoomToFlow(json);
          setNodes(newNodes);
          setEdges(newEdges);
          alert('Imported Loom workflow successfully');
        } catch (err: any) {
          alert(`Import failed: ${err.message}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <header
      className={`mc-shell flex h-12 items-center justify-between overflow-x-auto rounded-none border-x-0 border-t-0 px-4 ${className}`}
    >
      {/* Left: Logo and title */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md border border-primary/20 bg-primary/10 flex items-center justify-center">
            <span className="text-xs font-bold text-primary">M</span>
          </div>
          <span className="font-semibold text-sm">MentatLab</span>
        </div>

        {/* View mode switcher */}
        <div className="mc-control-surface flex items-center gap-1 p-0.5">
          {viewModes.map(({ mode, label }) => (
            <ViewModeButton
              key={mode}
              mode={mode}
              label={label}
              active={mainView === mode}
              onClick={() => setMainView(mode)}
            />
          ))}
        </div>
      </div>

      {/* Center: Connection status indicator (compact) */}
      <div className="flex-1 flex justify-center">
        <ConnectionStatusIndicator />
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        {/* Save status */}
        <SaveStatusIndicator state={saveState} />

        {/* Run controls */}
        <div className="ml-2 flex items-center gap-1 border-l border-border/70 pl-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleImportClick}
            className="text-xs h-7"
            title="Import Loom Workflow"
          >
            Import
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExportToLoom}
            className="text-xs h-7"
            title="Export to Loom Workflow"
          >
            Export
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={startDemoRun}
            className="text-xs h-7 border-l border-border/70 pl-2 ml-1"
            title="Start demo run (Cmd+D)"
          >
            Demo
          </Button>
          {isEnabled('CONNECT_WS') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (isLiveConnected) {
                  stopLiveConnection();
                  return;
                }
                void startLiveConnection();
              }}
              className="text-xs h-7"
              title={isLiveConnected ? 'Disconnect live' : 'Connect live'}
            >
              {isLiveConnected ? 'Disconnect' : 'Live'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={startOrchestratorRun}
            className="text-xs h-7"
            title="Run via orchestrator (Cmd+R)"
          >
            Run
          </Button>
        </div>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleDarkMode}
          className="h-7 w-7"
          title={`Toggle ${darkMode ? 'light' : 'dark'} mode (Cmd+T)`}
        >
          {darkMode ? (
            <Sun className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>

        {/* Command palette */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCommandPaletteOpen(true)}
          className="h-7 w-7"
          title="Command palette (Cmd+K)"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>

        {/* Keyboard shortcuts help */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShortcutsDialogOpen(true)}
          className="h-7 w-7"
          title="Keyboard shortcuts (Shift+?)"
        >
          <CircleHelp className="h-4 w-4" aria-hidden="true" />
        </Button>

        {/* Settings */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          className="h-7 w-7"
          title="Settings"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ConnectionStatusIndicator - compact inline status for the header
// Retry is handled by the canonical ConnectionStatusBanner in MissionControlLayout.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { dot: string; label: string; text: string }> = {
  [StreamConnectionState.CONNECTED]: { dot: 'bg-emerald-500', label: 'Connected', text: 'text-emerald-600 dark:text-emerald-400' },
  [StreamConnectionState.CONNECTING]: { dot: 'bg-sky-500 animate-pulse', label: 'Connecting…', text: 'text-sky-600 dark:text-sky-400' },
  [StreamConnectionState.RECONNECTING]: { dot: 'bg-amber-500 animate-pulse', label: 'Reconnecting…', text: 'text-amber-600 dark:text-amber-400' },
  [StreamConnectionState.DISCONNECTED]: { dot: 'bg-zinc-500', label: 'Offline', text: 'text-zinc-600 dark:text-zinc-400' },
  [StreamConnectionState.ERROR]: { dot: 'bg-red-500', label: 'Error', text: 'text-red-600 dark:text-red-400' },
};

const TRANSPORT_LABELS: Record<string, string> = {
  websocket: 'WS',
  sse: 'SSE',
  simulation: 'Sim',
  none: '',
};

function ConnectionStatusIndicator() {
  const connectionStatus = useStreamingStore((s) => s.connectionStatus);
  const transportType = useStreamingStore((s) => s.transportType ?? 'none');
  if (connectionStatus === StreamConnectionState.DISCONNECTED) {
    return null;
  }
  const style = STATUS_STYLES[connectionStatus] ?? STATUS_STYLES[StreamConnectionState.ERROR];
  const transportLabel = TRANSPORT_LABELS[transportType] ?? '';

  return (
    <div className="mc-control-surface inline-flex items-center gap-1.5 px-2.5 py-1" data-testid="connection-indicator">
      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
      <span className={`text-[11px] font-medium ${style.text}`}>
        {style.label}{transportLabel && connectionStatus === StreamConnectionState.CONNECTED ? ` (${transportLabel})` : ''}
      </span>
    </div>
  );
}

export default TopBar;
