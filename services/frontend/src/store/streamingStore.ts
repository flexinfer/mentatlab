import { create } from 'zustand';

interface DataPoint {
  value: number;
  timestamp: string;
}

interface ConsoleMessage {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: string;
}

interface Stream {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'stopped' | 'error';
  data: DataPoint[];
  console: ConsoleMessage[];
}

interface StreamingStore {
  // State
  activeStreamId: string | null;
  streams: Record<string, Stream>;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
  
  // Actions
  setActiveStreamId: (id: string | null) => void;
  addStream: (stream: Stream) => void;
  updateStreamStatus: (status: any) => void;
  addDataPoint: (data: DataPoint) => void;
  addConsoleMessage: (message: ConsoleMessage) => void;
  setConnectionStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'error') => void;
}

export const useStreamingStore = create<StreamingStore>((set) => ({
  // Initial state
  activeStreamId: null,
  streams: {},
  connectionStatus: 'disconnected',
  
  // Actions
  setActiveStreamId: (id) => {
    console.log('[Store] Setting active stream ID:', id);
    set({ activeStreamId: id });
  },
  
  addStream: (stream) => {
    console.log('[Store] Adding stream:', stream);
    set((state) => ({
      streams: { ...state.streams, [stream.id]: stream }
    }));
  },
  
  updateStreamStatus: (status) => set((state) => {
    console.log('[Store] Updating stream status:', status, 'for stream:', state.activeStreamId);
    if (!state.activeStreamId) {
      console.warn('[Store] No active stream ID to update status');
      return state;
    }
    return {
      streams: {
        ...state.streams,
        [state.activeStreamId]: {
          ...state.streams[state.activeStreamId],
          status
        }
      }
    };
  }),
  
  addDataPoint: (data) => set((state) => {
    console.log('[Store] Adding data point:', data, 'to stream:', state.activeStreamId);
    if (!state.activeStreamId) {
      console.warn('[Store] No active stream ID to add data point');
      return state;
    }
    const stream = state.streams[state.activeStreamId];
    if (!stream) {
      console.warn('[Store] Stream not found:', state.activeStreamId);
      // Create stream if it doesn't exist
      const newStream = {
        id: state.activeStreamId,
        name: `Stream ${state.activeStreamId}`,
        status: 'active' as const,
        data: [data],
        console: []
      };
      return {
        streams: {
          ...state.streams,
          [state.activeStreamId]: newStream
        }
      };
    }
    
    return {
      streams: {
        ...state.streams,
        [state.activeStreamId]: {
          ...stream,
          data: [...(stream.data || []), data].slice(-100) // Keep last 100 points
        }
      }
    };
  }),
  
  addConsoleMessage: (message) => set((state) => {
    console.log('[Store] Adding console message:', message, 'to stream:', state.activeStreamId);
    if (!state.activeStreamId) {
      console.warn('[Store] No active stream ID to add console message');
      return state;
    }
    const stream = state.streams[state.activeStreamId];
    if (!stream) {
      console.warn('[Store] Stream not found:', state.activeStreamId);
      // Create stream if it doesn't exist
      const newStream = {
        id: state.activeStreamId,
        name: `Stream ${state.activeStreamId}`,
        status: 'active' as const,
        data: [],
        console: [message]
      };
      return {
        streams: {
          ...state.streams,
          [state.activeStreamId]: newStream
        }
      };
    }
    
    return {
      streams: {
        ...state.streams,
        [state.activeStreamId]: {
          ...stream,
          console: [...(stream.console || []), message].slice(-500) // Keep last 500 messages
        }
      }
    };
  }),
  
  setConnectionStatus: (status) => {
    console.log('[Store] Setting connection status:', status);
    set({ connectionStatus: status });
  },
}));