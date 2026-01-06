/**
 * Streaming Store - Unified streaming state management with event batching
 *
 * This store consolidates all streaming-related state:
 * - Active streams and their status
 * - Event buffering with 50ms batch flush
 * - Connection status
 * - Stream messages and errors
 *
 * The event batching reduces re-renders by collecting events over a 50ms window
 * and flushing them in a single state update.
 */

import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import type { StreamConnectionState, StreamingMessage, ErrorMessage } from '@/types/streaming';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StreamSession {
  id: string;
  runId?: string;
  config?: Record<string, unknown>;
  status: StreamConnectionState;
  messages: StreamingMessage[];
  errors: ErrorMessage[];
  createdAt: number;
  lastEventAt?: number;
}

export interface DataPoint {
  value: number;
  timestamp: string;
  nodeId?: string;
  label?: string;
}

export interface ConsoleMessage {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: string;
  nodeId?: string;
  source?: string;
}

// Legacy stream shape for backwards compatibility
export interface LegacyStream {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'stopped' | 'error';
  data: DataPoint[];
  console: ConsoleMessage[];
}

// Legacy session shape (for backwards compatibility with old API)
export interface LegacyStreamSession {
  id: string;
  config: Record<string, unknown>;
  status: StreamConnectionState;
  buffer: StreamingMessage[];
  errors: ErrorMessage[];
}

export interface StreamingState {
  // Session-based streaming (recommended)
  sessions: Map<string, StreamSession>;
  activeSessionId: string | null;

  // Legacy stream-based state (for backwards compatibility)
  streams: Record<string, LegacyStream>;
  activeStreamId: string | null;

  // Legacy activeStreams alias (maps to sessions)
  activeStreams: Map<string, LegacyStreamSession>;

  // Global connection status
  connectionStatus: StreamConnectionState;

  // Event batching
  eventBuffer: StreamingMessage[];
  flushScheduled: boolean;

  // Session actions
  createSession: (sessionId: string, runId?: string, config?: Record<string, unknown>) => void;
  closeSession: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  updateSessionStatus: (sessionId: string, status: StreamConnectionState) => void;
  addSessionMessage: (sessionId: string, message: StreamingMessage) => void;
  addSessionError: (sessionId: string, error: ErrorMessage) => void;
  clearSessionMessages: (sessionId: string) => void;

  // Legacy session actions (for backwards compatibility with old API)
  registerStream: (streamId: string, config: Record<string, unknown>) => void;
  addStreamMessage: (streamId: string, message: StreamingMessage) => void;
  addStreamError: (streamId: string, error: ErrorMessage) => void;

  // Legacy actions (for backwards compatibility)
  setActiveStreamId: (id: string | null) => void;
  addStream: (stream: LegacyStream) => void;
  updateStreamStatus: (streamIdOrStatus: string | LegacyStream['status'], status?: StreamConnectionState | LegacyStream['status']) => void;
  addDataPoint: (data: DataPoint) => void;
  addConsoleMessage: (message: ConsoleMessage) => void;

  // Connection management
  setConnectionStatus: (status: StreamConnectionState) => void;

  // Event batching
  pushEvent: (event: StreamingMessage) => void;
  flushEvents: () => void;

  // Cleanup
  cleanupOldSessions: (maxAge: number) => void;
  clearAll: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_MESSAGES_PER_SESSION = 1000;
const MAX_ERRORS_PER_SESSION = 100;
const MAX_DATA_POINTS = 100;
const MAX_CONSOLE_MESSAGES = 500;
const MAX_SESSIONS = 50;
const BATCH_FLUSH_INTERVAL_MS = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

// Flush timeout reference (outside store to avoid serialization issues)
let flushTimeoutId: ReturnType<typeof setTimeout> | null = null;

export const useStreamingStore = create<StreamingState>()(
  devtools(
    subscribeWithSelector((set, get) => ({
      // Initial state
      sessions: new Map(),
      activeSessionId: null,
      streams: {},
      activeStreamId: null,
      activeStreams: new Map(), // Legacy alias for sessions
      connectionStatus: 'disconnected' as StreamConnectionState,
      eventBuffer: [],
      flushScheduled: false,

      // ─────────────────────────────────────────────────────────────────────
      // Session-based streaming (recommended)
      // ─────────────────────────────────────────────────────────────────────

      createSession: (sessionId: string, runId?: string, config?: Record<string, unknown>) => {
        const sessions = new Map(get().sessions);

        // Auto-cleanup: limit to MAX_SESSIONS, remove oldest if exceeded
        if (sessions.size >= MAX_SESSIONS) {
          const sortedEntries = Array.from(sessions.entries()).sort(
            ([, a], [, b]) => a.createdAt - b.createdAt
          );
          const toRemove = sortedEntries.slice(0, sessions.size - MAX_SESSIONS + 1);
          toRemove.forEach(([key]) => sessions.delete(key));
        }

        sessions.set(sessionId, {
          id: sessionId,
          runId,
          config,
          status: 'connecting' as StreamConnectionState,
          messages: [],
          errors: [],
          createdAt: Date.now(),
        });

        set({ sessions, activeSessionId: sessionId });
      },

      closeSession: (sessionId: string) => {
        const sessions = new Map(get().sessions);
        const session = sessions.get(sessionId);
        if (session) {
          sessions.set(sessionId, { ...session, status: 'disconnected' as StreamConnectionState });
        }
        const activeSessionId =
          get().activeSessionId === sessionId ? null : get().activeSessionId;
        set({ sessions, activeSessionId });
      },

      setActiveSession: (sessionId: string | null) => {
        set({ activeSessionId: sessionId });
      },

      updateSessionStatus: (sessionId: string, status: StreamConnectionState) => {
        const sessions = new Map(get().sessions);
        const session = sessions.get(sessionId);
        if (session) {
          sessions.set(sessionId, { ...session, status, lastEventAt: Date.now() });
          set({ sessions });
        }
      },

      addSessionMessage: (sessionId: string, message: StreamingMessage) => {
        const sessions = new Map(get().sessions);
        const session = sessions.get(sessionId);
        if (session) {
          const messages =
            session.messages.length >= MAX_MESSAGES_PER_SESSION
              ? [...session.messages.slice(-(MAX_MESSAGES_PER_SESSION - 1)), message]
              : [...session.messages, message];
          sessions.set(sessionId, { ...session, messages, lastEventAt: Date.now() });
          set({ sessions });
        }
      },

      addSessionError: (sessionId: string, error: ErrorMessage) => {
        const sessions = new Map(get().sessions);
        const session = sessions.get(sessionId);
        if (session) {
          const errors =
            session.errors.length >= MAX_ERRORS_PER_SESSION
              ? [...session.errors.slice(-(MAX_ERRORS_PER_SESSION - 1)), error]
              : [...session.errors, error];
          sessions.set(sessionId, { ...session, errors, lastEventAt: Date.now() });
          set({ sessions });
        }
      },

      clearSessionMessages: (sessionId: string) => {
        const sessions = new Map(get().sessions);
        const session = sessions.get(sessionId);
        if (session) {
          sessions.set(sessionId, { ...session, messages: [], errors: [] });
          set({ sessions });
        }
      },

      // ─────────────────────────────────────────────────────────────────────
      // Legacy session API (backwards compatibility with old StreamingState)
      // Maps to session-based API under the hood
      // ─────────────────────────────────────────────────────────────────────

      registerStream: (streamId: string, config: Record<string, unknown>) => {
        // Create session
        get().createSession(streamId, undefined, config);

        // Also update legacy activeStreams map
        const sessions = get().sessions;
        const activeStreams = new Map<string, LegacyStreamSession>();
        sessions.forEach((session, id) => {
          activeStreams.set(id, {
            id: session.id,
            config: session.config ?? {},
            status: session.status,
            buffer: session.messages,
            errors: session.errors,
          });
        });
        set({ activeStreams });
      },

      addStreamMessage: (streamId: string, message: StreamingMessage) => {
        get().addSessionMessage(streamId, message);

        // Update legacy activeStreams
        const sessions = get().sessions;
        const activeStreams = new Map<string, LegacyStreamSession>();
        sessions.forEach((session, id) => {
          activeStreams.set(id, {
            id: session.id,
            config: session.config ?? {},
            status: session.status,
            buffer: session.messages,
            errors: session.errors,
          });
        });
        set({ activeStreams });
      },

      addStreamError: (streamId: string, error: ErrorMessage) => {
        get().addSessionError(streamId, error);

        // Update legacy activeStreams
        const sessions = get().sessions;
        const activeStreams = new Map<string, LegacyStreamSession>();
        sessions.forEach((session, id) => {
          activeStreams.set(id, {
            id: session.id,
            config: session.config ?? {},
            status: session.status,
            buffer: session.messages,
            errors: session.errors,
          });
        });
        set({ activeStreams });
      },

      // ─────────────────────────────────────────────────────────────────────
      // Legacy stream-based state (backwards compatibility)
      // ─────────────────────────────────────────────────────────────────────

      setActiveStreamId: (id: string | null) => {
        set({ activeStreamId: id });
      },

      addStream: (stream: LegacyStream) => {
        set((state) => ({
          streams: { ...state.streams, [stream.id]: stream },
        }));
      },

      updateStreamStatus: (streamIdOrStatus: string | LegacyStream['status'], status?: StreamConnectionState | LegacyStream['status']) => {
        // Detect which API is being used:
        // New API: updateStreamStatus(streamId, status) - streamId is a string that looks like an ID
        // Old API: updateStreamStatus(status) - status is one of 'active', 'paused', 'stopped', 'error'
        const legacyStatuses = ['active', 'paused', 'stopped', 'error', 'disconnected', 'connecting', 'connected', 'reconnecting'];
        const isLegacyCall = typeof streamIdOrStatus === 'string' && legacyStatuses.includes(streamIdOrStatus) && status === undefined;

        if (isLegacyCall) {
          // Legacy behavior: update active stream with single status argument
          const { activeStreamId, streams } = get();
          if (!activeStreamId) return;

          const stream = streams[activeStreamId];
          if (!stream) return;

          set({
            streams: {
              ...streams,
              [activeStreamId]: { ...stream, status: streamIdOrStatus as LegacyStream['status'] },
            },
          });
          return;
        }

        // New API: updateStreamStatus(streamId, status)
        if (typeof streamIdOrStatus === 'string' && status !== undefined) {
          const streamId = streamIdOrStatus;
          get().updateSessionStatus(streamId, status as StreamConnectionState);

          // Update legacy activeStreams
          const sessions = get().sessions;
          const activeStreams = new Map<string, LegacyStreamSession>();
          sessions.forEach((session, id) => {
            activeStreams.set(id, {
              id: session.id,
              config: session.config ?? {},
              status: session.status,
              buffer: session.messages,
              errors: session.errors,
            });
          });
          set({ activeStreams });
        }
      },

      addDataPoint: (data: DataPoint) => {
        const { activeStreamId, streams } = get();
        if (!activeStreamId) return;

        const stream = streams[activeStreamId];
        if (!stream) {
          // Auto-create stream
          set({
            streams: {
              ...streams,
              [activeStreamId]: {
                id: activeStreamId,
                name: `Stream ${activeStreamId}`,
                status: 'active',
                data: [data],
                console: [],
              },
            },
          });
          return;
        }

        set({
          streams: {
            ...streams,
            [activeStreamId]: {
              ...stream,
              data: [...stream.data, data].slice(-MAX_DATA_POINTS),
            },
          },
        });
      },

      addConsoleMessage: (message: ConsoleMessage) => {
        const { activeStreamId, streams } = get();
        if (!activeStreamId) return;

        const stream = streams[activeStreamId];
        if (!stream) {
          // Auto-create stream
          set({
            streams: {
              ...streams,
              [activeStreamId]: {
                id: activeStreamId,
                name: `Stream ${activeStreamId}`,
                status: 'active',
                data: [],
                console: [message],
              },
            },
          });
          return;
        }

        set({
          streams: {
            ...streams,
            [activeStreamId]: {
              ...stream,
              console: [...stream.console, message].slice(-MAX_CONSOLE_MESSAGES),
            },
          },
        });
      },

      // ─────────────────────────────────────────────────────────────────────
      // Connection management
      // ─────────────────────────────────────────────────────────────────────

      setConnectionStatus: (status: StreamConnectionState) => {
        set({ connectionStatus: status });
      },

      // ─────────────────────────────────────────────────────────────────────
      // Event batching
      // ─────────────────────────────────────────────────────────────────────

      pushEvent: (event: StreamingMessage) => {
        const state = get();
        const newBuffer = [...state.eventBuffer, event];

        // Schedule flush if not already scheduled
        if (!state.flushScheduled) {
          flushTimeoutId = setTimeout(() => {
            get().flushEvents();
          }, BATCH_FLUSH_INTERVAL_MS);
          set({ eventBuffer: newBuffer, flushScheduled: true });
        } else {
          set({ eventBuffer: newBuffer });
        }
      },

      flushEvents: () => {
        const { eventBuffer, activeSessionId, sessions } = get();
        if (eventBuffer.length === 0) {
          set({ flushScheduled: false });
          return;
        }

        // Clear the timeout
        if (flushTimeoutId) {
          clearTimeout(flushTimeoutId);
          flushTimeoutId = null;
        }

        // Batch add all events to active session
        if (activeSessionId) {
          const session = sessions.get(activeSessionId);
          if (session) {
            const allMessages = [...session.messages, ...eventBuffer];
            const trimmedMessages =
              allMessages.length > MAX_MESSAGES_PER_SESSION
                ? allMessages.slice(-MAX_MESSAGES_PER_SESSION)
                : allMessages;

            const newSessions = new Map(sessions);
            newSessions.set(activeSessionId, {
              ...session,
              messages: trimmedMessages,
              lastEventAt: Date.now(),
            });

            set({
              sessions: newSessions,
              eventBuffer: [],
              flushScheduled: false,
            });
            return;
          }
        }

        // If no active session, just clear the buffer
        set({ eventBuffer: [], flushScheduled: false });
      },

      // ─────────────────────────────────────────────────────────────────────
      // Cleanup
      // ─────────────────────────────────────────────────────────────────────

      cleanupOldSessions: (maxAge: number) => {
        const now = Date.now();
        const sessions = new Map(get().sessions);
        const activeSessionId = get().activeSessionId;

        for (const [id, session] of sessions) {
          // Don't clean up active session
          if (id === activeSessionId) continue;

          // Remove sessions older than maxAge that are disconnected
          if (
            session.status === 'disconnected' &&
            now - session.createdAt > maxAge
          ) {
            sessions.delete(id);
          }
        }

        set({ sessions });
      },

      clearAll: () => {
        if (flushTimeoutId) {
          clearTimeout(flushTimeoutId);
          flushTimeoutId = null;
        }
        set({
          sessions: new Map(),
          activeSessionId: null,
          streams: {},
          activeStreamId: null,
          eventBuffer: [],
          flushScheduled: false,
        });
      },
    })),
    { name: 'streaming-store' }
  )
);

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────────────────────

export const selectActiveSession = (state: StreamingState) => {
  if (!state.activeSessionId) return null;
  return state.sessions.get(state.activeSessionId) ?? null;
};

export const selectSessionById = (sessionId: string) => (state: StreamingState) =>
  state.sessions.get(sessionId) ?? null;

export const selectSessionMessages = (sessionId: string) => (state: StreamingState) =>
  state.sessions.get(sessionId)?.messages ?? [];

export const selectActiveStream = (state: StreamingState) => {
  if (!state.activeStreamId) return null;
  return state.streams[state.activeStreamId] ?? null;
};

export const selectConnectionStatus = (state: StreamingState) => state.connectionStatus;

export default useStreamingStore;
