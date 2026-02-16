import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BottomDock } from '../BottomDock';
import { StreamConnectionState } from '@/types/streaming';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockLayoutStore = vi.hoisted(() => ({
  bottomDockCollapsed: false,
  toggleBottomDock: vi.fn(),
  bottomDockHeight: 250,
  setBottomDockHeight: vi.fn(),
  activeBottomTab: 'Console',
  setActiveBottomTab: vi.fn(),
}));

const mockWorkspace = vi.hoisted(() => ({
  activeRunId: null as string | null,
  isEnabled: vi.fn((_flag: string) => true),
  startDemoRun: vi.fn(),
  startLiveConnection: vi.fn(),
  startOrchestratorRun: vi.fn(),
}));

// Use string literal in hoisted block since enum imports aren't available yet
const mockStreamingStore = vi.hoisted(() => ({
  connectionStatus: 'disconnected' as string,
}));

vi.mock('@/stores', () => ({
  useLayoutStore: () => mockLayoutStore,
  useStreamingStore: (selector: (s: typeof mockStreamingStore) => unknown) =>
    selector(mockStreamingStore),
}));

vi.mock('../WorkspaceProvider', () => ({
  useWorkspace: () => mockWorkspace,
}));

// Mock react-resizable-panels
vi.mock('react-resizable-panels', () => ({
  Panel: ({
    children,
    className,
  }: {
    children?: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="panel" className={className}>
      {children}
    </div>
  ),
  PanelResizeHandle: ({ className }: { className?: string }) => (
    <div data-testid="panel-resize-handle" className={className} />
  ),
}));

// Mock child panels to avoid rendering their implementations
vi.mock('../../panels/ConsolePanel', () => ({
  default: ({ runId }: { runId?: string | null }) => (
    <div data-testid="console-panel">Console: {runId ?? 'none'}</div>
  ),
}));

vi.mock('../../panels/TimelinePanel', () => ({
  default: () => <div data-testid="timeline-panel">Timeline</div>,
}));

vi.mock('../../panels/IssuesPanel', () => ({
  default: ({ onCountChange }: { onCountChange?: (count: number) => void }) => (
    <div data-testid="issues-panel">Issues</div>
  ),
}));

vi.mock('../../panels/RunsPanel', () => ({
  default: () => <div data-testid="runs-panel">Runs</div>,
}));

vi.mock('../../panels/NetworkPanel', () => ({
  default: () => <div data-testid="network-panel">Network</div>,
}));

vi.mock('../../panels/GraphPanel', () => ({
  default: () => <div data-testid="graph-panel">Graph</div>,
}));

vi.mock('../../panels/AgentBrowser', () => ({
  default: () => <div data-testid="agent-browser">Agents</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...rest
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/PanelErrorBoundary', () => ({
  PanelErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('BottomDock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLayoutStore.bottomDockCollapsed = false;
    mockLayoutStore.activeBottomTab = 'Console';
    mockWorkspace.activeRunId = null;
    mockWorkspace.isEnabled.mockImplementation(() => true);
    mockStreamingStore.connectionStatus = StreamConnectionState.DISCONNECTED;
  });

  it('renders tab bar when expanded', () => {
    render(<BottomDock />);
    expect(screen.getByText('Console')).toBeInTheDocument();
    expect(screen.getByText('Issues')).toBeInTheDocument();
  });

  it('renders all visible tabs when all feature flags are enabled', () => {
    render(<BottomDock />);
    expect(screen.getByText('Console')).toBeInTheDocument();
    expect(screen.getByText('Run Queue')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText('Issues')).toBeInTheDocument();
    expect(screen.getByText('Graph')).toBeInTheDocument();
    // Agents tab label is in both tab button and content, find in buttons
    const agentsButtons = screen.getAllByText('Agents');
    expect(agentsButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('hides tabs when their feature flags are disabled', () => {
    mockWorkspace.isEnabled.mockImplementation((flag: string) => {
      if (flag === 'MISSION_CONSOLE') return false;
      if (flag === 'NETWORK_PANEL') return false;
      return true;
    });
    render(<BottomDock />);
    // Console and Network tabs should be hidden
    const consoleButtons = screen.queryAllByText('Console');
    // Console may appear in panel content but not as a tab
    expect(consoleButtons.length).toBe(0);
    expect(screen.queryByText('Network')).not.toBeInTheDocument();
  });

  it('switches active tab when a tab is clicked', () => {
    render(<BottomDock />);
    fireEvent.click(screen.getByText('Issues'));
    expect(mockLayoutStore.setActiveBottomTab).toHaveBeenCalledWith('Issues');
  });

  it('renders the Console panel when Console tab is active', () => {
    mockLayoutStore.activeBottomTab = 'Console';
    render(<BottomDock />);
    expect(screen.getByTestId('console-panel')).toBeInTheDocument();
  });

  it('renders collapsed state with Show Panel button', () => {
    mockLayoutStore.bottomDockCollapsed = true;
    render(<BottomDock />);
    expect(screen.getByText('Show Panel')).toBeInTheDocument();
    expect(screen.queryByText('Console')).not.toBeInTheDocument();
  });

  it('calls toggleBottomDock when Show Panel button is clicked', () => {
    mockLayoutStore.bottomDockCollapsed = true;
    render(<BottomDock />);
    fireEvent.click(screen.getByText('Show Panel'));
    expect(mockLayoutStore.toggleBottomDock).toHaveBeenCalledTimes(1);
  });

  it('renders Demo Run action button when NEW_STREAMING is enabled', () => {
    render(<BottomDock />);
    expect(screen.getByText('Demo Run')).toBeInTheDocument();
  });

  it('calls startDemoRun when Demo Run button is clicked', () => {
    render(<BottomDock />);
    fireEvent.click(screen.getByText('Demo Run'));
    expect(mockWorkspace.startDemoRun).toHaveBeenCalledTimes(1);
  });

  it('renders Run action button when ORCHESTRATOR_PANEL is enabled', () => {
    render(<BottomDock />);
    // There is a Run button in the action area and Runs as a tab label
    const runButton = screen.getByText('Run');
    expect(runButton).toBeInTheDocument();
  });

  it('calls startOrchestratorRun when Run action button is clicked', () => {
    render(<BottomDock />);
    // The action "Run" button - it is distinct from the "Runs" tab
    const runButton = screen.getByText('Run');
    fireEvent.click(runButton);
    expect(mockWorkspace.startOrchestratorRun).toHaveBeenCalledTimes(1);
  });

  it('renders Connect button when CONNECT_WS is enabled and disconnected', () => {
    render(<BottomDock />);
    expect(screen.getByText('Connect')).toBeInTheDocument();
  });

  it('disables Connect button when connection is connecting', () => {
    mockStreamingStore.connectionStatus = StreamConnectionState.CONNECTING;
    render(<BottomDock />);
    const connectBtn = screen.getByText('Connecting...');
    expect(connectBtn.closest('button')).toBeDisabled();
  });

  it('shows Live label when connected', () => {
    mockStreamingStore.connectionStatus = StreamConnectionState.CONNECTED;
    render(<BottomDock />);
    // The button with "Live" text for the connected state
    expect(screen.getAllByText('Live').length).toBeGreaterThanOrEqual(1);
  });

  it('renders Run Queue placeholder content', () => {
    mockLayoutStore.activeBottomTab = 'Run Queue';
    render(<BottomDock />);
    expect(screen.getByText('Run Queue - Coming soon')).toBeInTheDocument();
  });

  it('renders PanelResizeHandle', () => {
    render(<BottomDock />);
    expect(screen.getByTestId('panel-resize-handle')).toBeInTheDocument();
  });
});
