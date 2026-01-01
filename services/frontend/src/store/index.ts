// stores/index.ts
// Ensure Immer is configured for Map/Set drafts before creating any stores
import './immerSetup';
import { create } from 'zustand';
import { devtools, persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuidv4 } from 'uuid'; // Use uuidv4 for clarity
import { StreamConnectionState, StreamingMessage, ErrorMessage } from '../types/streaming'; // Import StreamConnectionState, StreamingMessage, and ErrorMessage
import { MediaReference } from '../types/media'; // Assuming MediaReference is defined here
import { FileUploadState, UploadProgress } from '../components/multimodal/FileUploader/FileUploader.types'; // Import FileUploadState and UploadProgress

interface FlowState {
  flows: Map<string, any>; // Placeholder, replace with actual Flow type
  activeFlowId: string | null;

  // Undo/Redo state
  history: Array<Map<string, any>>; // History of flow states
  historyIndex: number; // Current position in history
  maxHistorySize: number; // Maximum number of history entries

  // Actions
  updateFlow: (flowId: string, updates: any) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
}

interface MediaState {
  mediaItems: Map<string, MediaReference>;
  uploadQueue: FileUploadState[]; // Use FileUploadState for type consistency
  activeUploads: Map<string, any>; // Placeholder for active uploads
  uploadProgress: Map<string, number>; // Upload progress tracking (0-100)
  processingStates: Map<string, UploadProgress['status']>; // Use UploadProgress status
  cacheSize: number; // Current cache size in bytes
  maxCacheSize: number; // Maximum cache size in bytes
  
  // Actions
  queueUpload: (file: File, metadata: any) => void;
  addToUploadQueue: (uploadFile: FileUploadState) => void; // New action to add FileUploadState
  removeFromUploadQueue: (id: string) => void; // New action to remove from queue
  setUploadProgress: (id: string, progress: number) => void;
  setProcessingState: (id: string, state: UploadProgress['status']) => void; // Use UploadProgress status
  addMediaItem: (item: MediaReference) => void;
  removeMediaItem: (id: string) => void;
  evictOldestItems: (targetSize: number) => void;
  clearCache: () => void;
  getCacheInfo: () => { size: number; maxSize: number; itemCount: number };
}

interface StreamSession {
  id: string;
  config: any; // More specific type can be added here if stream configuration is complex
  status: StreamConnectionState;
  buffer: StreamingMessage[]; // Buffer for incoming messages for this stream
  errors: ErrorMessage[]; // Array to store errors related to this stream
}

export interface StreamingState {
  activeStreams: Map<string, StreamSession>;
  connectionStatus: StreamConnectionState;
  registerStream: (streamId: string, config: any) => void;
  updateStreamStatus: (streamId: string, status: StreamConnectionState) => void;
  addStreamMessage: (streamId: string, message: StreamingMessage) => void;
  addStreamError: (streamId: string, error: ErrorMessage) => void; // New action to add errors
  setConnectionStatus: (status: StreamConnectionState) => void;
}

// Helper to deep clone a Map of flows
function cloneFlowsMap(flows: Map<string, any>): Map<string, any> {
  const cloned = new Map();
  flows.forEach((value, key) => {
    cloned.set(key, JSON.parse(JSON.stringify(value)));
  });
  return cloned;
}

// Core stores
export const useFlowStore = create<FlowState>()(
  devtools(
    persist(
      subscribeWithSelector(
        immer((set, get) => ({
          // Flow state
          flows: new Map(),
          activeFlowId: null,

          // Undo/Redo state
          history: [],
          historyIndex: -1,
          maxHistorySize: 50, // Keep last 50 states

          // Actions
          updateFlow: (flowId: string, updates: any) =>
            set((state: any) => {
              // Save current state to history before making changes
              const currentFlows = cloneFlowsMap(state.flows);

              // Trim future history if we're not at the end
              if (state.historyIndex < state.history.length - 1) {
                state.history = state.history.slice(0, state.historyIndex + 1);
              }

              // Add current state to history
              state.history.push(currentFlows);

              // Trim history if it exceeds max size
              if (state.history.length > state.maxHistorySize) {
                state.history = state.history.slice(state.history.length - state.maxHistorySize);
              }

              // Update history index
              state.historyIndex = state.history.length - 1;

              // Apply the update
              const flow = state.flows.get(flowId);
              if (flow) {
                Object.assign(flow, updates);
              }
            }),

          undo: () =>
            set((state: any) => {
              if (state.historyIndex > 0) {
                state.historyIndex -= 1;
                state.flows = cloneFlowsMap(state.history[state.historyIndex]);
              }
            }),

          redo: () =>
            set((state: any) => {
              if (state.historyIndex < state.history.length - 1) {
                state.historyIndex += 1;
                state.flows = cloneFlowsMap(state.history[state.historyIndex]);
              }
            }),

          canUndo: () => {
            const state = get();
            return state.historyIndex > 0;
          },

          canRedo: () => {
            const state = get();
            return state.historyIndex < state.history.length - 1;
          },

          clearHistory: () =>
            set((state: any) => {
              state.history = [];
              state.historyIndex = -1;
            }),
        }))
      ),
      {
        name: 'flow-store',
        partialize: (state) => ({
          flows: Array.from(state.flows.entries()),
          activeFlowId: state.activeFlowId,
          // Don't persist history to localStorage (too large)
        }),
        onRehydrateStorage: () => (state) => {
          if (state?.flows) {
            state.flows = new Map(state.flows);
          }
          // Initialize history with current state
          if (state) {
            state.history = [cloneFlowsMap(state.flows)];
            state.historyIndex = 0;
          }
        }
      }
    )
  )
);

export const useMediaStore = create<MediaState>()(
  devtools(
    immer((set, get) => ({
      // Media references
      mediaItems: new Map(),
      uploadQueue: [],
      activeUploads: new Map(),
      uploadProgress: new Map(),
      processingStates: new Map(),
      cacheSize: 0,
      maxCacheSize: 100 * 1024 * 1024, // 100MB default
      
      // Actions
      queueUpload: (file: File, metadata: any) => {
        const newUploadFile: FileUploadState = {
          id: uuidv4(),
          file,
          status: 'queued', // Initial status is 'queued'
          progress: 0,
          startTime: Date.now(),
          metadata,
        };
        set((state) => {
          state.uploadQueue.push(newUploadFile);
        });
      },

      addToUploadQueue: (uploadFile: FileUploadState) =>
        set((state) => {
          state.uploadQueue.push(uploadFile);
        }),

      removeFromUploadQueue: (id: string) =>
        set((state) => {
          state.uploadQueue = state.uploadQueue.filter((file: FileUploadState) => file.id !== id);
          state.uploadProgress.delete(id);
          state.processingStates.delete(id);
        }),

      setUploadProgress: (id: string, progress: number) =>
        set((state) => {
          const fileIndex = state.uploadQueue.findIndex((file: FileUploadState) => file.id === id);
          if (fileIndex !== -1) {
            state.uploadQueue[fileIndex].progress = Math.max(0, Math.min(100, progress));
          }
          state.uploadProgress.set(id, Math.max(0, Math.min(100, progress)));
        }),

      setProcessingState: (id: string, status: UploadProgress['status']) =>
        set((state) => {
          const fileIndex = state.uploadQueue.findIndex((file: FileUploadState) => file.id === id);
          if (fileIndex !== -1) {
            state.uploadQueue[fileIndex].status = status;
          }
          state.processingStates.set(id, status);
        }),

      addMediaItem: (item: MediaReference) =>
        set((state) => {
          state.mediaItems.set(item.refId, item);
          // Calculate size from metadata if available
          const size = item.metadata?.size || 0;
          state.cacheSize += size;
          
          // Auto-evict if cache size exceeds limit
          if (state.cacheSize > state.maxCacheSize) {
            const targetSize = state.maxCacheSize * 0.8; // Evict to 80% of max size
            get().evictOldestItems(targetSize);
          }
        }),

      removeMediaItem: (id: string) =>
        set((state) => {
          const item = state.mediaItems.get(id);
          if (item) {
            const size = item.metadata?.size || 0;
            state.mediaItems.delete(id);
            state.cacheSize -= size;
          }
        }),

      evictOldestItems: (targetSize: number) => {
        const currentCacheSize = get().cacheSize;
        if (currentCacheSize <= targetSize) return;

        set((draft: MediaState) => {
          // Sort items by creation date (oldest first)
          const sortedMediaReferences = Array.from(draft.mediaItems.values()).sort(
            (a: MediaReference, b: MediaReference) => {
              const aCreatedAt = (a.metadata && a.metadata.createdAt) ? new Date(a.metadata.createdAt).getTime() : 0;
              const bCreatedAt = (b.metadata && b.metadata.createdAt) ? new Date(b.metadata.createdAt).getTime() : 0;
              return aCreatedAt - bCreatedAt;
            }
          );

          for (const item of sortedMediaReferences) {
            if (draft.cacheSize <= targetSize) break;
            
            const size = item.metadata?.size || 0;
            draft.mediaItems.delete(item.refId);
            draft.cacheSize -= size;
          }
        });
      },

      clearCache: () =>
        set((state) => {
          state.mediaItems.clear();
          state.uploadProgress.clear();
          state.processingStates.clear();
          state.cacheSize = 0;
        }),

      getCacheInfo: () => {
        const state = get();
        return {
          size: state.cacheSize,
          maxSize: state.maxCacheSize,
          itemCount: state.mediaItems.size
        };
      },
    }))
  )
);

export const useStreamingStore = create<StreamingState>()(
  devtools((set, get) => ({
    // Streaming state
    activeStreams: new Map<string, StreamSession>(),
    connectionStatus: StreamConnectionState.DISCONNECTED,

    // Actions (no Immer – use plain immutable updates)
    registerStream: (streamId: string, config: any) => {
      const current = get().activeStreams;
      const next = new Map(current);
      next.set(streamId, {
        id: streamId,
        config,
        status: StreamConnectionState.CONNECTING,
        buffer: [],
        errors: [],
      });

      // Auto-cleanup: limit to 50 streams max, remove oldest if exceeded
      if (next.size > 50) {
        const sortedKeys = Array.from(next.keys());
        // Remove the oldest (first registered) streams
        const toRemove = sortedKeys.slice(0, next.size - 50);
        toRemove.forEach(key => next.delete(key));
      }

      set({ activeStreams: next });
    },

    updateStreamStatus: (streamId: string, status: StreamConnectionState) => {
      const current = get().activeStreams;
      const existing = current.get(streamId);
      if (!existing) return;
      const next = new Map(current);
      next.set(streamId, { ...existing, status });
      set({ activeStreams: next });
    },

    addStreamMessage: (streamId: string, message: StreamingMessage) => {
      const current = get().activeStreams;
      const existing = current.get(streamId);
      if (!existing) return;
      const next = new Map(current);
      // Limit buffer size to prevent memory leaks
      const buffer = existing.buffer.length >= 1000
        ? [...existing.buffer.slice(-999), message]
        : [...existing.buffer, message];
      next.set(streamId, { ...existing, buffer });
      set({ activeStreams: next });
    },

    addStreamError: (streamId: string, error: ErrorMessage) => {
      const current = get().activeStreams;
      const existing = current.get(streamId);
      if (!existing) return;
      const next = new Map(current);
      // Limit errors array too
      const errors = existing.errors.length >= 100
        ? [...existing.errors.slice(-99), error]
        : [...existing.errors, error];
      next.set(streamId, { ...existing, errors });
      set({ activeStreams: next });
    },

    setConnectionStatus: (status: StreamConnectionState) => set({ connectionStatus: status }),
  }))
);

// ─────────────────────────────────────────────────────────────────────────────
// Panel Layout Store - persists panel visibility, sizes, and collapse state
// ─────────────────────────────────────────────────────────────────────────────

export type PanelId = 'console' | 'issues' | 'timeline' | 'runs' | 'network' | 'graph' | 'inspector';

export interface PanelLayoutState {
  // Active bottom dock tab
  activeBottomTab: string;
  // Panel visibility (for toggleable panels)
  visiblePanels: Set<PanelId>;
  // Panel sizes (percentage or pixels)
  panelSizes: Record<PanelId, number>;
  // Collapsed panels
  collapsedPanels: Set<PanelId>;
  // Main view mode
  mainView: 'network' | 'flow';
  // Dark mode preference
  darkMode: boolean;

  // Actions
  setActiveBottomTab: (tab: string) => void;
  togglePanel: (panelId: PanelId) => void;
  showPanel: (panelId: PanelId) => void;
  hidePanel: (panelId: PanelId) => void;
  setPanelSize: (panelId: PanelId, size: number) => void;
  toggleCollapse: (panelId: PanelId) => void;
  setMainView: (view: 'network' | 'flow') => void;
  setDarkMode: (dark: boolean) => void;
  resetLayout: () => void;
}

const defaultPanelLayout: Pick<PanelLayoutState, 'activeBottomTab' | 'visiblePanels' | 'panelSizes' | 'collapsedPanels' | 'mainView' | 'darkMode'> = {
  activeBottomTab: 'Network',
  visiblePanels: new Set(['console', 'issues', 'timeline', 'inspector'] as PanelId[]),
  panelSizes: {
    console: 100,
    issues: 100,
    timeline: 100,
    runs: 100,
    network: 100,
    graph: 100,
    inspector: 320,
  },
  collapsedPanels: new Set<PanelId>(),
  mainView: 'network',
  darkMode: false,
};

export const usePanelLayoutStore = create<PanelLayoutState>()(
  devtools(
    persist(
      (set, _get) => ({
        ...defaultPanelLayout,

        setActiveBottomTab: (tab: string) => set({ activeBottomTab: tab }),

        togglePanel: (panelId: PanelId) =>
          set((state) => {
            const next = new Set(state.visiblePanels);
            if (next.has(panelId)) {
              next.delete(panelId);
            } else {
              next.add(panelId);
            }
            return { visiblePanels: next };
          }),

        showPanel: (panelId: PanelId) =>
          set((state) => {
            const next = new Set(state.visiblePanels);
            next.add(panelId);
            return { visiblePanels: next };
          }),

        hidePanel: (panelId: PanelId) =>
          set((state) => {
            const next = new Set(state.visiblePanels);
            next.delete(panelId);
            return { visiblePanels: next };
          }),

        setPanelSize: (panelId: PanelId, size: number) =>
          set((state) => ({
            panelSizes: { ...state.panelSizes, [panelId]: size },
          })),

        toggleCollapse: (panelId: PanelId) =>
          set((state) => {
            const next = new Set(state.collapsedPanels);
            if (next.has(panelId)) {
              next.delete(panelId);
            } else {
              next.add(panelId);
            }
            return { collapsedPanels: next };
          }),

        setMainView: (view: 'network' | 'flow') => set({ mainView: view }),

        setDarkMode: (dark: boolean) => set({ darkMode: dark }),

        resetLayout: () => set(defaultPanelLayout),
      }),
      {
        name: 'mentatlab-panel-layout',
        // Serialize Sets to arrays for localStorage
        partialize: (state) => ({
          activeBottomTab: state.activeBottomTab,
          visiblePanels: Array.from(state.visiblePanels),
          panelSizes: state.panelSizes,
          collapsedPanels: Array.from(state.collapsedPanels),
          mainView: state.mainView,
          darkMode: state.darkMode,
        }),
        // Deserialize arrays back to Sets
        onRehydrateStorage: () => (state) => {
          if (state) {
            // Convert arrays back to Sets if needed
            if (Array.isArray(state.visiblePanels)) {
              state.visiblePanels = new Set(state.visiblePanels as unknown as PanelId[]);
            }
            if (Array.isArray(state.collapsedPanels)) {
              state.collapsedPanels = new Set(state.collapsedPanels as unknown as PanelId[]);
            }
          }
        },
      }
    )
  )
);
