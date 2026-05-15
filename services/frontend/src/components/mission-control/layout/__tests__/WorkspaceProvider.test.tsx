import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkspaceProvider, useWorkspace } from '../WorkspaceProvider';
import { useCanvasStore } from '@/stores/canvas';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockFlightRecorder = vi.hoisted(() => ({
  startRun: vi.fn(),
  addCheckpoint: vi.fn(),
  endRun: vi.fn(),
  listRuns: vi.fn().mockReturnValue([]),
}));

const mockOrchestratorService = vi.hoisted(() => ({
  createRun: vi.fn().mockResolvedValue({ runId: 'run-abc-123' }),
}));

const mockSetMainView = vi.hoisted(() => vi.fn());
const mockCreateSession = vi.hoisted(() => vi.fn());
const mockCloseSession = vi.hoisted(() => vi.fn());
const mockAddSessionMessage = vi.hoisted(() => vi.fn());
const mockSetConnectionStatus = vi.hoisted(() => vi.fn());
const mockConnectLiveTransport = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDisconnectLiveTransport = vi.hoisted(() => vi.fn());
const mockFeatureFlags = vi.hoisted(() => ({
  NEW_STREAMING: true,
  CONNECT_WS: true,
  MISSION_CONSOLE: true,
  MISSION_GRAPH: true,
  NETWORK_PANEL: true,
  ORCHESTRATOR_PANEL: true,
  ALLOW_REMOTE_COGPAK_UI: true,
  DEMO_MODE: true,
  MULTIMODAL_UPLOAD: false,
  S3_STORAGE: false,
  AUTO_CONNECT: false,
  CONTRACT_OVERLAY: false,
}));

vi.mock('@/config/features', () => ({
  FeatureFlags: mockFeatureFlags,
}));

vi.mock('@/stores', () => ({
  useLayoutStore: () => ({
    setMainView: mockSetMainView,
  }),
  useStreamingStore: (selector?: (s: any) => any) => {
    const state = {
      connectionStatus: 'disconnected',
      activeSessionId: null,
      createSession: mockCreateSession,
      closeSession: mockCloseSession,
      addSessionMessage: mockAddSessionMessage,
      setConnectionStatus: mockSetConnectionStatus,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/canvas', () => ({
  useCanvasStore: {
    getState: vi.fn().mockReturnValue({
      nodes: [],
      edges: [],
    }),
  },
}));

vi.mock('@/services/mission-control/services', () => ({
  flightRecorder: mockFlightRecorder,
}));

vi.mock('@/services/api/orchestratorService', () => ({
  orchestratorService: mockOrchestratorService,
}));

vi.mock('@/hooks/useFlowLoader', () => ({
  useFlowLoader: vi.fn(),
}));

vi.mock('@/hooks/useStreamingTransport', () => ({
  useStreamingTransport: () => ({
    connect: mockConnectLiveTransport,
    disconnect: mockDisconnectLiveTransport,
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Test consumer component
// ─────────────────────────────────────────────────────────────────────────────

function TestConsumer() {
  const ws = useWorkspace();
  return (
    <div>
      <span data-testid="run-id">{ws.activeRunId ?? 'none'}</span>
      <span data-testid="settings-open">{String(ws.settingsOpen)}</span>
      <span data-testid="shortcuts-open">{String(ws.shortcutsDialogOpen)}</span>
      <span data-testid="palette-open">{String(ws.commandPaletteOpen)}</span>
      <span data-testid="lineage-open">{String(ws.lineageOverlayOpen)}</span>
      <span data-testid="policy-open">{String(ws.policyOverlayOpen)}</span>
      <span data-testid="cogpak-ui">{ws.cogpakUi?.title ?? 'none'}</span>
      <span data-testid="connect-ws">{String(ws.isEnabled('CONNECT_WS'))}</span>
      <span data-testid="s3-storage">{String(ws.isEnabled('S3_STORAGE'))}</span>
      <button data-testid="toggle-settings" onClick={() => ws.setSettingsOpen(!ws.settingsOpen)}>
        ToggleSettings
      </button>
      <button data-testid="toggle-shortcuts" onClick={() => ws.setShortcutsDialogOpen(!ws.shortcutsDialogOpen)}>
        ToggleShortcuts
      </button>
      <button data-testid="toggle-palette" onClick={() => ws.setCommandPaletteOpen(!ws.commandPaletteOpen)}>
        TogglePalette
      </button>
      <button data-testid="toggle-lineage" onClick={() => ws.setLineageOverlayOpen(!ws.lineageOverlayOpen)}>
        ToggleLineage
      </button>
      <button data-testid="toggle-policy" onClick={() => ws.setPolicyOverlayOpen(!ws.policyOverlayOpen)}>
        TogglePolicy
      </button>
      <button data-testid="start-demo" onClick={ws.startDemoRun}>
        StartDemo
      </button>
      <button data-testid="start-run" onClick={ws.startOrchestratorRun}>
        StartRun
      </button>
      <button data-testid="set-main-view" onClick={() => ws.setMainView('network')}>
        SetView
      </button>
      <button data-testid="override-feature" onClick={() => ws.setFeatureOverride('S3_STORAGE', true)}>
        EnableS3
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('WorkspaceProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockConnectLiveTransport.mockResolvedValue(undefined);
    Object.assign(mockFeatureFlags, {
      CONNECT_WS: true,
      AUTO_CONNECT: false,
      S3_STORAGE: false,
    });
    vi.mocked(useCanvasStore.getState).mockReturnValue({
      nodes: [],
      edges: [],
    } as any);
  });

  it('renders children', () => {
    render(
      <WorkspaceProvider>
        <div data-testid="child">Child content</div>
      </WorkspaceProvider>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('throws when useWorkspace is used outside provider', () => {
    // Temporarily silence console.error for expected React error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow('useWorkspace must be used within a WorkspaceProvider');
    spy.mockRestore();
  });

  it('provides default state values', () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    expect(screen.getByTestId('run-id').textContent).toBe('none');
    expect(screen.getByTestId('settings-open').textContent).toBe('false');
    expect(screen.getByTestId('shortcuts-open').textContent).toBe('false');
    expect(screen.getByTestId('palette-open').textContent).toBe('false');
    expect(screen.getByTestId('lineage-open').textContent).toBe('false');
    expect(screen.getByTestId('policy-open').textContent).toBe('false');
    expect(screen.getByTestId('cogpak-ui').textContent).toBe('none');
  });

  it('toggles settings overlay', () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    expect(screen.getByTestId('settings-open').textContent).toBe('false');
    fireEvent.click(screen.getByTestId('toggle-settings'));
    expect(screen.getByTestId('settings-open').textContent).toBe('true');
    fireEvent.click(screen.getByTestId('toggle-settings'));
    expect(screen.getByTestId('settings-open').textContent).toBe('false');
  });

  it('toggles shortcuts dialog', () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    fireEvent.click(screen.getByTestId('toggle-shortcuts'));
    expect(screen.getByTestId('shortcuts-open').textContent).toBe('true');
  });

  it('toggles command palette', () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    fireEvent.click(screen.getByTestId('toggle-palette'));
    expect(screen.getByTestId('palette-open').textContent).toBe('true');
  });

  it('toggles lineage overlay', () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    fireEvent.click(screen.getByTestId('toggle-lineage'));
    expect(screen.getByTestId('lineage-open').textContent).toBe('true');
  });

  it('toggles policy overlay', () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    fireEvent.click(screen.getByTestId('toggle-policy'));
    expect(screen.getByTestId('policy-open').textContent).toBe('true');
  });

  it('starts a demo run and sets active run ID', () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    expect(screen.getByTestId('run-id').textContent).toBe('none');
    fireEvent.click(screen.getByTestId('start-demo'));
    expect(mockFlightRecorder.startRun).toHaveBeenCalledTimes(1);
    expect(mockFlightRecorder.addCheckpoint).toHaveBeenCalledTimes(3);
    expect(mockFlightRecorder.endRun).toHaveBeenCalledTimes(1);
    // Active run ID should be set to a demo-* prefix
    expect(screen.getByTestId('run-id').textContent).toMatch(/^demo-/);
  });

  it('starts orchestrator run and sets active run ID', async () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-run'));
    });
    expect(mockOrchestratorService.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ auto_start: true })
    );
    expect(screen.getByTestId('run-id').textContent).toBe('run-abc-123');
  });

  it('serializes MCP node metadata into INPUT_SPEC for direct runs', async () => {
    vi.mocked(useCanvasStore.getState).mockReturnValue({
      nodes: [
        {
          id: 'node-mcp-1',
          type: 'agent',
          data: {
            label: 'List Pods',
            agent_id: 'loom-mcp-executor',
            tool_name: 'k8s_apps_k3s__k8s_get',
            mcp_server: 'k8s_apps_k3s',
            tool_args: { namespace: 'default', kind: 'pods' },
            runtime_contract: { kind: 'mcp_tool', required_env: ['KUBECONFIG'] },
            env: { STATIC_FLAG: 'true' },
          },
        },
      ],
      edges: [],
    } as any);

    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('start-run'));
    });

    expect(mockOrchestratorService.createRun).toHaveBeenCalledTimes(1);

    const createRunPayload = mockOrchestratorService.createRun.mock.calls[0][0];
    const runNode = createRunPayload.plan.nodes[0];
    expect(runNode.agent_id).toBe('loom-mcp-executor');
    expect(runNode.mcp).toEqual({
      tool_name: 'k8s_apps_k3s__k8s_get',
      server: 'k8s_apps_k3s',
      tool_args: { namespace: 'default', kind: 'pods' },
    });
    expect(runNode.env).toBeDefined();
    expect(runNode.env?.STATIC_FLAG).toBe('true');

    const inputSpec = JSON.parse(runNode.env?.INPUT_SPEC ?? '{}');
    expect(inputSpec.tool_name).toBe('k8s_apps_k3s__k8s_get');
    expect(inputSpec.mcp_server).toBe('k8s_apps_k3s');
    expect(inputSpec.tool_args).toEqual({ namespace: 'default', kind: 'pods' });
    expect(inputSpec.runtime_contract).toEqual({ kind: 'mcp_tool', required_env: ['KUBECONFIG'] });
  });

  it('delegates setMainView to layout store', () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    fireEvent.click(screen.getByTestId('set-main-view'));
    expect(mockSetMainView).toHaveBeenCalledWith('network');
  });

  it('reads feature flags from FeatureFlags defaults', () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    expect(screen.getByTestId('connect-ws').textContent).toBe('true');
    expect(screen.getByTestId('s3-storage').textContent).toBe('false');
  });

  it('auto-connects to the default stream on mount when enabled', async () => {
    mockFeatureFlags.AUTO_CONNECT = true;
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );

    await act(async () => {});
    expect(mockConnectLiveTransport).toHaveBeenCalledWith('default-stream-id');
  });

  it('does not auto-connect when CONNECT_WS is disabled', async () => {
    mockFeatureFlags.AUTO_CONNECT = true;
    mockFeatureFlags.CONNECT_WS = false;
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );

    await act(async () => {});
    expect(mockConnectLiveTransport).not.toHaveBeenCalled();
  });

  it('applies feature flag overrides', () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    expect(screen.getByTestId('s3-storage').textContent).toBe('false');
    fireEvent.click(screen.getByTestId('override-feature'));
    expect(screen.getByTestId('s3-storage').textContent).toBe('true');
  });

  it('persists feature flag overrides to localStorage', () => {
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    fireEvent.click(screen.getByTestId('override-feature'));
    const stored = JSON.parse(localStorage.getItem('mc_ui_config') || '{}');
    expect(stored.S3_STORAGE).toBe(true);
  });

  it('handles orchestrator run failure gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockOrchestratorService.createRun.mockRejectedValueOnce(new Error('Network error'));
    render(
      <WorkspaceProvider>
        <TestConsumer />
      </WorkspaceProvider>
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('start-run'));
    });
    // Should not crash, run ID remains unchanged
    expect(screen.getByTestId('run-id').textContent).toBe('none');
    consoleSpy.mockRestore();
  });
});
