/**
 * MissionControlLayout - Main layout using compound components
 *
 * Simplified layout (~480 lines) using:
 * - WorkspaceProvider for shared state
 * - Compound components (TopBar, LeftSidebar, BottomDock)
 * - react-resizable-panels for resizable panel layout
 */

import React, { useCallback, useMemo, useEffect, useState } from 'react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { ReactFlowProvider } from 'reactflow';

// Layout components
import { WorkspaceProvider, useWorkspace } from './WorkspaceProvider';
import { TopBar } from './TopBar';
import { LeftSidebar } from './LeftSidebar';
import { BottomDock } from './BottomDock';

// Stores
import { useLayoutStore, useFlowStore, useReactFlowStore } from '@/stores';
import { useToast } from '@/contexts/ToastContext';

// UI components
import { StreamingCanvas } from '../../StreamingCanvas';
import { PanelErrorBoundary } from '@/components/ui/PanelErrorBoundary';
import { KeyboardShortcutsDialog } from '@/components/ui/KeyboardShortcutsDialog';
import { CommandPalette, type Command } from '@/components/ui/CommandPalette';
import { ConnectionStatusBanner } from '@/components/ui/ConnectionStatusBanner';
import { NodeContextMenu } from '../menus/NodeContextMenu';
import InspectorPanel from '../panels/InspectorPanel';
import NetworkPanel from '../panels/NetworkPanel';
import LineageOverlay from '../overlays/LineageOverlay';
import PolicyOverlay from '../overlays/PolicyOverlay';

// Hooks
import { useKeyboardShortcuts, type KeyboardShortcut, commonShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAutoSave } from '@/hooks/useAutoSave';

// ─────────────────────────────────────────────────────────────────────────────
// Main Layout Component (exported)
// ─────────────────────────────────────────────────────────────────────────────

export function MissionControlLayout() {
  return (
    <WorkspaceProvider>
      <MissionControlInner />
    </WorkspaceProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner Layout (has access to workspace context)
// ─────────────────────────────────────────────────────────────────────────────

function MissionControlInner() {
  const { darkMode } = useLayoutStore();
  const {
    activeRunId,
    cogpakUi,
    setCogpakUi,
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
    startDemoRun,
    startLiveConnection,
    startOrchestratorRun,
    setMainView,
  } = useWorkspace();

  const { mainView, setMainView: setLayoutMainView } = useLayoutStore();

  // Apply dark mode to document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Flow store for undo/redo
  const { undo, redo, canUndo, canRedo } = useFlowStore();

  // ReactFlow store for clipboard/selection
  const {
    copySelected,
    pasteClipboard,
    duplicateSelected,
    deleteSelected,
    selectAll,
    deselectAll,
    nudgeSelected,
    contextMenu,
    closeContextMenu,
  } = useReactFlowStore();

  const toast = useToast();

  // Auto-save
  const { saveNow } = useAutoSave({
    enabled: true,
    debounceMs: 1500,
    onSave: (flowId) => console.log(`[AutoSave] Flow ${flowId} saved`),
    onError: (error, flowId) => console.error(`[AutoSave] Failed to save ${flowId}:`, error),
  });

  // Keyboard shortcuts
  const shortcuts = useShortcuts({
    commandPaletteOpen,
    setCommandPaletteOpen,
    shortcutsDialogOpen,
    setShortcutsDialogOpen,
    lineageOverlayOpen,
    setLineageOverlayOpen,
    policyOverlayOpen,
    setPolicyOverlayOpen,
    settingsOpen,
    setSettingsOpen,
    cogpakUi,
    setCogpakUi,
    startOrchestratorRun,
    saveNow,
    undo,
    redo,
    canUndo,
    canRedo,
    copySelected,
    pasteClipboard,
    duplicateSelected,
    deleteSelected,
    selectAll,
    deselectAll,
    nudgeSelected,
    contextMenu,
    closeContextMenu,
    toast,
  });

  useKeyboardShortcuts(shortcuts);

  // Command palette commands
  const commands = useCommands({
    setMainView: setLayoutMainView,
    startOrchestratorRun,
    startDemoRun,
    undo,
    redo,
    canUndo,
    canRedo,
    setLineageOverlayOpen,
    setPolicyOverlayOpen,
    setSettingsOpen,
    setShortcutsDialogOpen,
  });

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top Bar */}
      <TopBar />

      {/* Main Content Area - Horizontal PanelGroup */}
      <PanelGroup direction="horizontal" className="flex-1">
        {/* Left Sidebar */}
        <LeftSidebar />

        {/* Center: Canvas + Bottom Dock (nested vertical PanelGroup) */}
        <Panel defaultSize={65} minSize={40}>
          <PanelGroup direction="vertical" className="h-full">
            {/* Main Canvas Panel */}
            <Panel defaultSize={75} minSize={40}>
              <div className="h-full relative">
                {mainView === 'network' ? (
                  <NetworkPanel runId={activeRunId} />
                ) : (
                  <ReactFlowProvider>
                    <StreamingCanvas />
                    {/* CogPak Overlay */}
                    {cogpakUi && (
                      <CogpakOverlay cogpakUi={cogpakUi} onClose={() => setCogpakUi(null)} />
                    )}
                  </ReactFlowProvider>
                )}
              </div>
            </Panel>

            {/* Bottom Dock */}
            <BottomDock />
          </PanelGroup>
        </Panel>

        {/* Right Sidebar: Inspector */}
        <RightInspector runId={activeRunId} />
      </PanelGroup>

      {/* Overlays and Dialogs */}
      <KeyboardShortcutsDialog
        shortcuts={shortcuts}
        isOpen={shortcutsDialogOpen}
        onClose={() => setShortcutsDialogOpen(false)}
      />
      <CommandPalette
        commands={commands}
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
      {lineageOverlayOpen && (
        <LineageOverlay runId={activeRunId} onClose={() => setLineageOverlayOpen(false)} />
      )}
      {policyOverlayOpen && (
        <PolicyOverlay runId={activeRunId} onClose={() => setPolicyOverlayOpen(false)} />
      )}

      {/* Settings Drawer */}
      {settingsOpen && <SettingsDrawer onClose={() => setSettingsOpen(false)} />}

      {/* Connection Status Banner */}
      <ConnectionStatusBanner onRetry={startLiveConnection} />

      {/* Node Context Menu */}
      <NodeContextMenu />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Right Inspector Panel
// ─────────────────────────────────────────────────────────────────────────────

function RightInspector({ runId }: { runId: string | null }) {
  return (
    <>
      <PanelResizeHandle className="w-1 hover:bg-primary/20 transition-colors cursor-col-resize" />
      <Panel defaultSize={20} minSize={15} maxSize={30} className="bg-card flex flex-col">
        <div className="h-10 border-b flex items-center px-4 text-xs font-medium">
          Inspector
        </div>
        <div className="flex-1 overflow-auto p-3 text-xs">
          <PanelErrorBoundary panelName="Inspector">
            <InspectorPanel runId={runId} />
          </PanelErrorBoundary>
        </div>
      </Panel>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CogPak Overlay (without innerHTML - uses textContent for safety)
// ─────────────────────────────────────────────────────────────────────────────

function CogpakOverlay({
  cogpakUi,
  onClose,
}: {
  cogpakUi: { url: string; title: string };
  onClose: () => void;
}) {
  const { isEnabled } = useWorkspace();
  const mountRef = React.useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEnabled('ALLOW_REMOTE_COGPAK_UI')) {
      setError('Remote CogPak UI is disabled');
      return;
    }

    const container = mountRef.current;
    if (!container) return;

    const script = document.createElement('script');
    script.src = cogpakUi.url;
    script.async = true;

    script.onload = () => {
      try {
        const globalAny = window as unknown as Record<string, unknown>;
        // Try common global first
        const psycheRemote = globalAny['PsycheSimRemote'] as { mount?: (el: HTMLElement, opts: null) => void } | undefined;
        if (psycheRemote && typeof psycheRemote.mount === 'function') {
          psycheRemote.mount(container, null);
          return;
        }
        // Scan for any global with mount()
        for (const k of Object.keys(globalAny)) {
          try {
            const v = globalAny[k] as { mount?: (el: HTMLElement, opts: null) => void } | undefined;
            if (v && typeof v.mount === 'function') {
              v.mount(container, null);
              return;
            }
          } catch { /* continue */ }
        }
        setError('Loaded remoteEntry but could not find mount() function.');
      } catch (err) {
        setError(`Error mounting remoteEntry: ${String(err)}`);
      }
    };

    script.onerror = () => {
      setError(`Failed to load remoteEntry: ${cogpakUi.url}`);
    };

    document.body.appendChild(script);

    return () => {
      try {
        document.body.removeChild(script);
      } catch { /* ignore */ }
      // Clear container using safe DOM method
      if (container) {
        while (container.firstChild) {
          container.removeChild(container.firstChild);
        }
      }
    };
  }, [cogpakUi, isEnabled]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-11/12 h-5/6 bg-card rounded-lg shadow-lg p-4 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <span className="font-medium">{cogpakUi.title}</span>
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm border rounded hover:bg-muted"
          >
            Close
          </button>
        </div>
        <div ref={mountRef} className="flex-1 overflow-auto">
          {error && (
            <pre className="text-red-500 text-sm p-4 bg-red-50 dark:bg-red-900/20 rounded">
              {error}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings Drawer
// ─────────────────────────────────────────────────────────────────────────────

function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const { uiConfig, setFeatureOverride, isEnabled } = useWorkspace();

  // Get all feature flag keys from the config module
  const featureFlags = ['MULTIMODAL_UPLOAD', 'NEW_STREAMING', 'S3_STORAGE', 'ALLOW_REMOTE_COGPAK_UI', 'CONNECT_WS', 'NETWORK_PANEL', 'ORCHESTRATOR_PANEL', 'MISSION_CONSOLE', 'MISSION_GRAPH'] as const;

  return (
    <div className="fixed top-16 right-4 w-80 rounded-lg border bg-card shadow-lg p-4 z-50">
      <div className="flex items-center justify-between mb-4">
        <span className="font-medium">UI Settings</span>
        <button onClick={onClose} className="text-xs px-2 py-1 border rounded hover:bg-muted">
          Close
        </button>
      </div>
      <div className="space-y-2 text-sm">
        {featureFlags.map((flag) => (
          <label key={flag} className="flex items-center justify-between">
            <span className="capitalize text-muted-foreground">
              {flag.replace(/_/g, ' ').toLowerCase()}
            </span>
            <input
              type="checkbox"
              checked={isEnabled(flag)}
              onChange={(e) => setFeatureOverride(flag, e.target.checked)}
              className="rounded"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks: Keyboard Shortcuts
// ─────────────────────────────────────────────────────────────────────────────

interface ShortcutDeps {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  shortcutsDialogOpen: boolean;
  setShortcutsDialogOpen: (open: boolean) => void;
  lineageOverlayOpen: boolean;
  setLineageOverlayOpen: (open: boolean) => void;
  policyOverlayOpen: boolean;
  setPolicyOverlayOpen: (open: boolean) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  cogpakUi: { url: string; title: string } | null;
  setCogpakUi: (ui: { url: string; title: string } | null) => void;
  startOrchestratorRun: () => Promise<void>;
  saveNow: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  copySelected: () => number;
  pasteClipboard: () => number;
  duplicateSelected: () => number;
  deleteSelected: () => number;
  selectAll: () => void;
  deselectAll: () => void;
  nudgeSelected: (dx: number, dy: number) => void;
  contextMenu: { isOpen: boolean };
  closeContextMenu: () => void;
  toast: { success: (msg: string) => void; info: (msg: string) => void };
}

function useShortcuts(deps: ShortcutDeps): KeyboardShortcut[] {
  return useMemo<KeyboardShortcut[]>(() => [
    { ...commonShortcuts.commandPalette(() => deps.setCommandPaletteOpen(true)), description: 'Open command palette' },
    { ...commonShortcuts.undo(() => deps.canUndo() && deps.undo()), description: 'Undo', enabled: deps.canUndo() },
    { ...commonShortcuts.redo(() => deps.canRedo() && deps.redo()), description: 'Redo', enabled: deps.canRedo() },
    { key: 'r', ctrlKey: true, description: 'Run flow', action: deps.startOrchestratorRun, preventDefault: true },
    { key: 's', ctrlKey: true, description: 'Save flow', action: deps.saveNow, preventDefault: true },
    {
      ...commonShortcuts.escape(() => {
        if (deps.commandPaletteOpen) deps.setCommandPaletteOpen(false);
        else if (deps.shortcutsDialogOpen) deps.setShortcutsDialogOpen(false);
        else if (deps.lineageOverlayOpen) deps.setLineageOverlayOpen(false);
        else if (deps.policyOverlayOpen) deps.setPolicyOverlayOpen(false);
        else if (deps.settingsOpen) deps.setSettingsOpen(false);
        else if (deps.cogpakUi) deps.setCogpakUi(null);
        else if (deps.contextMenu.isOpen) deps.closeContextMenu();
        else deps.deselectAll();
      }),
      description: 'Close dialogs or deselect',
    },
    { key: 'l', ctrlKey: true, description: 'Toggle lineage', action: () => deps.setLineageOverlayOpen(!deps.lineageOverlayOpen), preventDefault: true },
    { key: 'p', ctrlKey: true, description: 'Toggle policy', action: () => deps.setPolicyOverlayOpen(!deps.policyOverlayOpen), preventDefault: true },
    { key: '?', shiftKey: true, description: 'Show shortcuts', action: () => deps.setShortcutsDialogOpen(true), preventDefault: true },
    { ...commonShortcuts.copy(() => { const n = deps.copySelected(); if (n) deps.toast.success(`Copied ${n} node${n > 1 ? 's' : ''}`); }), description: 'Copy' },
    { ...commonShortcuts.paste(() => { const n = deps.pasteClipboard(); if (n) deps.toast.success(`Pasted ${n} node${n > 1 ? 's' : ''}`); }), description: 'Paste' },
    { ...commonShortcuts.duplicate(() => { const n = deps.duplicateSelected(); if (n) deps.toast.success(`Duplicated ${n} node${n > 1 ? 's' : ''}`); }), description: 'Duplicate' },
    { ...commonShortcuts.selectAll(deps.selectAll), description: 'Select all' },
    { ...commonShortcuts.delete(() => { const n = deps.deleteSelected(); if (n) deps.toast.info(`Deleted ${n} node${n > 1 ? 's' : ''}`); }), description: 'Delete' },
    { key: 'ArrowUp', description: 'Nudge up', action: () => deps.nudgeSelected(0, -10), preventDefault: true },
    { key: 'ArrowDown', description: 'Nudge down', action: () => deps.nudgeSelected(0, 10), preventDefault: true },
    { key: 'ArrowLeft', description: 'Nudge left', action: () => deps.nudgeSelected(-10, 0), preventDefault: true },
    { key: 'ArrowRight', description: 'Nudge right', action: () => deps.nudgeSelected(10, 0), preventDefault: true },
  ], [deps]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks: Command Palette Commands
// ─────────────────────────────────────────────────────────────────────────────

interface CommandDeps {
  setMainView: (view: 'canvas' | 'network' | 'flow' | 'code') => void;
  startOrchestratorRun: () => Promise<void>;
  startDemoRun: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  setLineageOverlayOpen: (open: boolean) => void;
  setPolicyOverlayOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
}

function useCommands(deps: CommandDeps): Command[] {
  return useMemo<Command[]>(() => [
    { id: 'goto-flow', label: 'Go to Flow Editor', category: 'Navigation', action: () => deps.setMainView('flow') },
    { id: 'goto-network', label: 'Go to Network View', category: 'Navigation', action: () => deps.setMainView('network') },
    { id: 'run-flow', label: 'Run Flow', category: 'Flow', shortcut: 'Ctrl+R', action: deps.startOrchestratorRun },
    { id: 'demo-run', label: 'Start Demo Run', category: 'Flow', action: deps.startDemoRun },
    { id: 'undo', label: 'Undo', category: 'Edit', shortcut: 'Ctrl+Z', action: deps.undo, disabled: !deps.canUndo() },
    { id: 'redo', label: 'Redo', category: 'Edit', shortcut: 'Ctrl+Shift+Z', action: deps.redo, disabled: !deps.canRedo() },
    { id: 'toggle-lineage', label: 'Toggle Lineage Overlay', category: 'View', shortcut: 'Ctrl+L', action: () => deps.setLineageOverlayOpen(true) },
    { id: 'toggle-policy', label: 'Toggle Policy Overlay', category: 'View', shortcut: 'Ctrl+P', action: () => deps.setPolicyOverlayOpen(true) },
    { id: 'open-settings', label: 'Open Settings', category: 'Settings', action: () => deps.setSettingsOpen(true) },
    { id: 'show-shortcuts', label: 'Keyboard Shortcuts', category: 'Help', shortcut: 'Shift+?', action: () => deps.setShortcutsDialogOpen(true) },
  ], [deps]);
}

export default MissionControlLayout;
