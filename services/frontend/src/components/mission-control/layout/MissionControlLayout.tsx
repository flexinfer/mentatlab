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
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
} from 'reactflow';

// Layout components
import { WorkspaceProvider, useWorkspace } from './WorkspaceProvider';
import { TopBar } from './TopBar';
import { LeftSidebar } from './LeftSidebar';
import { BottomDock } from './BottomDock';

// Stores
import { useLayoutStore, useFlowStore, useCanvasStore } from '@/stores';
import { useToast } from '@/contexts/ToastContext';

// UI components
import { StreamingCanvas } from '../../StreamingCanvas';
import { PanelErrorBoundary } from '@/components/ui/PanelErrorBoundary';
import { KeyboardShortcutsDialog } from '@/components/ui/KeyboardShortcutsDialog';
import { CommandPalette, type Command } from '@/components/ui/CommandPalette';
import { ConnectionStatusBanner } from '@/components/ui/ConnectionStatusBanner';
import { PanelShell } from '@/components/ui/PanelShell';
import { NodeContextMenu } from '../menus/NodeContextMenu';
import InspectorPanel from '../panels/InspectorPanel';
import NetworkPanel from '../panels/NetworkPanel';
import LineageOverlay from '../overlays/LineageOverlay';
import PolicyOverlay from '../overlays/PolicyOverlay';

// Canvas components
import { CanvasDropZone, NodePalette, QuickAddMenu } from '../canvas';

// Hooks
import { useKeyboardShortcuts, type KeyboardShortcut, commonShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAutoSave } from '@/hooks/useAutoSave';
import ChatNode from '@/nodes/ChatNode';
import ConditionalNode from '@/nodes/ConditionalNode';
import ForEachNode from '@/nodes/ForEachNode';
import GateNode from '@/nodes/GateNode';
import PythonCodeNode from '@/nodes/PythonCodeNode';

const flowNodeTypes = {
  chat: ChatNode,
  pythonCode: PythonCodeNode,
  conditional: ConditionalNode,
  forEach: ForEachNode,
  gate: GateNode,
} as const;

const BackgroundAny = Background as any;
const ControlsAny = Controls as any;
const MiniMapAny = MiniMap as any;

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
  } = useWorkspace();

  const { mainView, setMainView: setLayoutMainView } = useLayoutStore();

  // Node palette and quick add menu state
  const [nodePaletteOpen, setNodePaletteOpen] = useState(false);
  const [quickAddMenuOpen, setQuickAddMenuOpen] = useState(false);

  // Apply dark mode to document
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  // Flow store for undo/redo
  const { undo, redo, canUndo, canRedo } = useFlowStore();
  const canvasNodes = useCanvasStore((state) => state.nodes);
  const canvasEdges = useCanvasStore((state) => state.edges);

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
  } = useCanvasStore();

  const toast = useToast();

  // Auto-save
  const autoSave = useAutoSave({
    enabled: true,
    debounceMs: 1500,
    onSave: (flowId) => console.log(`[AutoSave] Flow ${flowId} saved`),
    onError: (error, flowId) => console.error(`[AutoSave] Failed to save ${flowId}:`, error),
  });
  const { saveNow } = autoSave;

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
    nodePaletteOpen,
    setNodePaletteOpen,
    quickAddMenuOpen,
    setQuickAddMenuOpen,
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
    nodePaletteOpen,
    setNodePaletteOpen,
    quickAddMenuOpen,
    setQuickAddMenuOpen,
  });

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top Bar */}
      <TopBar saveState={autoSave} />

      {/* Canonical, layout-aware connection status surface */}
      <ConnectionStatusBanner onRetry={startLiveConnection} className="mx-4 mt-2" />

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
                {mainView === 'canvas' && (
                  <CanvasWorkspace
                    activeRunId={activeRunId}
                    nodePaletteOpen={nodePaletteOpen}
                    setNodePaletteOpen={setNodePaletteOpen}
                    quickAddMenuOpen={quickAddMenuOpen}
                    setQuickAddMenuOpen={setQuickAddMenuOpen}
                    cogpakUi={cogpakUi}
                    setCogpakUi={setCogpakUi}
                  />
                )}
                {mainView === 'network' && <NetworkPanel runId={activeRunId} />}
                {mainView === 'flow' && <FlowWorkspace sessionCount={canvasNodes.length} />}
                {mainView === 'code' && (
                  <CodeWorkspace
                    nodes={canvasNodes}
                    edges={canvasEdges}
                    activeRunId={activeRunId}
                  />
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

      {/* Node Context Menu */}
      <NodeContextMenu />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Workspace Variants
// ─────────────────────────────────────────────────────────────────────────────

function CanvasWorkspace({
  activeRunId,
  nodePaletteOpen,
  setNodePaletteOpen,
  quickAddMenuOpen,
  setQuickAddMenuOpen,
  cogpakUi,
  setCogpakUi,
}: {
  activeRunId: string | null;
  nodePaletteOpen: boolean;
  setNodePaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  quickAddMenuOpen: boolean;
  setQuickAddMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  cogpakUi: { url: string; title: string } | null;
  setCogpakUi: (ui: { url: string; title: string } | null) => void;
}) {
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const onNodesChange = useCanvasStore((state) => state.onNodesChange);
  const onEdgesChange = useCanvasStore((state) => state.onEdgesChange);
  const onConnect = useCanvasStore((state) => state.onConnect);
  const setSelectedNodeId = useCanvasStore((state) => state.setSelectedNodeId);

  return (
    <div className="flex h-full">
      <NodePalette
        collapsed={!nodePaletteOpen}
        onToggleCollapse={() => setNodePaletteOpen((open) => !open)}
      />

      <div className="min-w-0 flex-1 p-4">
        <ReactFlowProvider>
          <PanelShell
            title={
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                    Canvas
                  </div>
                  <div className="text-sm font-semibold text-foreground">Workflow Builder</div>
                </div>
                <div className="hidden items-center gap-2 text-[11px] text-muted-foreground lg:flex">
                  <span>{nodes.length} nodes</span>
                  <span className="text-border">/</span>
                  <span>{edges.length} edges</span>
                  {activeRunId && (
                    <>
                      <span className="text-border">/</span>
                      <span className="font-mono text-[10px]">{activeRunId}</span>
                    </>
                  )}
                </div>
              </div>
            }
            toolbar={
              <button
                onClick={() => setQuickAddMenuOpen(true)}
                className="rounded-md border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
              >
                Add Node
              </button>
            }
            className="h-full overflow-hidden"
          >
            <CanvasDropZone className="h-full">
              <div className="relative h-full min-h-[420px]">
                <ReactFlow
                  nodeTypes={flowNodeTypes as any}
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={onConnect}
                  onSelectionChange={(selection: any) => {
                    const firstNodeId = selection?.nodes?.[0]?.id ?? null;
                    setSelectedNodeId(firstNodeId);
                  }}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  proOptions={{ hideAttribution: true }}
                >
                  <BackgroundAny gap={20} color="hsl(var(--border))" />
                  <MiniMapAny className="!bg-card/90" pannable zoomable />
                  <ControlsAny position="bottom-right" />
                </ReactFlow>

                {nodes.length === 0 && (
                  <div className="pointer-events-none absolute inset-x-8 top-8 max-w-sm rounded-xl border border-dashed border-border/80 bg-background/88 p-4 shadow-lg backdrop-blur">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                      Empty Workflow
                    </div>
                    <div className="mt-2 text-sm font-semibold text-foreground">
                      Start by dragging a node into the canvas.
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Use the palette on the left or press <span className="font-mono">/</span> to open quick add.
                    </div>
                  </div>
                )}
              </div>
            </CanvasDropZone>

            {cogpakUi && (
              <CogpakOverlay cogpakUi={cogpakUi} onClose={() => setCogpakUi(null)} />
            )}
            <QuickAddMenu
              isOpen={quickAddMenuOpen}
              onClose={() => setQuickAddMenuOpen(false)}
            />
          </PanelShell>
        </ReactFlowProvider>
      </div>
    </div>
  );
}

function FlowWorkspace({ sessionCount }: { sessionCount: number }) {
  return (
    <div className="h-full p-4">
      <PanelShell
        title={
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Flow
            </div>
            <div className="text-sm font-semibold text-foreground">Live Streaming</div>
          </div>
        }
        toolbar={
          <div className="text-[11px] text-muted-foreground">
            {sessionCount} workflow node{sessionCount === 1 ? '' : 's'} in the current canvas
          </div>
        }
        className="h-full overflow-hidden"
      >
        <div className="h-full p-4">
          <StreamingCanvas />
        </div>
      </PanelShell>
    </div>
  );
}

function CodeWorkspace({
  nodes,
  edges,
  activeRunId,
}: {
  nodes: ReturnType<typeof useCanvasStore.getState>['nodes'];
  edges: ReturnType<typeof useCanvasStore.getState>['edges'];
  activeRunId: string | null;
}) {
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const workflowSource = useMemo(
    () =>
      JSON.stringify(
        {
          runId: activeRunId,
          nodes: nodes.map((node) => ({
            id: node.id,
            type: node.type,
            position: node.position,
            data: node.data,
          })),
          edges: edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
          })),
        },
        null,
        2
      ),
    [activeRunId, edges, nodes]
  );

  return (
    <div className="grid h-full min-h-0 gap-4 p-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.9fr)]">
      <PanelShell
        title={
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Code
            </div>
            <div className="text-sm font-semibold text-foreground">Workflow Source</div>
          </div>
        }
        toolbar={
          <div className="text-[11px] text-muted-foreground">
            {nodes.length} nodes / {edges.length} edges
          </div>
        }
        className="min-h-0 overflow-hidden"
      >
        <div className="h-full overflow-auto bg-[#07111c]">
          <pre className="min-h-full whitespace-pre-wrap p-5 font-mono text-[12px] leading-6 text-cyan-100">
            {workflowSource}
          </pre>
        </div>
      </PanelShell>

      <PanelShell
        title={
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Focus
            </div>
            <div className="text-sm font-semibold text-foreground">
              {selectedNode ? selectedNode.id : 'No node selected'}
            </div>
          </div>
        }
        className="min-h-0 overflow-hidden"
      >
        <div className="h-full overflow-auto p-4">
          {selectedNode ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Type
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {selectedNode.type ?? 'unknown'}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Position
                </div>
                <div className="mt-1 font-mono text-xs text-foreground">
                  x={Math.round(selectedNode.position.x)}, y={Math.round(selectedNode.position.y)}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  Data
                </div>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-muted-foreground">
                  {JSON.stringify(selectedNode.data ?? {}, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/10 p-4 text-sm text-muted-foreground">
              Select a node in the canvas to inspect its source payload here.
            </div>
          )}
        </div>
      </PanelShell>
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
  nodePaletteOpen: boolean;
  setNodePaletteOpen: (open: boolean) => void;
  quickAddMenuOpen: boolean;
  setQuickAddMenuOpen: (open: boolean) => void;
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
    // Node palette and quick add shortcuts
    { key: 'n', description: 'Toggle node palette', action: () => deps.setNodePaletteOpen(!deps.nodePaletteOpen), preventDefault: true },
    { key: '/', description: 'Quick add node', action: () => deps.setQuickAddMenuOpen(true), preventDefault: true },
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
  nodePaletteOpen: boolean;
  setNodePaletteOpen: (open: boolean) => void;
  quickAddMenuOpen: boolean;
  setQuickAddMenuOpen: (open: boolean) => void;
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
    { id: 'toggle-node-palette', label: 'Toggle Node Palette', category: 'View', shortcut: 'n', action: () => deps.setNodePaletteOpen(!deps.nodePaletteOpen) },
    { id: 'quick-add-node', label: 'Quick Add Node', category: 'Workflow', shortcut: '/', action: () => deps.setQuickAddMenuOpen(true) },
  ], [deps]);
}

export default MissionControlLayout;
