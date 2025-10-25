// stores/index.ts
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
  devtools(
    immer((set: (fn: (state: StreamingState) => void) => void) => ({ // Explicitly type 'set'
      // Streaming state
      activeStreams: new Map<string, StreamSession>(), // Explicitly type the Map
      connectionStatus: StreamConnectionState.DISCONNECTED, // Use enum member
      
      // Actions
      registerStream: (streamId: string, config: any) => set((state: StreamingState) => {
        const newActiveStreams = new Map(state.activeStreams);
        newActiveStreams.set(streamId, {
          id: streamId,
          config: config,
          status: StreamConnectionState.CONNECTING,
          buffer: [],
          errors: [], // Initialize errors array
        });
        state.activeStreams = newActiveStreams;
      }),
      updateStreamStatus: (streamId: string, status: StreamConnectionState) => set((state: StreamingState) => {
        const stream = state.activeStreams.get(streamId);
        if (stream) {
          state.activeStreams.set(streamId, { ...stream, status: status });
        }
      }),
      addStreamMessage: (streamId: string, message: StreamingMessage) => set((state: StreamingState) => {
        const stream = state.activeStreams.get(streamId);
        if (stream) {
          state.activeStreams.set(streamId, { ...stream, buffer: [...stream.buffer, message] });
        }
      }),
      addStreamError: (streamId: string, error: ErrorMessage) => set((state: StreamingState) => { // New action
        const stream = state.activeStreams.get(streamId);
        if (stream) {
          state.activeStreams.set(streamId, { ...stream, errors: [...stream.errors, error] });
        }
      }),
      setConnectionStatus: (status: StreamConnectionState) => set((state) => {
        state.connectionStatus = status;
      }),
    }))
  )
);