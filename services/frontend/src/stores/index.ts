/**
 * MentatLab Stores - Unified state management
 *
 * This is the central export point for all Zustand stores.
 * Import stores from here for consistent usage across the app.
 *
 * Store Architecture:
 * ├── canvas/    - ReactFlow nodes, edges, selection, clipboard
 * ├── streaming/ - SSE/WS streams, event batching, sessions
 * ├── flow/      - Flow persistence, undo/redo
 * ├── layout/    - Panel visibility, sizes, dark mode
 * └── sync/      - Multi-tab synchronization
 *
 * Usage:
 *   import { useCanvasStore, useStreamingStore } from '@/stores';
 *
 *   // In component
 *   const nodes = useCanvasStore((state) => state.nodes);
 *   const connectionStatus = useStreamingStore((state) => state.connectionStatus);
 */

// ─────────────────────────────────────────────────────────────────────────────
// Immer Setup (must be first)
// ─────────────────────────────────────────────────────────────────────────────

import { enableMapSet } from 'immer';

try {
  enableMapSet();
} catch {
  // Already enabled or API changed
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas Store
// ─────────────────────────────────────────────────────────────────────────────

export {
  useCanvasStore,
  selectNodes,
  selectEdges,
  selectSelectedNodeId,
  selectSelectedNodes,
  selectNodeById,
  type CanvasState,
} from './canvas';

// ─────────────────────────────────────────────────────────────────────────────
// Streaming Store
// ─────────────────────────────────────────────────────────────────────────────

export {
  useStreamingStore,
  selectActiveSession,
  selectSessionById,
  selectSessionMessages,
  selectActiveStream,
  selectConnectionStatus,
  type StreamingState,
  type StreamSession,
  type DataPoint,
  type ConsoleMessage,
  type LegacyStream,
  type LegacyStreamSession,
} from './streaming';

// ─────────────────────────────────────────────────────────────────────────────
// Flow Store
// ─────────────────────────────────────────────────────────────────────────────

export {
  useFlowStore,
  selectFlows,
  selectActiveFlowId,
  selectActiveFlow,
  selectFlowById,
  selectCanUndo,
  selectCanRedo,
  type FlowState,
  type Flow,
  type FlowNode,
  type FlowEdge,
} from './flow';

// ─────────────────────────────────────────────────────────────────────────────
// Layout Store
// ─────────────────────────────────────────────────────────────────────────────

export {
  useLayoutStore,
  selectPanel,
  selectVisiblePanels,
  selectBottomPanels,
  selectDarkMode,
  selectMainView,
  selectLayoutDimensions,
  type LayoutState,
  type PanelId,
  type PanelConfig,
  type MainViewMode,
  type SidebarPosition,
} from './layout';

// ─────────────────────────────────────────────────────────────────────────────
// Sync Store
// ─────────────────────────────────────────────────────────────────────────────

export {
  useSyncStore,
  selectIsLeader,
  selectTabId,
  selectIsConnected,
  selectActiveTabCount,
  initializeSync,
  type SyncState,
  type SyncMessage,
  type SyncMessageType,
  type TabInfo,
} from './sync';

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Re-exports (for backwards compatibility during migration)
// ─────────────────────────────────────────────────────────────────────────────

// Re-export canvas store as the default 'useStore' for existing code
export { useCanvasStore as default } from './canvas';

// Alias for components still using 'useReactFlowStore'
export { useCanvasStore as useReactFlowStore } from './canvas';

// ─────────────────────────────────────────────────────────────────────────────
// Store Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reset all stores to initial state
 * Useful for testing or logout scenarios
 */
export function resetAllStores() {
  const { useCanvasStore } = require('./canvas');
  const { useStreamingStore } = require('./streaming');
  const { useFlowStore } = require('./flow');
  const { useLayoutStore } = require('./layout');
  const { useSyncStore } = require('./sync');

  useCanvasStore.getState().clearCanvas();
  useStreamingStore.getState().clearAll();
  useFlowStore.getState().clearHistory();
  useLayoutStore.getState().resetLayout();
  useSyncStore.getState().destroy();
}

/**
 * Get a snapshot of all store states (for debugging)
 */
export function getStoreSnapshot() {
  const { useCanvasStore } = require('./canvas');
  const { useStreamingStore } = require('./streaming');
  const { useFlowStore } = require('./flow');
  const { useLayoutStore } = require('./layout');
  const { useSyncStore } = require('./sync');

  return {
    canvas: {
      nodeCount: useCanvasStore.getState().nodes.length,
      edgeCount: useCanvasStore.getState().edges.length,
      selectedNodeId: useCanvasStore.getState().selectedNodeId,
    },
    streaming: {
      sessionCount: useStreamingStore.getState().sessions.size,
      activeSessionId: useStreamingStore.getState().activeSessionId,
      connectionStatus: useStreamingStore.getState().connectionStatus,
    },
    flow: {
      flowCount: useFlowStore.getState().flows.size,
      activeFlowId: useFlowStore.getState().activeFlowId,
      canUndo: useFlowStore.getState().canUndo(),
      canRedo: useFlowStore.getState().canRedo(),
    },
    layout: {
      darkMode: useLayoutStore.getState().darkMode,
      mainView: useLayoutStore.getState().mainView,
    },
    sync: {
      isLeader: useSyncStore.getState().isLeader,
      tabCount: useSyncStore.getState().getActiveTabs().length,
    },
  };
}
