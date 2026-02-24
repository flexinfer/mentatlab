import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TopBar } from '../TopBar';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockLayoutStore = vi.hoisted(() => ({
  mainView: 'canvas' as string,
  setMainView: vi.fn(),
  darkMode: false,
  toggleDarkMode: vi.fn(),
}));

const mockWorkspace = vi.hoisted(() => ({
  isEnabled: vi.fn((_flag: string) => true),
  setSettingsOpen: vi.fn(),
  setShortcutsDialogOpen: vi.fn(),
  setCommandPaletteOpen: vi.fn(),
  startDemoRun: vi.fn(),
  startLiveConnection: vi.fn(),
  stopLiveConnection: vi.fn(),
  startOrchestratorRun: vi.fn(),
}));

const mockConnection = vi.hoisted(() => ({
  status: 'disconnected' as string,
  transport: 'none' as string,
}));

vi.mock('@/stores', () => ({
  useLayoutStore: () => mockLayoutStore,
  useStreamingStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { connectionStatus: mockConnection.status, transportType: mockConnection.transport };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('../WorkspaceProvider', () => ({
  useWorkspace: () => mockWorkspace,
}));

vi.mock('@/components/ui/SaveStatusIndicator', () => ({
  SaveStatusIndicator: () => <div data-testid="save-status">SaveStatus</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    title,
    ...rest
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    title?: string;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} title={title} {...rest}>
      {children}
    </button>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('TopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLayoutStore.mainView = 'canvas';
    mockLayoutStore.darkMode = false;
    mockConnection.status = 'disconnected';
    mockConnection.transport = 'none';
    mockWorkspace.isEnabled.mockImplementation(() => true);
  });

  it('renders the MentatLab branding', () => {
    render(<TopBar />);
    expect(screen.getByText('MentatLab')).toBeInTheDocument();
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('renders all four view mode buttons', () => {
    render(<TopBar />);
    expect(screen.getByText('Canvas')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getByText('Flow')).toBeInTheDocument();
    expect(screen.getByText('Code')).toBeInTheDocument();
  });

  it('highlights the active view mode', () => {
    mockLayoutStore.mainView = 'network';
    render(<TopBar />);

    const networkBtn = screen.getByText('Network');
    expect(networkBtn.className).toContain('bg-primary');

    const canvasBtn = screen.getByText('Canvas');
    expect(canvasBtn.className).not.toContain('bg-primary text-primary-foreground');
  });

  it('calls setMainView when a view mode button is clicked', () => {
    render(<TopBar />);
    fireEvent.click(screen.getByText('Flow'));
    expect(mockLayoutStore.setMainView).toHaveBeenCalledWith('flow');
  });

  it('renders the Demo button', () => {
    render(<TopBar />);
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });

  it('calls startDemoRun when Demo button is clicked', () => {
    render(<TopBar />);
    fireEvent.click(screen.getByText('Demo'));
    expect(mockWorkspace.startDemoRun).toHaveBeenCalledTimes(1);
  });

  it('renders the Run button', () => {
    render(<TopBar />);
    expect(screen.getByText('Run')).toBeInTheDocument();
  });

  it('calls startOrchestratorRun when Run button is clicked', () => {
    render(<TopBar />);
    fireEvent.click(screen.getByText('Run'));
    expect(mockWorkspace.startOrchestratorRun).toHaveBeenCalledTimes(1);
  });

  it('renders the Live button when CONNECT_WS is enabled', () => {
    render(<TopBar />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('hides the Live button when CONNECT_WS is disabled', () => {
    mockWorkspace.isEnabled.mockImplementation((flag: string) => flag !== 'CONNECT_WS');
    render(<TopBar />);
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('calls startLiveConnection when Live button is clicked', () => {
    render(<TopBar />);
    fireEvent.click(screen.getByText('Live'));
    expect(mockWorkspace.startLiveConnection).toHaveBeenCalledTimes(1);
  });

  it('shows Disconnect button when connected', () => {
    mockConnection.status = 'connected';
    mockConnection.transport = 'websocket';
    render(<TopBar />);
    expect(screen.getByText('Disconnect')).toBeInTheDocument();
  });

  it('calls stopLiveConnection when Disconnect is clicked', () => {
    mockConnection.status = 'connected';
    mockConnection.transport = 'websocket';
    render(<TopBar />);
    fireEvent.click(screen.getByText('Disconnect'));
    expect(mockWorkspace.stopLiveConnection).toHaveBeenCalledTimes(1);
  });

  it('toggles dark mode', () => {
    render(<TopBar />);
    const darkModeBtn = screen.getByTitle('Toggle dark mode (Cmd+T)');
    fireEvent.click(darkModeBtn);
    expect(mockLayoutStore.toggleDarkMode).toHaveBeenCalledTimes(1);
  });

  it('shows correct dark mode tooltip when in dark mode', () => {
    mockLayoutStore.darkMode = true;
    render(<TopBar />);
    expect(screen.getByTitle('Toggle light mode (Cmd+T)')).toBeInTheDocument();
  });

  it('opens command palette on button click', () => {
    render(<TopBar />);
    const cmdPaletteBtn = screen.getByTitle('Command palette (Cmd+K)');
    fireEvent.click(cmdPaletteBtn);
    expect(mockWorkspace.setCommandPaletteOpen).toHaveBeenCalledWith(true);
  });

  it('opens keyboard shortcuts dialog', () => {
    render(<TopBar />);
    const shortcutsBtn = screen.getByTitle('Keyboard shortcuts (Shift+?)');
    fireEvent.click(shortcutsBtn);
    expect(mockWorkspace.setShortcutsDialogOpen).toHaveBeenCalledWith(true);
  });

  it('opens settings dialog', () => {
    render(<TopBar />);
    const settingsBtn = screen.getByTitle('Settings');
    fireEvent.click(settingsBtn);
    expect(mockWorkspace.setSettingsOpen).toHaveBeenCalledWith(true);
  });

  it('renders SaveStatusIndicator', () => {
    render(<TopBar />);
    expect(screen.getByTestId('save-status')).toBeInTheDocument();
  });

  it('renders connection status indicator', () => {
    render(<TopBar />);
    expect(screen.getByTestId('connection-indicator')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<TopBar className="custom-class" />);
    const header = container.querySelector('header');
    expect(header?.className).toContain('custom-class');
  });
});
