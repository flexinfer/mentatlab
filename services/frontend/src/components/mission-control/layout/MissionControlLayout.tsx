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
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import {
  Activity,
  Bot,
  Camera,
  Download,
  FileInput,
  Image as ImageIcon,
  LayoutTemplate,
  Mic,
  PanelLeft,
  Plus,
  type LucideIcon,
  Sparkles,
  Upload,
  Wand2,
  Webhook,
} from 'lucide-react';

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
import { MediaNodeType } from '@/types/graph';
import { NODE_TYPES } from '@/nodes';
import ChatNode from '@/nodes/ChatNode';
import ConditionalNode from '@/nodes/ConditionalNode';
import ForEachNode from '@/nodes/ForEachNode';
import GateNode from '@/nodes/GateNode';
import PythonCodeNode from '@/nodes/PythonCodeNode';

type WorkflowNodeData = {
  label?: string;
  blueprint?: string;
  agent_id?: string;
  mcp_server?: string;
  runtime_contract?: {
    kind?: string;
    required_env?: string[];
  };
  tool_name?: string;
};

type WorkflowNodeMeta = {
  label: string;
  summary: string;
  accent: string;
  Icon: LucideIcon;
};

const MEDIA_NODE_META: Partial<Record<MediaNodeType, WorkflowNodeMeta>> = {
  [MediaNodeType.MEDIA_UPLOAD]: {
    label: 'Media Upload',
    summary: 'Ingest file, stream, or capture input',
    accent: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-500',
    Icon: Upload,
  },
  [MediaNodeType.CAMERA_CAPTURE]: {
    label: 'Camera',
    summary: 'Capture image or video from a device',
    accent: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-500',
    Icon: Camera,
  },
  [MediaNodeType.MICROPHONE_CAPTURE]: {
    label: 'Microphone',
    summary: 'Record audio for downstream agents',
    accent: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-500',
    Icon: Mic,
  },
  [MediaNodeType.IMAGE_RESIZE]: {
    label: 'Image Resize',
    summary: 'Normalize dimensions before analysis',
    accent: 'border-amber-500/35 bg-amber-500/10 text-amber-500',
    Icon: ImageIcon,
  },
  [MediaNodeType.IMAGE_FILTER]: {
    label: 'Image Filter',
    summary: 'Apply deterministic image transforms',
    accent: 'border-amber-500/35 bg-amber-500/10 text-amber-500',
    Icon: Wand2,
  },
  [MediaNodeType.AUDIO_TRANSCODE]: {
    label: 'Audio Transcode',
    summary: 'Convert audio formats for agents',
    accent: 'border-amber-500/35 bg-amber-500/10 text-amber-500',
    Icon: Activity,
  },
  [MediaNodeType.IMAGE_RECOGNITION]: {
    label: 'Image Recognition',
    summary: 'Classify visual content',
    accent: 'border-sky-500/35 bg-sky-500/10 text-sky-500',
    Icon: Bot,
  },
  [MediaNodeType.OBJECT_DETECTION]: {
    label: 'Object Detection',
    summary: 'Locate entities in visual media',
    accent: 'border-sky-500/35 bg-sky-500/10 text-sky-500',
    Icon: Bot,
  },
  [MediaNodeType.SPEECH_TO_TEXT]: {
    label: 'Speech to Text',
    summary: 'Transcribe audio into text',
    accent: 'border-sky-500/35 bg-sky-500/10 text-sky-500',
    Icon: Mic,
  },
  [MediaNodeType.TEXT_TO_SPEECH]: {
    label: 'Text to Speech',
    summary: 'Render text output as audio',
    accent: 'border-sky-500/35 bg-sky-500/10 text-sky-500',
    Icon: Activity,
  },
  [MediaNodeType.OCR]: {
    label: 'OCR',
    summary: 'Extract text from images or documents',
    accent: 'border-sky-500/35 bg-sky-500/10 text-sky-500',
    Icon: FileInput,
  },
  [MediaNodeType.IMAGE_GENERATION]: {
    label: 'Image Generation',
    summary: 'Create visual artifacts from prompts',
    accent: 'border-sky-500/35 bg-sky-500/10 text-sky-500',
    Icon: Wand2,
  },
  [MediaNodeType.MEDIA_DISPLAY]: {
    label: 'Media Display',
    summary: 'Preview generated artifacts',
    accent: 'border-indigo-500/35 bg-indigo-500/10 text-indigo-500',
    Icon: ImageIcon,
  },
  [MediaNodeType.MEDIA_DOWNLOAD]: {
    label: 'Media Download',
    summary: 'Export processed artifacts',
    accent: 'border-indigo-500/35 bg-indigo-500/10 text-indigo-500',
    Icon: Download,
  },
  [MediaNodeType.WEBHOOK_SENDER]: {
    label: 'Webhook',
    summary: 'Send workflow output downstream',
    accent: 'border-cyan-500/35 bg-cyan-500/10 text-cyan-500',
    Icon: Webhook,
  },
};

function MediaWorkflowNode({ data, type, selected }: NodeProps<WorkflowNodeData>) {
  const meta = MEDIA_NODE_META[type as MediaNodeType] ?? {
    label: 'Media Step',
    summary: 'Process multimodal workflow data',
    accent: 'border-primary/30 bg-primary/10 text-primary',
    Icon: Sparkles,
  };
  const label = data.label ?? meta.label;
  const Icon = meta.Icon;

  return (
    <div
      className={`relative min-w-[190px] rounded-md border bg-card px-3 py-2.5 text-[11px] shadow-sm transition ${
        selected ? 'border-primary shadow-primary/20' : 'border-border'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary !border-primary" />
      <div className="flex items-start gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${meta.accent}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground">{label}</div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{meta.summary}</div>
          {data.blueprint && (
            <div className="mt-2 inline-flex max-w-full rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              <span className="truncate">{data.blueprint}</span>
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary !border-primary" />
    </div>
  );
}

function MCPTemplateNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  const requiredEnv = data.runtime_contract?.required_env ?? [];
  const label = data.label ?? 'MCP Template';
  const toolName = data.tool_name ?? 'tool pending';

  return (
    <div
      className={`relative min-w-[220px] rounded-md border bg-card px-3 py-2.5 text-[11px] shadow-sm transition ${
        selected ? 'border-primary shadow-primary/20' : 'border-border'
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-primary !border-primary" />
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-violet-500/35 bg-violet-500/10 text-violet-500">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-foreground">{label}</div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {toolName}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-medium text-violet-500">
              {data.mcp_server || 'mcp'}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              {requiredEnv.length} env
            </span>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-primary !border-primary" />
    </div>
  );
}

const mediaFlowNodeTypes = Object.fromEntries(
  Object.values(MediaNodeType).map((type) => [type, MediaWorkflowNode])
);

const flowNodeTypes = {
  chat: ChatNode,
  pythonCode: PythonCodeNode,
  conditional: ConditionalNode,
  forEach: ForEachNode,
  gate: GateNode,
  ...mediaFlowNodeTypes,
  'mcp:flexinfer-template-readiness': MCPTemplateNode,
  'mcp:flexinfer-template-activate': MCPTemplateNode,
  'mcp:flexinfer-template-inference': MCPTemplateNode,
} as const;

const BackgroundAny = Background as any;
const ControlsAny = Controls as any;
const MiniMapAny = MiniMap as any;

type WorkflowTemplate = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  accent: string;
  nodes: Array<{
    type: string;
    label: string;
    position: { x: number; y: number };
    data?: Record<string, unknown>;
  }>;
  edges: Array<{
    source: number;
    target: number;
    label?: string;
  }>;
};

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'research-brief',
    eyebrow: 'Agent research',
    title: 'Research Brief',
    description: 'Collect source material, ask an agent to synthesize it, then route the output through a policy gate.',
    accent: 'from-cyan-400/30 via-sky-500/15 to-transparent',
    nodes: [
      { type: MediaNodeType.MEDIA_UPLOAD, label: 'Source Drop', position: { x: 60, y: 120 } },
      { type: NODE_TYPES.CHAT, label: 'Synthesis Agent', position: { x: 220, y: 80 }, data: { prompt: 'Summarize the evidence, cite assumptions, and identify next actions.' } },
      { type: NODE_TYPES.GATE, label: 'Human Review Gate', position: { x: 380, y: 120 } },
      { type: MediaNodeType.MEDIA_DOWNLOAD, label: 'Brief Export', position: { x: 540, y: 120 } },
    ],
    edges: [
      { source: 0, target: 1, label: 'sources' },
      { source: 1, target: 2, label: 'brief' },
      { source: 2, target: 3, label: 'approved' },
    ],
  },
  {
    id: 'media-pipeline',
    eyebrow: 'Multimodal ops',
    title: 'Media Pipeline',
    description: 'Ingest media, transform it, classify the result, and preview/download the artifact.',
    accent: 'from-emerald-400/30 via-teal-500/15 to-transparent',
    nodes: [
      { type: MediaNodeType.MEDIA_UPLOAD, label: 'Media Upload', position: { x: 60, y: 120 } },
      { type: MediaNodeType.IMAGE_RESIZE, label: 'Normalize Asset', position: { x: 210, y: 60 } },
      { type: MediaNodeType.IMAGE_RECOGNITION, label: 'Vision Classifier', position: { x: 360, y: 120 } },
      { type: MediaNodeType.MEDIA_DISPLAY, label: 'Preview Result', position: { x: 540, y: 60 } },
      { type: MediaNodeType.MEDIA_DOWNLOAD, label: 'Download', position: { x: 540, y: 210 } },
    ],
    edges: [
      { source: 0, target: 1, label: 'asset' },
      { source: 1, target: 2, label: 'normalized' },
      { source: 2, target: 3, label: 'preview' },
      { source: 2, target: 4, label: 'artifact' },
    ],
  },
  {
    id: 'ops-triage',
    eyebrow: 'Control flow',
    title: 'Ops Triage',
    description: 'Run a diagnostic agent, branch on severity, and loop through remediation candidates.',
    accent: 'from-amber-300/30 via-orange-500/15 to-transparent',
    nodes: [
      { type: NODE_TYPES.CHAT, label: 'Triage Agent', position: { x: 60, y: 110 }, data: { prompt: 'Classify incident severity and propose a safe first mitigation.' } },
      { type: NODE_TYPES.CONDITIONAL, label: 'Severity Branch', position: { x: 210, y: 110 }, data: { type: 'if', expression: 'severity <= medium', branches: { proceed: { targets: [] }, escalate: { targets: [] } } } },
      { type: NODE_TYPES.FOR_EACH, label: 'Mitigation Loop', position: { x: 360, y: 40 }, data: { collection: 'candidates', itemVar: 'candidate' } },
      { type: NODE_TYPES.GATE, label: 'Operator Approval', position: { x: 360, y: 220 } },
      { type: NODE_TYPES.PYTHON_CODE, label: 'Verification Probe', position: { x: 540, y: 130 } },
    ],
    edges: [
      { source: 0, target: 1, label: 'severity' },
      { source: 1, target: 2, label: 'low/medium' },
      { source: 1, target: 3, label: 'high' },
      { source: 2, target: 4, label: 'candidate' },
      { source: 3, target: 4, label: 'approved' },
    ],
  },
];

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
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Top Bar */}
      <TopBar saveState={autoSave} />

      {/* Canonical, layout-aware connection status surface */}
      <ConnectionStatusBanner onRetry={startLiveConnection} className="mx-4 mt-2" />

      {/* Main Content Area - Horizontal PanelGroup */}
      <PanelGroup direction="horizontal" className="flex-1">
        {/* Left Sidebar */}
        <LeftSidebar />

        {/* Center: Canvas + Bottom Dock (nested vertical PanelGroup) */}
        <Panel defaultSize={65} minSize={40} className="mc-main-panel">
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
  const setNodes = useCanvasStore((state) => state.setNodes);
  const setEdges = useCanvasStore((state) => state.setEdges);
  const onNodesChange = useCanvasStore((state) => state.onNodesChange);
  const onEdgesChange = useCanvasStore((state) => state.onEdgesChange);
  const onConnect = useCanvasStore((state) => state.onConnect);
  const setSelectedNodeId = useCanvasStore((state) => state.setSelectedNodeId);
  const reactFlowRef = React.useRef<any>(null);
  const didAutoFitRef = React.useRef(false);

  React.useEffect(() => {
    if (nodes.length === 0) {
      didAutoFitRef.current = false;
      return;
    }
    if (didAutoFitRef.current) return;

    const instance = reactFlowRef.current;
    if (!instance?.fitView) return;

    didAutoFitRef.current = true;
    try {
      instance.fitView({ padding: 0.2, includeHiddenNodes: true });
    } catch {}
  }, [edges.length, nodes.length]);

  const applyWorkflowTemplate = React.useCallback((template: WorkflowTemplate) => {
    const prefix = `${template.id}-${Date.now()}`;
    const nextNodes: Node[] = template.nodes.map((node, index) => ({
      id: `${prefix}-${index}`,
      type: node.type,
      position: node.position,
      selected: index === 0,
      data: {
        label: node.label,
        blueprint: template.title,
        ...(node.data ?? {}),
      },
    }));
    const nextEdges: Edge[] = template.edges.map((edge, index) => ({
      id: `${prefix}-edge-${index}`,
      source: nextNodes[edge.source].id,
      target: nextNodes[edge.target].id,
      label: edge.label,
      animated: true,
    }));

    setNodes(nextNodes);
    setEdges(nextEdges);
    setSelectedNodeId(nextNodes[0]?.id ?? null);
    didAutoFitRef.current = false;
  }, [setEdges, setNodes, setSelectedNodeId]);

  return (
    <div className="flex h-full">
      <NodePalette
        collapsed={!nodePaletteOpen}
        onToggleCollapse={() => setNodePaletteOpen((open) => !open)}
      />

      <div className="mc-canvas-padding min-w-0 flex-1 p-4">
        <ReactFlowProvider>
          <PanelShell
            title={
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-sm font-black text-primary">
                  DAG
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                    Mission Canvas
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setNodePaletteOpen((open) => !open)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <PanelLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Palette
                </button>
                <button
                  onClick={() => setQuickAddMenuOpen(true)}
                  className="mc-primary-action inline-flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add Node
                </button>
              </div>
            }
            className="h-full overflow-hidden"
          >
            <CanvasDropZone className="h-full">
              <div className="relative h-full min-h-[420px] overflow-hidden">
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
                    window.dispatchEvent(new CustomEvent(firstNodeId ? 'graphNodeSelected' : 'graphNodeCleared', {
                      detail: { nodeId: firstNodeId },
                    }));
                  }}
                  onInit={(instance: any) => {
                    reactFlowRef.current = instance;
                  }}
                  proOptions={{ hideAttribution: true }}
                >
                  <BackgroundAny gap={20} color="hsl(var(--border))" />
                  <MiniMapAny className="!bg-card" pannable zoomable />
                  <ControlsAny position="bottom-right" />
                </ReactFlow>

                {nodes.length === 0 && (
                  <EmptyWorkflowCoach
                    templates={WORKFLOW_TEMPLATES}
                    onApplyTemplate={applyWorkflowTemplate}
                    onQuickAdd={() => setQuickAddMenuOpen(true)}
                  />
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

function EmptyWorkflowCoach({
  templates,
  onApplyTemplate,
  onQuickAdd,
}: {
  templates: WorkflowTemplate[];
  onApplyTemplate: (template: WorkflowTemplate) => void;
  onQuickAdd: () => void;
}) {
  return (
    <div className="mc-empty-coach mc-shell absolute left-6 top-6 z-10 w-[min(760px,calc(100%-3rem))] rounded-md bg-background p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            <LayoutTemplate className="h-3 w-3" aria-hidden="true" />
            Starter blueprints
          </div>
          <h2 className="mt-3 text-xl font-black tracking-[-0.03em] text-foreground">
            Start with a runnable mission shape.
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Choose a connected DAG pattern, then tune the selected step in the inspector.
          </p>
        </div>
        <button
          onClick={onQuickAdd}
          className="inline-flex min-w-[126px] items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border/70 bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Build by hand
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => onApplyTemplate(template)}
            className="group relative overflow-hidden rounded-md border border-border/70 bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/20 focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <div className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-br ${template.accent}`} />
            <div className="relative">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {template.eyebrow}
              </div>
              <div className="mt-2 text-sm font-bold text-foreground">{template.title}</div>
              <p className="mt-2 min-h-[56px] text-[11px] leading-5 text-muted-foreground">
                {template.description}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="whitespace-nowrap rounded-full bg-muted px-2 py-1 text-muted-foreground">
                  {template.nodes.length} nodes
                  <span className="mx-1 text-border">/</span>
                  {template.edges.length} edges
                </span>
                <span className="whitespace-nowrap font-semibold text-primary transition group-hover:translate-x-0.5">
                  Use blueprint
                </span>
              </div>
            </div>
          </button>
        ))}
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
      <PanelResizeHandle className="mc-mobile-hide mc-resize-handle w-1 cursor-col-resize" />
      <Panel defaultSize={20} minSize={15} maxSize={30} className="mc-mobile-hide mc-shell flex flex-col rounded-none border-y-0 border-r-0">
        <div className="mc-shell-header flex h-10 items-center px-4 text-xs font-medium">
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
