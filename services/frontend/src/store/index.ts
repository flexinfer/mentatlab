// stores/index.ts
import { create } from 'zustand';
import { devtools, persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { v4 as uuid } from 'uuid'; // Assuming uuid is needed for useMediaStore
import { StreamConnectionState, StreamingMessage, ErrorMessage } from '../types/streaming'; // Import StreamConnectionState, StreamingMessage, and ErrorMessage
import { MediaReference } from '../types/media'; // Assuming MediaReference is defined here

interface FlowState {
  flows: Map<string, any>; // Placeholder, replace with actual Flow type
  activeFlowId: string | null;
  updateFlow: (flowId: string, updates: any) => void;
}

interface MediaState {
  mediaItems: Map<string, MediaReference>;
  uploadQueue: Array<{ file: File; metadata: any; id: string }>;
  activeUploads: Map<string, any>; // Placeholder for active uploads
  queueUpload: (file: File, metadata: any) => void;
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

// Core stores
export const useFlowStore = create<FlowState>()(
  devtools(
    persist(
      subscribeWithSelector(
        immer((set, get) => ({
          // Flow state
          flows: new Map(),
          activeFlowId: null,
          
          // Actions
          updateFlow: (flowId: string, updates: any) =>
            set((state: any) => {
              state.flows.get(flowId).merge(updates);
            }),
        }))
      ),
      { name: 'flow-store' }
    )
  )
);

export const useMediaStore = create<MediaState>()(
  devtools(
    immer((set) => ({
      // Media references
      mediaItems: new Map(),
      uploadQueue: [],
      activeUploads: new Map(),
      
      // Actions
      queueUpload: (file: File, metadata: any) =>
        set((state: any) => {
          state.uploadQueue.push({ file, metadata, id: uuid() });
        }),
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