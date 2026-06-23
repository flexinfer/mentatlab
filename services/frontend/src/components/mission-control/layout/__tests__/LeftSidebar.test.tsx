import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LeftSidebar } from '../LeftSidebar';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockLayoutStore = vi.hoisted(() => ({
  leftSidebarCollapsed: false,
  toggleLeftSidebar: vi.fn(),
  leftSidebarWidth: 280,
  setLeftSidebarWidth: vi.fn(),
}));

const mockWorkspace = vi.hoisted(() => ({
  setMainView: vi.fn(),
}));

vi.mock('@/stores', () => ({
  useLayoutStore: () => mockLayoutStore,
}));

vi.mock('../WorkspaceProvider', () => ({
  useWorkspace: () => mockWorkspace,
}));

// Mock react-resizable-panels to render children directly
vi.mock('react-resizable-panels', () => ({
  Panel: ({
    children,
    className,
    onResize,
    ...rest
  }: {
    children?: React.ReactNode;
    className?: string;
    onResize?: (size: number) => void;
    [key: string]: unknown;
  }) => (
    <div data-testid="panel" className={className} {...rest}>
      {children}
    </div>
  ),
  PanelResizeHandle: ({ className }: { className?: string }) => (
    <div data-testid="panel-resize-handle" className={className} />
  ),
  PanelGroup: ({
    children,
    direction,
  }: {
    children: React.ReactNode;
    direction?: string;
  }) => (
    <div data-testid="panel-group" data-direction={direction}>
      {children}
    </div>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('LeftSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLayoutStore.leftSidebarCollapsed = false;
    mockLayoutStore.leftSidebarWidth = 280;
  });

  it('renders expanded sidebar with Navigator header', () => {
    render(<LeftSidebar />);
    expect(screen.getByText('Navigator')).toBeInTheDocument();
  });

  it('renders the Workspaces section', () => {
    render(<LeftSidebar />);
    expect(screen.getByText('Workspaces')).toBeInTheDocument();
  });

  it('renders the Default workspace item', () => {
    render(<LeftSidebar />);
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('switches to canvas view when Default workspace is clicked', () => {
    render(<LeftSidebar />);
    fireEvent.click(screen.getByText('Default'));
    expect(mockWorkspace.setMainView).toHaveBeenCalledWith('canvas');
  });

  it('renders children content', () => {
    render(
      <LeftSidebar>
        <div data-testid="custom-child">Custom Content</div>
      </LeftSidebar>
    );
    expect(screen.getByTestId('custom-child')).toBeInTheDocument();
    expect(screen.getByText('Custom Content')).toBeInTheDocument();
  });

  it('renders collapse button with Collapse sidebar title when expanded', () => {
    render(<LeftSidebar />);
    expect(screen.getByTitle('Collapse sidebar')).toBeInTheDocument();
  });

  it('calls toggleLeftSidebar when collapse button is clicked (expanded)', () => {
    render(<LeftSidebar />);
    fireEvent.click(screen.getByTitle('Collapse sidebar'));
    expect(mockLayoutStore.toggleLeftSidebar).toHaveBeenCalledTimes(1);
  });

  it('renders collapsed state with expand button', () => {
    mockLayoutStore.leftSidebarCollapsed = true;
    render(<LeftSidebar />);
    expect(screen.getByTitle('Expand sidebar')).toBeInTheDocument();
    expect(screen.queryByText('Navigator')).not.toBeInTheDocument();
  });

  it('calls toggleLeftSidebar when expand button is clicked (collapsed)', () => {
    mockLayoutStore.leftSidebarCollapsed = true;
    render(<LeftSidebar />);
    fireEvent.click(screen.getByTitle('Expand sidebar'));
    expect(mockLayoutStore.toggleLeftSidebar).toHaveBeenCalledTimes(1);
  });

  it('does not render children when collapsed', () => {
    mockLayoutStore.leftSidebarCollapsed = true;
    render(
      <LeftSidebar>
        <div data-testid="hidden-child">Should Be Hidden</div>
      </LeftSidebar>
    );
    expect(screen.queryByTestId('hidden-child')).not.toBeInTheDocument();
  });

  it('renders PanelResizeHandle', () => {
    render(<LeftSidebar />);
    expect(screen.getByTestId('panel-resize-handle')).toBeInTheDocument();
  });

  it('applies custom className when provided', () => {
    const { container } = render(<LeftSidebar className="my-custom-class" />);
    const panel = screen.getAllByTestId('panel')[0];
    expect(panel.className).toContain('my-custom-class');
  });

  it('renders Section sub-component', () => {
    render(
      <LeftSidebar>
        <LeftSidebar.Section title="My Section">
          <div data-testid="section-content">Section Child</div>
        </LeftSidebar.Section>
      </LeftSidebar>
    );
    expect(screen.getByText('My Section')).toBeInTheDocument();
    expect(screen.getByTestId('section-content')).toBeInTheDocument();
  });

  it('collapsed sidebar renders a Panel', () => {
    mockLayoutStore.leftSidebarCollapsed = true;
    render(<LeftSidebar />);
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });
});
