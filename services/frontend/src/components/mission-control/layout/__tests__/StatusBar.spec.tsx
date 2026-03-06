/**
 * Tests for MissionControlLayout rendering
 *
 * Validates the layout renders without crashing with all providers mocked.
 * Tests the compound component structure (TopBar, LeftSidebar, BottomDock).
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, test, expect, afterEach, vi } from 'vitest';

const mockLayoutState = {
  darkMode: false,
  toggleDarkMode: vi.fn(),
  mainView: 'canvas' as 'canvas' | 'network' | 'flow' | 'code',
  setMainView: vi.fn(),
  leftSidebarOpen: true,
  setLeftSidebarOpen: vi.fn(),
  bottomDockTab: 'console' as const,
  setBottomDockTab: vi.fn(),
};

const mockCanvasState = {
  nodes: [] as any[],
  edges: [] as any[],
  copySelected: vi.fn().mockReturnValue(0),
  pasteClipboard: vi.fn().mockReturnValue(0),
  duplicateSelected: vi.fn().mockReturnValue(0),
  deleteSelected: vi.fn().mockReturnValue(0),
  selectAll: vi.fn(),
  deselectAll: vi.fn(),
  nudgeSelected: vi.fn(),
  contextMenu: { isOpen: false },
  closeContextMenu: vi.fn(),
  onNodesChange: vi.fn(),
  onEdgesChange: vi.fn(),
  onConnect: vi.fn(),
  setSelectedNodeId: vi.fn(),
};

// Mock feature flags (must be before any transitive imports that use them)
vi.mock('@/config/features', () => ({
  FeatureFlags: {
    MULTIMODAL_UPLOAD: false,
    NEW_STREAMING: false,
    S3_STORAGE: false,
    CONNECT_WS: false,
    CONTRACT_OVERLAY: false,
    AUTO_CONNECT: false,
    ORCHESTRATOR_PANEL: false,
    NETWORK_PANEL: false,
    ALLOW_REMOTE_COGPAK_UI: false,
    MISSION_GRAPH: true,
    MISSION_CONSOLE: true,
    DEMO_MODE: false,
  },
  isStreamWorkerEnabled: () => false,
  isCloudEventsEnabled: () => false,
  isSimFallbackEnabled: () => false,
  isAutoRecordEnabled: () => false,
  isFastStoreEnabled: () => false,
  isConsoleVirtualizationEnabled: () => false,
}));

// Mock ToastContext
vi.mock('@/contexts/ToastContext', () => ({
  ToastProvider: ({ children }: any) => <div>{children}</div>,
  useToast: () => ({
    addToast: vi.fn(),
    removeToast: vi.fn(),
    clearAll: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
  useToasts: () => [],
}));

// Mock stores
vi.mock('@/stores', () => ({
  useLayoutStore: Object.assign(
    (selector?: any) => {
      return selector ? selector(mockLayoutState) : mockLayoutState;
    },
    { getState: () => mockLayoutState }
  ),
  useFlowStore: (selector?: any) => {
    const state = { undo: vi.fn(), redo: vi.fn(), canUndo: () => false, canRedo: () => false };
    return selector ? selector(state) : state;
  },
  useCanvasStore: (selector?: any) => {
    return selector ? selector(mockCanvasState) : mockCanvasState;
  },
  useStreamingStore: (selector?: any) => {
    const state = { connectionStatus: 'disconnected', activeStreams: new Set() };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/canvas', () => ({
  useCanvasStore: Object.assign(
    (selector?: any) => {
      return selector ? selector(mockCanvasState) : mockCanvasState;
    },
    { getState: () => mockCanvasState }
  ),
}));

// Mock services
vi.mock('@/services/mission-control/services', () => ({
  flightRecorder: {
    listRuns: () => [],
    listCheckpoints: () => [],
    subscribe: () => () => {},
    startRun: () => {},
    addCheckpoint: () => {},
    endRun: () => {},
    clear: () => {},
  },
  linter: { analyze: () => [], canAutoApply: () => false, applyQuickFix: vi.fn() },
}));

vi.mock('@/services/api/orchestratorService', () => ({
  orchestratorService: {
    createRun: vi.fn(),
    getRun: vi.fn(),
    listCheckpoints: vi.fn(),
    streamRunEvents: vi.fn(() => ({ close: vi.fn() })),
    startDemoRunAndStream: vi.fn(),
  },
}));

vi.mock('@/services/api/streamingService', () => ({
  default: { getStats: vi.fn(), connect: vi.fn() },
  streamingService: { getStats: vi.fn(), connect: vi.fn() },
  StreamingService: vi.fn(),
}));

vi.mock('@/services/streamingService.enhanced', () => ({
  EnhancedStream: vi.fn(),
}));

// Mock react libraries
vi.mock('reactflow', () => ({
  ReactFlowProvider: ({ children }: any) => <div>{children}</div>,
  ReactFlow: ({ children }: any) => <div data-testid="mock-reactflow">{children}</div>,
  Background: () => <div data-testid="mock-reactflow-background" />,
  Controls: () => <div data-testid="mock-reactflow-controls" />,
  MiniMap: () => <div data-testid="mock-reactflow-minimap" />,
}));

vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: any) => <div>{children}</div>,
  Panel: ({ children }: any) => <div>{children}</div>,
  PanelResizeHandle: () => <div />,
}));

// Mock heavy UI components
vi.mock('@/components/StreamingCanvas', () => ({ StreamingCanvas: () => <div data-testid="mock-canvas" /> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@/components/ui/PanelErrorBoundary', () => ({ PanelErrorBoundary: ({ children }: any) => <div>{children}</div> }));
vi.mock('@/components/ui/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('@/components/ui/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/ui/ConnectionStatusBanner', () => ({ ConnectionStatusBanner: () => null }));
vi.mock('@/components/ui/SaveStatusIndicator', () => ({ SaveStatusIndicator: () => null }));

// Mock sub-panels and overlays
vi.mock('../../panels/TimelinePanel', () => ({ default: () => <div />, TimelinePanel: () => <div /> }));
vi.mock('../../panels/IssuesPanel', () => ({ default: () => <div /> }));
vi.mock('../../panels/ConsolePanel', () => ({ default: () => <div /> }));
vi.mock('../../panels/InspectorPanel', () => ({ default: () => <div data-testid="mock-inspector" /> }));
vi.mock('../../panels/NetworkPanel', () => ({ default: () => <div /> }));
vi.mock('../../panels/RunsPanel', () => ({ default: () => <div /> }));
vi.mock('../../panels/GraphPanel', () => ({ default: () => <div /> }));
vi.mock('../../panels/AgentBrowser', () => ({ default: () => <div /> }));
vi.mock('../../overlays/LineageOverlay', () => ({ default: () => null }));
vi.mock('../../overlays/PolicyOverlay', () => ({ default: () => null }));
vi.mock('../../menus/NodeContextMenu', () => ({ NodeContextMenu: () => null }));
vi.mock('../../canvas', () => ({
  CanvasDropZone: ({ children }: any) => <div data-testid="mock-canvas-dropzone">{children}</div>,
  NodePalette: () => null,
  QuickAddMenu: () => null,
}));

// Mock hooks
vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
  commonShortcuts: {
    commandPalette: (fn: any) => ({ key: 'k', ctrlKey: true, action: fn }),
    undo: (fn: any) => ({ key: 'z', ctrlKey: true, action: fn }),
    redo: (fn: any) => ({ key: 'z', ctrlKey: true, shiftKey: true, action: fn }),
    escape: (fn: any) => ({ key: 'Escape', action: fn }),
    copy: (fn: any) => ({ key: 'c', ctrlKey: true, action: fn }),
    paste: (fn: any) => ({ key: 'v', ctrlKey: true, action: fn }),
    duplicate: (fn: any) => ({ key: 'd', ctrlKey: true, action: fn }),
    selectAll: (fn: any) => ({ key: 'a', ctrlKey: true, action: fn }),
    delete: (fn: any) => ({ key: 'Delete', action: fn }),
  },
}));

vi.mock('@/hooks/useAutoSave', () => ({
  useAutoSave: () => ({ saveNow: vi.fn() }),
}));

vi.mock('@/hooks/useFlowLoader', () => ({
  useFlowLoader: () => ({ loadFlow: vi.fn(), loading: false }),
}));

// Mock WorkspaceProvider
vi.mock('../WorkspaceProvider', () => ({
  WorkspaceProvider: ({ children }: any) => <div data-testid="workspace-provider">{children}</div>,
  useWorkspace: () => ({
    activeRunId: null,
    setActiveRunId: vi.fn(),
    startDemoRun: vi.fn(),
    startOrchestratorRun: vi.fn().mockResolvedValue(undefined),
    startLiveConnection: vi.fn().mockResolvedValue(undefined),
    cogpakUi: null,
    setCogpakUi: vi.fn(),
    isEnabled: () => false,
    setFeatureOverride: vi.fn(),
    uiConfig: {},
    settingsOpen: false,
    setSettingsOpen: vi.fn(),
    shortcutsDialogOpen: false,
    setShortcutsDialogOpen: vi.fn(),
    commandPaletteOpen: false,
    setCommandPaletteOpen: vi.fn(),
    lineageOverlayOpen: false,
    setLineageOverlayOpen: vi.fn(),
    policyOverlayOpen: false,
    setPolicyOverlayOpen: vi.fn(),
    setMainView: vi.fn(),
    mainView: 'canvas',
  }),
}));

// Mock compound layout components
vi.mock('../TopBar', () => ({
  TopBar: () => <div data-testid="mock-topbar">TopBar</div>,
}));

vi.mock('../LeftSidebar', () => ({
  LeftSidebar: () => <div data-testid="mock-left-sidebar">LeftSidebar</div>,
}));

vi.mock('../BottomDock', () => ({
  BottomDock: () => <div data-testid="mock-bottom-dock">BottomDock</div>,
}));

// Now import the layout component (mocks are in place)
import { MissionControlLayout } from '../MissionControlLayout';

afterEach(() => {
  cleanup();
});

describe('MissionControlLayout rendering', () => {
  afterEach(() => {
    mockLayoutState.mainView = 'canvas';
    mockCanvasState.nodes = [];
    mockCanvasState.edges = [];
  });

  test('renders the layout with compound components', () => {
    render(<MissionControlLayout />);

    // WorkspaceProvider wrapper
    expect(screen.getByTestId('workspace-provider')).toBeTruthy();

    // Compound components
    expect(screen.getByTestId('mock-topbar')).toBeTruthy();
    expect(screen.getByTestId('mock-left-sidebar')).toBeTruthy();
    expect(screen.getByTestId('mock-bottom-dock')).toBeTruthy();
  });

  test('renders the workflow canvas in canvas mode', () => {
    render(<MissionControlLayout />);
    expect(screen.getByTestId('mock-reactflow')).toBeTruthy();
  });

  test('renders Inspector panel section', () => {
    render(<MissionControlLayout />);
    expect(screen.getByText('Inspector')).toBeTruthy();
  });

  test('renders the streaming view in flow mode', () => {
    mockLayoutState.mainView = 'flow';
    render(<MissionControlLayout />);
    expect(screen.getByTestId('mock-canvas')).toBeTruthy();
  });

  test('renders workflow source in code mode', () => {
    mockLayoutState.mainView = 'code';
    mockCanvasState.nodes = [
      { id: 'node-1', type: 'chat', position: { x: 10, y: 20 }, data: { label: 'Chat' } },
    ];
    render(<MissionControlLayout />);
    expect(screen.getByText('Workflow Source')).toBeTruthy();
    expect(screen.getByText(/"node-1"/)).toBeTruthy();
  });
});
