import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MissionControlLayout } from '../MissionControlLayout';

const startLiveConnection = vi.fn().mockResolvedValue(undefined);
const bannerRender = vi.fn(
  ({ onRetry }: { onRetry?: () => Promise<void> | void }) => (
    <button data-testid="connection-status-banner" onClick={() => void onRetry?.()}>
      Retry
    </button>
  )
);

vi.mock('@/stores', () => ({
  useLayoutStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      darkMode: false,
      toggleDarkMode: vi.fn(),
      mainView: 'canvas',
      setMainView: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useFlowStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { undo: vi.fn(), redo: vi.fn(), canUndo: () => false, canRedo: () => false };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useCanvasStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      copySelected: vi.fn(),
      pasteClipboard: vi.fn(),
      duplicateSelected: vi.fn(),
      deleteSelected: vi.fn(),
      selectAll: vi.fn(),
      deselectAll: vi.fn(),
      nudgeSelected: vi.fn(),
      contextMenu: null,
      closeContextMenu: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
  useStreamingStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { connectionStatus: 'error' };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

vi.mock('../WorkspaceProvider', () => ({
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useWorkspace: () => ({
    activeRunId: null,
    cogpakUi: null,
    setCogpakUi: vi.fn(),
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
    startDemoRun: vi.fn(),
    startLiveConnection,
    stopLiveConnection: vi.fn(),
    startOrchestratorRun: vi.fn().mockResolvedValue(undefined),
    setMainView: vi.fn(),
    isEnabled: () => true,
    setFeatureOverride: vi.fn(),
    uiConfig: {},
    setActiveRunId: vi.fn(),
  }),
}));

vi.mock('../LeftSidebar', () => ({ LeftSidebar: () => <div data-testid="left-sidebar" /> }));
vi.mock('../BottomDock', () => ({ BottomDock: () => <div data-testid="bottom-dock" /> }));
vi.mock('../TopBar', () => ({ TopBar: () => <div data-testid="topbar" /> }));
vi.mock('@/components/StreamingCanvas', () => ({ StreamingCanvas: () => <div data-testid="canvas" /> }));
vi.mock('@/components/mission-control/panels/InspectorPanel', () => ({ default: () => <div data-testid="inspector" /> }));
vi.mock('@/components/mission-control/panels/NetworkPanel', () => ({ default: () => <div data-testid="network" /> }));
vi.mock('@/components/mission-control/overlays/LineageOverlay', () => ({ default: () => null }));
vi.mock('@/components/mission-control/overlays/PolicyOverlay', () => ({ default: () => null }));
vi.mock('@/components/mission-control/canvas', () => ({
  NodePalette: () => <div data-testid="node-palette" />,
  QuickAddMenu: () => null,
}));
vi.mock('@/components/mission-control/menus/NodeContextMenu', () => ({ NodeContextMenu: () => null }));
vi.mock('@/components/ui/PanelErrorBoundary', () => ({
  PanelErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('@/components/ui/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/ui/ConnectionStatusBanner', () => ({
  ConnectionStatusBanner: (props: { onRetry?: () => Promise<void> | void }) => bannerRender(props),
}));
vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
  commonShortcuts: {
    commandPalette: (fn: () => void) => ({ key: 'k', action: fn }),
    undo: (fn: () => void) => ({ key: 'z', action: fn }),
    redo: (fn: () => void) => ({ key: 'z', shiftKey: true, action: fn }),
    escape: (fn: () => void) => ({ key: 'Escape', action: fn }),
    copy: (fn: () => void) => ({ key: 'c', action: fn }),
    paste: (fn: () => void) => ({ key: 'v', action: fn }),
    duplicate: (fn: () => void) => ({ key: 'd', action: fn }),
    selectAll: (fn: () => void) => ({ key: 'a', action: fn }),
    delete: (fn: () => void) => ({ key: 'Delete', action: fn }),
  },
}));
vi.mock('@/hooks/useAutoSave', () => ({ useAutoSave: () => ({ saveNow: vi.fn() }) }));
vi.mock('react-resizable-panels', () => ({
  PanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: () => <div />,
}));
vi.mock('reactflow', () => ({ ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

describe('MissionControl connection status surface', () => {
  beforeEach(() => {
    startLiveConnection.mockClear();
    bannerRender.mockClear();
  });

  it('renders exactly one connection status banner', () => {
    render(<MissionControlLayout />);
    expect(screen.getAllByTestId('connection-status-banner')).toHaveLength(1);
    expect(bannerRender).toHaveBeenCalledTimes(1);
  });

  it('routes retry action to workspace startLiveConnection', () => {
    render(<MissionControlLayout />);
    fireEvent.click(screen.getByTestId('connection-status-banner'));
    expect(startLiveConnection).toHaveBeenCalledTimes(1);
  });
});
