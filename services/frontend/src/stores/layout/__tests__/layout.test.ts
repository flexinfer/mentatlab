import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useLayoutStore,
  selectPanel,
  selectVisiblePanels,
  selectBottomPanels,
  selectDarkMode,
  selectLayoutDimensions,
  type PanelId,
} from '../index';

// ---------------------------------------------------------------------------
// Helper: snapshot the current state (without action functions)
// ---------------------------------------------------------------------------
function getState() {
  return useLayoutStore.getState();
}

// ---------------------------------------------------------------------------
// Reset before every test
// ---------------------------------------------------------------------------
beforeEach(() => {
  act(() => {
    useLayoutStore.getState().resetLayout();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Initial State
// ═══════════════════════════════════════════════════════════════════════════

describe('Layout Store - initial state', () => {
  it('has correct default panels', () => {
    const state = getState();
    expect(Object.keys(state.panels)).toEqual(
      expect.arrayContaining([
        'console',
        'issues',
        'timeline',
        'runs',
        'network',
        'graph',
        'inspector',
        'cogpaks',
        'flows',
      ]),
    );
    // console defaults
    expect(state.panels.console).toEqual({
      id: 'console',
      visible: true,
      collapsed: false,
      size: 100,
      order: 0,
    });
    // graph starts hidden
    expect(state.panels.graph?.visible).toBe(false);
  });

  it('has correct default tab selections', () => {
    const state = getState();
    expect(state.activeBottomTab).toBe('Console');
    expect(state.activeLeftTab).toBe('CogPaks');
    expect(state.activeRightTab).toBe('Inspector');
  });

  it('has correct default sidebar widths and collapsed state', () => {
    const state = getState();
    expect(state.leftSidebarCollapsed).toBe(false);
    expect(state.rightSidebarCollapsed).toBe(false);
    expect(state.bottomDockCollapsed).toBe(false);
    expect(state.leftSidebarWidth).toBe(280);
    expect(state.rightSidebarWidth).toBe(320);
    expect(state.bottomDockHeight).toBe(250);
  });

  it('has correct default view mode and dark mode', () => {
    const state = getState();
    expect(state.mainView).toBe('canvas');
    expect(state.darkMode).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Panel Actions
// ═══════════════════════════════════════════════════════════════════════════

describe('Layout Store - panel actions', () => {
  it('togglePanel flips visibility', () => {
    expect(getState().panels.console?.visible).toBe(true);

    act(() => { getState().togglePanel('console'); });
    expect(getState().panels.console?.visible).toBe(false);

    act(() => { getState().togglePanel('console'); });
    expect(getState().panels.console?.visible).toBe(true);
  });

  it('showPanel makes panel visible', () => {
    act(() => { getState().hidePanel('console'); });
    expect(getState().panels.console?.visible).toBe(false);

    act(() => { getState().showPanel('console'); });
    expect(getState().panels.console?.visible).toBe(true);
  });

  it('hidePanel hides a panel', () => {
    act(() => { getState().hidePanel('issues'); });
    expect(getState().panels.issues?.visible).toBe(false);
  });

  it('setPanelSize updates size', () => {
    act(() => { getState().setPanelSize('console', 200); });
    expect(getState().panels.console?.size).toBe(200);
  });

  it('setPanelSize clamps to >= 0', () => {
    act(() => { getState().setPanelSize('console', -50); });
    expect(getState().panels.console?.size).toBe(0);
  });

  it('togglePanelCollapse flips collapsed', () => {
    expect(getState().panels.console?.collapsed).toBe(false);

    act(() => { getState().togglePanelCollapse('console'); });
    expect(getState().panels.console?.collapsed).toBe(true);

    act(() => { getState().togglePanelCollapse('console'); });
    expect(getState().panels.console?.collapsed).toBe(false);
  });

  it('reorderPanels sets correct order values', () => {
    const order: PanelId[] = ['timeline', 'console', 'issues'];
    act(() => { getState().reorderPanels(order); });

    expect(getState().panels.timeline?.order).toBe(0);
    expect(getState().panels.console?.order).toBe(1);
    expect(getState().panels.issues?.order).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tab Actions
// ═══════════════════════════════════════════════════════════════════════════

describe('Layout Store - tab actions', () => {
  it('setActiveBottomTab updates the active bottom tab', () => {
    act(() => { getState().setActiveBottomTab('Issues'); });
    expect(getState().activeBottomTab).toBe('Issues');
  });

  it('setActiveLeftTab updates the active left tab', () => {
    act(() => { getState().setActiveLeftTab('Flows'); });
    expect(getState().activeLeftTab).toBe('Flows');
  });

  it('setActiveRightTab updates the active right tab', () => {
    act(() => { getState().setActiveRightTab('Settings'); });
    expect(getState().activeRightTab).toBe('Settings');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sidebar Actions
// ═══════════════════════════════════════════════════════════════════════════

describe('Layout Store - sidebar actions', () => {
  it('toggleLeftSidebar flips collapsed state', () => {
    expect(getState().leftSidebarCollapsed).toBe(false);

    act(() => { getState().toggleLeftSidebar(); });
    expect(getState().leftSidebarCollapsed).toBe(true);

    act(() => { getState().toggleLeftSidebar(); });
    expect(getState().leftSidebarCollapsed).toBe(false);
  });

  it('toggleRightSidebar flips collapsed state', () => {
    expect(getState().rightSidebarCollapsed).toBe(false);

    act(() => { getState().toggleRightSidebar(); });
    expect(getState().rightSidebarCollapsed).toBe(true);

    act(() => { getState().toggleRightSidebar(); });
    expect(getState().rightSidebarCollapsed).toBe(false);
  });

  it('toggleBottomDock flips collapsed state', () => {
    expect(getState().bottomDockCollapsed).toBe(false);

    act(() => { getState().toggleBottomDock(); });
    expect(getState().bottomDockCollapsed).toBe(true);

    act(() => { getState().toggleBottomDock(); });
    expect(getState().bottomDockCollapsed).toBe(false);
  });

  it('setLeftSidebarWidth clamps to 200-600', () => {
    act(() => { getState().setLeftSidebarWidth(400); });
    expect(getState().leftSidebarWidth).toBe(400);

    act(() => { getState().setLeftSidebarWidth(50); });
    expect(getState().leftSidebarWidth).toBe(200);

    act(() => { getState().setLeftSidebarWidth(900); });
    expect(getState().leftSidebarWidth).toBe(600);
  });

  it('setRightSidebarWidth clamps to 200-600', () => {
    act(() => { getState().setRightSidebarWidth(500); });
    expect(getState().rightSidebarWidth).toBe(500);

    act(() => { getState().setRightSidebarWidth(100); });
    expect(getState().rightSidebarWidth).toBe(200);

    act(() => { getState().setRightSidebarWidth(800); });
    expect(getState().rightSidebarWidth).toBe(600);
  });

  it('setBottomDockHeight clamps to 100-600', () => {
    act(() => { getState().setBottomDockHeight(300); });
    expect(getState().bottomDockHeight).toBe(300);

    act(() => { getState().setBottomDockHeight(10); });
    expect(getState().bottomDockHeight).toBe(100);

    act(() => { getState().setBottomDockHeight(999); });
    expect(getState().bottomDockHeight).toBe(600);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// View & Theme Actions
// ═══════════════════════════════════════════════════════════════════════════

describe('Layout Store - view and theme actions', () => {
  it('setMainView updates view mode', () => {
    act(() => { getState().setMainView('network'); });
    expect(getState().mainView).toBe('network');

    act(() => { getState().setMainView('code'); });
    expect(getState().mainView).toBe('code');
  });

  it('toggleDarkMode flips darkMode', () => {
    expect(getState().darkMode).toBe(false);

    act(() => { getState().toggleDarkMode(); });
    expect(getState().darkMode).toBe(true);

    act(() => { getState().toggleDarkMode(); });
    expect(getState().darkMode).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Reset
// ═══════════════════════════════════════════════════════════════════════════

describe('Layout Store - resetLayout', () => {
  it('restores defaults after mutations', () => {
    act(() => {
      getState().togglePanel('console');
      getState().setActiveBottomTab('Issues');
      getState().toggleLeftSidebar();
      getState().setLeftSidebarWidth(500);
      getState().setMainView('network');
      getState().toggleDarkMode();
    });

    // Verify mutations took effect
    expect(getState().panels.console?.visible).toBe(false);
    expect(getState().activeBottomTab).toBe('Issues');
    expect(getState().leftSidebarCollapsed).toBe(true);
    expect(getState().leftSidebarWidth).toBe(500);
    expect(getState().mainView).toBe('network');
    expect(getState().darkMode).toBe(true);

    act(() => { getState().resetLayout(); });

    expect(getState().panels.console?.visible).toBe(true);
    expect(getState().activeBottomTab).toBe('Console');
    expect(getState().leftSidebarCollapsed).toBe(false);
    expect(getState().leftSidebarWidth).toBe(280);
    expect(getState().mainView).toBe('canvas');
    expect(getState().darkMode).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Selectors
// ═══════════════════════════════════════════════════════════════════════════

describe('Layout Store - selectors', () => {
  it('selectPanel returns the requested panel config', () => {
    const panel = selectPanel('inspector')(getState());
    expect(panel).toEqual({
      id: 'inspector',
      visible: true,
      collapsed: false,
      size: 320,
      order: 0,
    });
  });

  it('selectVisiblePanels returns only visible panels', () => {
    // graph is hidden by default
    const visible = selectVisiblePanels(getState());
    const ids = visible.map((p) => p.id);
    expect(ids).not.toContain('graph');
    expect(ids).toContain('console');
    expect(ids).toContain('issues');

    // Hide console
    act(() => { getState().hidePanel('console'); });
    const updated = selectVisiblePanels(getState());
    expect(updated.map((p) => p.id)).not.toContain('console');
  });

  it('selectBottomPanels returns only bottom panels sorted by order', () => {
    const bottom = selectBottomPanels(getState());
    const ids = bottom.map((p) => p.id);
    expect(ids).toEqual(['console', 'issues', 'timeline', 'runs', 'network']);
  });

  it('selectDarkMode returns darkMode value', () => {
    expect(selectDarkMode(getState())).toBe(false);
    act(() => { getState().toggleDarkMode(); });
    expect(selectDarkMode(getState())).toBe(true);
  });

  it('selectLayoutDimensions returns computed widths/heights', () => {
    const dims = selectLayoutDimensions(getState());
    expect(dims).toEqual({
      leftWidth: 280,
      rightWidth: 320,
      bottomHeight: 250,
    });
  });

  it('selectLayoutDimensions returns 0 for collapsed sidebars', () => {
    act(() => {
      getState().toggleLeftSidebar();
      getState().toggleRightSidebar();
      getState().toggleBottomDock();
    });

    const dims = selectLayoutDimensions(getState());
    expect(dims).toEqual({
      leftWidth: 0,
      rightWidth: 0,
      bottomHeight: 0,
    });
  });
});
