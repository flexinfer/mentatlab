/**
 * Layout Store - Panel layout state management
 *
 * Manages UI layout state:
 * - Panel visibility and sizes
 * - Sidebar collapse state
 * - Active tabs
 * - Dark mode
 * - Panel positions (for draggable panels)
 *
 * All state is persisted to localStorage for user preference retention.
 */

import { create } from 'zustand';
import { devtools, persist, subscribeWithSelector } from 'zustand/middleware';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PanelId =
  | 'console'
  | 'issues'
  | 'timeline'
  | 'runs'
  | 'network'
  | 'graph'
  | 'inspector'
  | 'cogpaks'
  | 'flows';

export type SidebarPosition = 'left' | 'right';

export type MainViewMode = 'canvas' | 'network' | 'flow' | 'code';

export interface PanelConfig {
  id: PanelId;
  visible: boolean;
  collapsed: boolean;
  size: number; // percentage or pixels depending on panel type
  order: number; // for reordering panels
}

export interface LayoutState {
  // Panel state
  panels: Record<PanelId, PanelConfig>;

  // Active tabs
  activeBottomTab: string;
  activeLeftTab: string;
  activeRightTab: string;

  // Sidebar state
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  bottomDockCollapsed: boolean;
  bottomDockHeight: number;
  leftSidebarWidth: number;
  rightSidebarWidth: number;

  // View mode
  mainView: MainViewMode;

  // Theme
  darkMode: boolean;

  // Panel actions
  togglePanel: (panelId: PanelId) => void;
  showPanel: (panelId: PanelId) => void;
  hidePanel: (panelId: PanelId) => void;
  setPanelSize: (panelId: PanelId, size: number) => void;
  togglePanelCollapse: (panelId: PanelId) => void;
  reorderPanels: (panelIds: PanelId[]) => void;

  // Tab actions
  setActiveBottomTab: (tab: string) => void;
  setActiveLeftTab: (tab: string) => void;
  setActiveRightTab: (tab: string) => void;

  // Sidebar actions
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  toggleBottomDock: () => void;
  setLeftSidebarWidth: (width: number) => void;
  setRightSidebarWidth: (width: number) => void;
  setBottomDockHeight: (height: number) => void;

  // View actions
  setMainView: (view: MainViewMode) => void;
  setDarkMode: (dark: boolean) => void;
  toggleDarkMode: () => void;

  // Reset
  resetLayout: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

const defaultPanels: Record<PanelId, PanelConfig> = {
  console: { id: 'console', visible: true, collapsed: false, size: 100, order: 0 },
  issues: { id: 'issues', visible: true, collapsed: false, size: 100, order: 1 },
  timeline: { id: 'timeline', visible: true, collapsed: false, size: 100, order: 2 },
  runs: { id: 'runs', visible: true, collapsed: false, size: 100, order: 3 },
  network: { id: 'network', visible: true, collapsed: false, size: 100, order: 4 },
  graph: { id: 'graph', visible: false, collapsed: false, size: 100, order: 5 },
  inspector: { id: 'inspector', visible: true, collapsed: false, size: 320, order: 0 },
  cogpaks: { id: 'cogpaks', visible: true, collapsed: false, size: 100, order: 0 },
  flows: { id: 'flows', visible: true, collapsed: false, size: 100, order: 1 },
};

const defaultLayoutState: Omit<LayoutState, keyof ReturnType<typeof createActions>> = {
  panels: defaultPanels,
  activeBottomTab: 'Console',
  activeLeftTab: 'CogPaks',
  activeRightTab: 'Inspector',
  leftSidebarCollapsed: false,
  rightSidebarCollapsed: false,
  bottomDockCollapsed: false,
  bottomDockHeight: 250,
  leftSidebarWidth: 280,
  rightSidebarWidth: 320,
  mainView: 'canvas',
  darkMode: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Actions factory (for type inference)
// ─────────────────────────────────────────────────────────────────────────────

function createActions(set: any, get: any) {
  return {
    // Panel actions
    togglePanel: (panelId: PanelId) => {
      set((state: LayoutState) => ({
        panels: {
          ...state.panels,
          [panelId]: {
            ...state.panels[panelId],
            visible: !state.panels[panelId].visible,
          },
        },
      }));
    },

    showPanel: (panelId: PanelId) => {
      set((state: LayoutState) => ({
        panels: {
          ...state.panels,
          [panelId]: {
            ...state.panels[panelId],
            visible: true,
          },
        },
      }));
    },

    hidePanel: (panelId: PanelId) => {
      set((state: LayoutState) => ({
        panels: {
          ...state.panels,
          [panelId]: {
            ...state.panels[panelId],
            visible: false,
          },
        },
      }));
    },

    setPanelSize: (panelId: PanelId, size: number) => {
      set((state: LayoutState) => ({
        panels: {
          ...state.panels,
          [panelId]: {
            ...state.panels[panelId],
            size: Math.max(0, size),
          },
        },
      }));
    },

    togglePanelCollapse: (panelId: PanelId) => {
      set((state: LayoutState) => ({
        panels: {
          ...state.panels,
          [panelId]: {
            ...state.panels[panelId],
            collapsed: !state.panels[panelId].collapsed,
          },
        },
      }));
    },

    reorderPanels: (panelIds: PanelId[]) => {
      set((state: LayoutState) => {
        const newPanels = { ...state.panels };
        panelIds.forEach((id, index) => {
          if (newPanels[id]) {
            newPanels[id] = { ...newPanels[id], order: index };
          }
        });
        return { panels: newPanels };
      });
    },

    // Tab actions
    setActiveBottomTab: (tab: string) => set({ activeBottomTab: tab }),
    setActiveLeftTab: (tab: string) => set({ activeLeftTab: tab }),
    setActiveRightTab: (tab: string) => set({ activeRightTab: tab }),

    // Sidebar actions
    toggleLeftSidebar: () => {
      set((state: LayoutState) => ({ leftSidebarCollapsed: !state.leftSidebarCollapsed }));
    },

    toggleRightSidebar: () => {
      set((state: LayoutState) => ({ rightSidebarCollapsed: !state.rightSidebarCollapsed }));
    },

    toggleBottomDock: () => {
      set((state: LayoutState) => ({ bottomDockCollapsed: !state.bottomDockCollapsed }));
    },

    setLeftSidebarWidth: (width: number) => {
      set({ leftSidebarWidth: Math.max(200, Math.min(600, width)) });
    },

    setRightSidebarWidth: (width: number) => {
      set({ rightSidebarWidth: Math.max(200, Math.min(600, width)) });
    },

    setBottomDockHeight: (height: number) => {
      set({ bottomDockHeight: Math.max(100, Math.min(600, height)) });
    },

    // View actions
    setMainView: (view: MainViewMode) => set({ mainView: view }),

    setDarkMode: (dark: boolean) => {
      set({ darkMode: dark });
      // Apply to document
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', dark);
      }
    },

    toggleDarkMode: () => {
      const current = get().darkMode;
      get().setDarkMode(!current);
    },

    // Reset
    resetLayout: () => {
      set(defaultLayoutState);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useLayoutStore = create<LayoutState>()(
  devtools(
    persist(
      subscribeWithSelector((set, get) => ({
        ...defaultLayoutState,
        ...createActions(set, get),
      })),
      {
        name: 'mentatlab-layout',
        partialize: (state) => ({
          panels: state.panels,
          activeBottomTab: state.activeBottomTab,
          activeLeftTab: state.activeLeftTab,
          activeRightTab: state.activeRightTab,
          leftSidebarCollapsed: state.leftSidebarCollapsed,
          rightSidebarCollapsed: state.rightSidebarCollapsed,
          bottomDockCollapsed: state.bottomDockCollapsed,
          bottomDockHeight: state.bottomDockHeight,
          leftSidebarWidth: state.leftSidebarWidth,
          rightSidebarWidth: state.rightSidebarWidth,
          mainView: state.mainView,
          darkMode: state.darkMode,
        }),
        onRehydrateStorage: () => (state) => {
          // Apply dark mode on hydration
          if (state?.darkMode && typeof document !== 'undefined') {
            document.documentElement.classList.add('dark');
          }
        },
      }
    ),
    { name: 'layout-store' }
  )
);

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────────────────────

export const selectPanel = (panelId: PanelId) => (state: LayoutState) =>
  state.panels[panelId];

export const selectVisiblePanels = (state: LayoutState) =>
  Object.values(state.panels).filter((p) => p.visible);

export const selectBottomPanels = (state: LayoutState) =>
  Object.values(state.panels)
    .filter((p) => ['console', 'issues', 'timeline', 'runs', 'network'].includes(p.id))
    .sort((a, b) => a.order - b.order);

export const selectDarkMode = (state: LayoutState) => state.darkMode;
export const selectMainView = (state: LayoutState) => state.mainView;

// Computed selectors for layout dimensions
export const selectLayoutDimensions = (state: LayoutState) => ({
  leftWidth: state.leftSidebarCollapsed ? 0 : state.leftSidebarWidth,
  rightWidth: state.rightSidebarCollapsed ? 0 : state.rightSidebarWidth,
  bottomHeight: state.bottomDockCollapsed ? 0 : state.bottomDockHeight,
});

export default useLayoutStore;
