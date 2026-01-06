/**
 * Store Index - Re-exports for backwards compatibility
 *
 * @deprecated Import from '@/stores' instead.
 * This file re-exports from the new consolidated stores for migration purposes.
 *
 * Migration guide:
 *   OLD: import { useFlowStore } from '../store/index';
 *   NEW: import { useFlowStore } from '@/stores';
 */

// Re-export all stores from new location
export {
  // Canvas (replaces useReactFlowStore and default useStore)
  useCanvasStore,
  useCanvasStore as useReactFlowStore,
  selectNodes,
  selectEdges,
  selectSelectedNodeId,
  selectSelectedNodes,
  selectNodeById,
  type CanvasState,

  // Streaming
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

  // Flow
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

  // Layout (replaces usePanelLayoutStore)
  useLayoutStore,
  useLayoutStore as usePanelLayoutStore,
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

  // Sync
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

  // Utilities
  resetAllStores,
  getStoreSnapshot,
} from '../stores';

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Media Store (kept for backwards compatibility)
// TODO: Move to new stores/media/index.ts
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import { v4 as uuidv4 } from 'uuid';
import type { MediaReference } from '../types/media';
import type { FileUploadState, UploadProgress } from '../components/multimodal/FileUploader/FileUploader.types';

// Enable Map/Set support
try { enableMapSet(); } catch { /* already enabled */ }

interface MediaState {
  mediaItems: Map<string, MediaReference>;
  uploadQueue: FileUploadState[];
  activeUploads: Map<string, unknown>;
  uploadProgress: Map<string, number>;
  processingStates: Map<string, UploadProgress['status']>;
  cacheSize: number;
  maxCacheSize: number;

  queueUpload: (file: File, metadata: unknown) => void;
  addToUploadQueue: (uploadFile: FileUploadState) => void;
  removeFromUploadQueue: (id: string) => void;
  setUploadProgress: (id: string, progress: number) => void;
  setProcessingState: (id: string, state: UploadProgress['status']) => void;
  addMediaItem: (item: MediaReference) => void;
  removeMediaItem: (id: string) => void;
  evictOldestItems: (targetSize: number) => void;
  clearCache: () => void;
  getCacheInfo: () => { size: number; maxSize: number; itemCount: number };
}

export const useMediaStore = create<MediaState>()(
  devtools(
    immer((set, get) => ({
      // Initial state
      mediaItems: new Map(),
      uploadQueue: [],
      activeUploads: new Map(),
      uploadProgress: new Map(),
      processingStates: new Map(),
      cacheSize: 0,
      maxCacheSize: 100 * 1024 * 1024, // 100MB default

      // Actions
      queueUpload: (file: File, metadata: unknown) => {
        const newUploadFile: FileUploadState = {
          id: uuidv4(),
          file,
          status: 'queued',
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
            const file = state.uploadQueue[fileIndex];
            if (file) {
              file.progress = Math.max(0, Math.min(100, progress));
            }
          }
          state.uploadProgress.set(id, Math.max(0, Math.min(100, progress)));
        }),

      setProcessingState: (id: string, status: UploadProgress['status']) =>
        set((state) => {
          const fileIndex = state.uploadQueue.findIndex((file: FileUploadState) => file.id === id);
          if (fileIndex !== -1) {
            const file = state.uploadQueue[fileIndex];
            if (file) {
              file.status = status;
            }
          }
          state.processingStates.set(id, status);
        }),

      addMediaItem: (item: MediaReference) =>
        set((state) => {
          state.mediaItems.set(item.refId, item);
          const size = item.metadata?.size ?? 0;
          state.cacheSize += size;

          // Auto-evict if cache size exceeds limit
          if (state.cacheSize > state.maxCacheSize) {
            const targetSize = state.maxCacheSize * 0.8;
            get().evictOldestItems(targetSize);
          }
        }),

      removeMediaItem: (id: string) =>
        set((state) => {
          const item = state.mediaItems.get(id);
          if (item) {
            const size = item.metadata?.size ?? 0;
            state.mediaItems.delete(id);
            state.cacheSize -= size;
          }
        }),

      evictOldestItems: (targetSize: number) => {
        const currentCacheSize = get().cacheSize;
        if (currentCacheSize <= targetSize) return;

        set((draft: MediaState) => {
          const sortedMediaReferences = Array.from(draft.mediaItems.values()).sort(
            (a: MediaReference, b: MediaReference) => {
              const aCreatedAt = a.metadata?.createdAt ? new Date(a.metadata.createdAt).getTime() : 0;
              const bCreatedAt = b.metadata?.createdAt ? new Date(b.metadata.createdAt).getTime() : 0;
              return aCreatedAt - bCreatedAt;
            }
          );

          for (const item of sortedMediaReferences) {
            if (draft.cacheSize <= targetSize) break;
            const size = item.metadata?.size ?? 0;
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
          itemCount: state.mediaItems.size,
        };
      },
    })),
    { name: 'media-store' }
  )
);

// Export MediaState type for backwards compatibility
export type { MediaState };
