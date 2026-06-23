import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useStreamingStore,
  selectActiveSession,
  selectSessionById,
  selectSessionMessages,
  selectActiveStream,
  selectConnectionStatus,
  type StreamingState,
  type StreamSession,
  type LegacyStream,
} from '../index';
import type { StreamingMessage, ErrorMessage, StreamConnectionState } from '@/types/streaming';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getState(): StreamingState {
  return useStreamingStore.getState();
}

function makeMessage(overrides: Partial<StreamingMessage> = {}): StreamingMessage {
  return {
    type: 'stream_data',
    timestamp: new Date().toISOString(),
    agent_id: 'agent-1',
    stream_id: 'stream-1',
    data: { value: 42 },
    ...overrides,
  } as StreamingMessage;
}

function makeError(overrides: Partial<ErrorMessage> = {}): ErrorMessage {
  return {
    type: 'error',
    timestamp: new Date().toISOString(),
    agent_id: 'agent-1',
    stream_id: 'stream-1',
    code: 'TEST_ERROR',
    message: 'Test error',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers();
  act(() => {
    getState().clearAll();
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Initial State
// ============================================================================

describe('Streaming Store - initial state', () => {
  it('starts with empty sessions', () => {
    expect(getState().sessions).toBeInstanceOf(Map);
    expect(getState().sessions.size).toBe(0);
  });

  it('starts with null activeSessionId', () => {
    expect(getState().activeSessionId).toBeNull();
  });

  it('starts with disconnected connectionStatus', () => {
    expect(getState().connectionStatus).toBe('disconnected');
  });

  it('starts with empty eventBuffer', () => {
    expect(getState().eventBuffer).toEqual([]);
  });

  it('starts with flushScheduled = false', () => {
    expect(getState().flushScheduled).toBe(false);
  });

  it('starts with empty legacy streams', () => {
    expect(getState().streams).toEqual({});
    expect(getState().activeStreamId).toBeNull();
  });
});

// ============================================================================
// Session Management
// ============================================================================

describe('Streaming Store - createSession', () => {
  it('creates a session and sets it as active', () => {
    act(() => {
      getState().createSession('session-1', 'run-1');
    });

    expect(getState().sessions.size).toBe(1);
    expect(getState().activeSessionId).toBe('session-1');

    const session = getState().sessions.get('session-1')!;
    expect(session.id).toBe('session-1');
    expect(session.runId).toBe('run-1');
    expect(session.status).toBe('connecting');
    expect(session.messages).toEqual([]);
    expect(session.errors).toEqual([]);
  });

  it('creates a session with config', () => {
    act(() => {
      getState().createSession('s-1', undefined, { timeout: 5000 });
    });
    expect(getState().sessions.get('s-1')!.config).toEqual({ timeout: 5000 });
  });

  it('auto-cleans oldest sessions when exceeding 50', () => {
    // Create 50 sessions
    for (let i = 0; i < 50; i++) {
      act(() => {
        getState().createSession(`session-${i}`, `run-${i}`);
      });
    }
    expect(getState().sessions.size).toBe(50);

    // Adding one more should cleanup the oldest
    act(() => {
      getState().createSession('session-new', 'run-new');
    });
    expect(getState().sessions.size).toBeLessThanOrEqual(50);
    expect(getState().sessions.has('session-new')).toBe(true);
  });
});

describe('Streaming Store - closeSession', () => {
  it('marks session as disconnected', () => {
    act(() => {
      getState().createSession('s-1');
    });
    act(() => {
      getState().closeSession('s-1');
    });
    expect(getState().sessions.get('s-1')!.status).toBe('disconnected');
  });

  it('clears activeSessionId when closing the active session', () => {
    act(() => {
      getState().createSession('s-1');
    });
    expect(getState().activeSessionId).toBe('s-1');

    act(() => {
      getState().closeSession('s-1');
    });
    expect(getState().activeSessionId).toBeNull();
  });

  it('keeps activeSessionId when closing a non-active session', () => {
    act(() => {
      getState().createSession('s-1');
      getState().createSession('s-2');
    });
    expect(getState().activeSessionId).toBe('s-2');

    act(() => {
      getState().closeSession('s-1');
    });
    expect(getState().activeSessionId).toBe('s-2');
  });
});

describe('Streaming Store - setActiveSession', () => {
  it('sets the active session ID', () => {
    act(() => {
      getState().createSession('s-1');
      getState().createSession('s-2');
    });

    act(() => {
      getState().setActiveSession('s-1');
    });
    expect(getState().activeSessionId).toBe('s-1');
  });

  it('sets active to null', () => {
    act(() => {
      getState().createSession('s-1');
    });
    act(() => {
      getState().setActiveSession(null);
    });
    expect(getState().activeSessionId).toBeNull();
  });
});

describe('Streaming Store - updateSessionStatus', () => {
  it('updates session status', () => {
    act(() => {
      getState().createSession('s-1');
    });
    act(() => {
      getState().updateSessionStatus('s-1', 'connected' as StreamConnectionState);
    });
    expect(getState().sessions.get('s-1')!.status).toBe('connected');
  });

  it('sets lastEventAt on status update', () => {
    act(() => {
      getState().createSession('s-1');
    });
    act(() => {
      getState().updateSessionStatus('s-1', 'connected' as StreamConnectionState);
    });
    expect(getState().sessions.get('s-1')!.lastEventAt).toBeDefined();
  });

  it('does nothing for non-existent session', () => {
    act(() => {
      getState().updateSessionStatus('non-existent', 'connected' as StreamConnectionState);
    });
    expect(getState().sessions.size).toBe(0);
  });
});

// ============================================================================
// Session Messages
// ============================================================================

describe('Streaming Store - addSessionMessage', () => {
  it('adds a message to the session', () => {
    act(() => {
      getState().createSession('s-1');
    });
    const msg = makeMessage();
    act(() => {
      getState().addSessionMessage('s-1', msg);
    });
    expect(getState().sessions.get('s-1')!.messages).toHaveLength(1);
  });

  it('caps messages at 1000', () => {
    act(() => {
      getState().createSession('s-1');
    });

    // Add 1001 messages
    act(() => {
      for (let i = 0; i < 1001; i++) {
        getState().addSessionMessage('s-1', makeMessage());
      }
    });

    expect(getState().sessions.get('s-1')!.messages.length).toBeLessThanOrEqual(1000);
  });

  it('does nothing for non-existent session', () => {
    act(() => {
      getState().addSessionMessage('non-existent', makeMessage());
    });
    expect(getState().sessions.size).toBe(0);
  });
});

describe('Streaming Store - addSessionError', () => {
  it('adds an error to the session', () => {
    act(() => {
      getState().createSession('s-1');
    });
    act(() => {
      getState().addSessionError('s-1', makeError());
    });
    expect(getState().sessions.get('s-1')!.errors).toHaveLength(1);
  });

  it('caps errors at 100', () => {
    act(() => {
      getState().createSession('s-1');
    });
    act(() => {
      for (let i = 0; i < 101; i++) {
        getState().addSessionError('s-1', makeError());
      }
    });
    expect(getState().sessions.get('s-1')!.errors.length).toBeLessThanOrEqual(100);
  });
});

describe('Streaming Store - clearSessionMessages', () => {
  it('clears both messages and errors', () => {
    act(() => {
      getState().createSession('s-1');
    });
    act(() => {
      getState().addSessionMessage('s-1', makeMessage());
      getState().addSessionError('s-1', makeError());
    });
    act(() => {
      getState().clearSessionMessages('s-1');
    });
    expect(getState().sessions.get('s-1')!.messages).toEqual([]);
    expect(getState().sessions.get('s-1')!.errors).toEqual([]);
  });
});

// ============================================================================
// Legacy Stream API
// ============================================================================

describe('Streaming Store - legacy stream operations', () => {
  it('addStream adds a legacy stream', () => {
    const stream: LegacyStream = {
      id: 'ls-1',
      name: 'Test Stream',
      status: 'active',
      data: [],
      console: [],
    };
    act(() => {
      getState().addStream(stream);
    });
    expect(getState().streams['ls-1']).toBeDefined();
    expect(getState().streams['ls-1'].name).toBe('Test Stream');
  });

  it('setActiveStreamId sets the legacy active stream', () => {
    act(() => {
      getState().setActiveStreamId('ls-1');
    });
    expect(getState().activeStreamId).toBe('ls-1');
  });

  it('addDataPoint adds data to the active stream', () => {
    const stream: LegacyStream = {
      id: 'ls-1',
      name: 'Data Stream',
      status: 'active',
      data: [],
      console: [],
    };
    act(() => {
      getState().addStream(stream);
      getState().setActiveStreamId('ls-1');
    });

    act(() => {
      getState().addDataPoint({ value: 42, timestamp: '2024-01-01' });
    });
    expect(getState().streams['ls-1'].data).toHaveLength(1);
    expect(getState().streams['ls-1'].data[0].value).toBe(42);
  });

  it('addDataPoint auto-creates stream if missing', () => {
    act(() => {
      getState().setActiveStreamId('auto-ls');
    });
    act(() => {
      getState().addDataPoint({ value: 1, timestamp: '2024-01-01' });
    });
    expect(getState().streams['auto-ls']).toBeDefined();
    expect(getState().streams['auto-ls'].data).toHaveLength(1);
  });

  it('addDataPoint caps at 100 data points', () => {
    const stream: LegacyStream = {
      id: 'ls-1',
      name: 'Big Data',
      status: 'active',
      data: [],
      console: [],
    };
    act(() => {
      getState().addStream(stream);
      getState().setActiveStreamId('ls-1');
    });

    act(() => {
      for (let i = 0; i < 150; i++) {
        getState().addDataPoint({ value: i, timestamp: `t-${i}` });
      }
    });
    expect(getState().streams['ls-1'].data.length).toBeLessThanOrEqual(100);
  });

  it('addDataPoint does nothing without activeStreamId', () => {
    act(() => {
      getState().addDataPoint({ value: 1, timestamp: 't' });
    });
    expect(Object.keys(getState().streams)).toHaveLength(0);
  });

  it('addConsoleMessage adds to the active stream', () => {
    const stream: LegacyStream = {
      id: 'ls-1',
      name: 'Console Stream',
      status: 'active',
      data: [],
      console: [],
    };
    act(() => {
      getState().addStream(stream);
      getState().setActiveStreamId('ls-1');
    });

    act(() => {
      getState().addConsoleMessage({ level: 'info', message: 'hello', timestamp: 't' });
    });
    expect(getState().streams['ls-1'].console).toHaveLength(1);
  });

  it('addConsoleMessage auto-creates stream if missing', () => {
    act(() => {
      getState().setActiveStreamId('auto-console');
    });
    act(() => {
      getState().addConsoleMessage({ level: 'warn', message: 'warning', timestamp: 't' });
    });
    expect(getState().streams['auto-console']).toBeDefined();
  });

  it('addConsoleMessage caps at 500 messages', () => {
    const stream: LegacyStream = {
      id: 'ls-1',
      name: 'Chatty',
      status: 'active',
      data: [],
      console: [],
    };
    act(() => {
      getState().addStream(stream);
      getState().setActiveStreamId('ls-1');
    });

    act(() => {
      for (let i = 0; i < 600; i++) {
        getState().addConsoleMessage({ level: 'debug', message: `msg-${i}`, timestamp: `t-${i}` });
      }
    });
    expect(getState().streams['ls-1'].console.length).toBeLessThanOrEqual(500);
  });
});

// ============================================================================
// Legacy Session API (backwards compatibility)
// ============================================================================

describe('Streaming Store - registerStream (legacy)', () => {
  it('creates a session and populates legacy activeStreams', () => {
    act(() => {
      getState().registerStream('rs-1', { key: 'value' });
    });

    expect(getState().sessions.has('rs-1')).toBe(true);
    expect(getState().activeStreams.has('rs-1')).toBe(true);
    expect(getState().activeStreams.get('rs-1')!.config).toEqual({ key: 'value' });
  });
});

describe('Streaming Store - addStreamMessage (legacy)', () => {
  it('adds message to session and updates activeStreams', () => {
    act(() => {
      getState().registerStream('rs-1', {});
    });

    const msg = makeMessage();
    act(() => {
      getState().addStreamMessage('rs-1', msg);
    });

    expect(getState().sessions.get('rs-1')!.messages).toHaveLength(1);
    expect(getState().activeStreams.get('rs-1')!.buffer).toHaveLength(1);
  });
});

describe('Streaming Store - addStreamError (legacy)', () => {
  it('adds error to session and updates activeStreams', () => {
    act(() => {
      getState().registerStream('rs-1', {});
    });

    act(() => {
      getState().addStreamError('rs-1', makeError());
    });

    expect(getState().sessions.get('rs-1')!.errors).toHaveLength(1);
    expect(getState().activeStreams.get('rs-1')!.errors).toHaveLength(1);
  });
});

// ============================================================================
// Connection Management
// ============================================================================

describe('Streaming Store - setConnectionStatus', () => {
  it('updates the global connection status', () => {
    act(() => {
      getState().setConnectionStatus('connected' as StreamConnectionState);
    });
    expect(getState().connectionStatus).toBe('connected');
  });

  it('transitions through states', () => {
    const states: StreamConnectionState[] = ['connecting', 'connected', 'reconnecting', 'disconnected'];
    for (const s of states) {
      act(() => {
        getState().setConnectionStatus(s);
      });
      expect(getState().connectionStatus).toBe(s);
    }
  });
});

// ============================================================================
// Event Batching
// ============================================================================

describe('Streaming Store - event batching', () => {
  it('pushEvent adds to the eventBuffer', () => {
    act(() => {
      getState().pushEvent(makeMessage());
    });
    expect(getState().eventBuffer).toHaveLength(1);
  });

  it('pushEvent schedules a flush', () => {
    act(() => {
      getState().pushEvent(makeMessage());
    });
    expect(getState().flushScheduled).toBe(true);
  });

  it('flushEvents moves buffer to active session messages', () => {
    act(() => {
      getState().createSession('s-1');
    });

    const msg = makeMessage();
    act(() => {
      getState().pushEvent(msg);
    });

    act(() => {
      getState().flushEvents();
    });

    expect(getState().eventBuffer).toEqual([]);
    expect(getState().flushScheduled).toBe(false);
    expect(getState().sessions.get('s-1')!.messages).toHaveLength(1);
  });

  it('flushEvents clears buffer when no active session', () => {
    const msg = makeMessage();
    act(() => {
      getState().pushEvent(msg);
    });

    act(() => {
      getState().flushEvents();
    });

    expect(getState().eventBuffer).toEqual([]);
    expect(getState().flushScheduled).toBe(false);
  });

  it('auto-flushes after 50ms timeout', () => {
    act(() => {
      getState().createSession('s-1');
    });

    act(() => {
      getState().pushEvent(makeMessage());
    });

    expect(getState().eventBuffer).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(getState().eventBuffer).toEqual([]);
    expect(getState().sessions.get('s-1')!.messages).toHaveLength(1);
  });

  it('batches multiple events into one flush', () => {
    act(() => {
      getState().createSession('s-1');
    });

    act(() => {
      getState().pushEvent(makeMessage());
      getState().pushEvent(makeMessage());
      getState().pushEvent(makeMessage());
    });

    expect(getState().eventBuffer).toHaveLength(3);

    act(() => {
      getState().flushEvents();
    });

    expect(getState().sessions.get('s-1')!.messages).toHaveLength(3);
  });

  it('flushEvents with empty buffer just resets flag', () => {
    act(() => {
      getState().flushEvents();
    });
    expect(getState().flushScheduled).toBe(false);
    expect(getState().eventBuffer).toEqual([]);
  });
});

// ============================================================================
// Cleanup
// ============================================================================

describe('Streaming Store - cleanupOldSessions', () => {
  it('removes old disconnected sessions', () => {
    act(() => {
      getState().createSession('old-1');
    });
    // Manually set the session to disconnected with old createdAt
    act(() => {
      const sessions = new Map(getState().sessions);
      const session = sessions.get('old-1')!;
      sessions.set('old-1', {
        ...session,
        status: 'disconnected' as StreamConnectionState,
        createdAt: Date.now() - 100000,
      });
      getState().setActiveSession(null); // So it can be cleaned
      useStreamingStore.setState({ sessions });
    });

    act(() => {
      getState().cleanupOldSessions(50000); // maxAge = 50s
    });

    expect(getState().sessions.has('old-1')).toBe(false);
  });

  it('preserves active session regardless of age', () => {
    act(() => {
      getState().createSession('active-old');
    });
    // Make it old and disconnected, but keep it active
    act(() => {
      const sessions = new Map(getState().sessions);
      const session = sessions.get('active-old')!;
      sessions.set('active-old', {
        ...session,
        status: 'disconnected' as StreamConnectionState,
        createdAt: Date.now() - 100000,
      });
      useStreamingStore.setState({ sessions });
    });

    act(() => {
      getState().cleanupOldSessions(50000);
    });

    // Active session should not be removed
    expect(getState().sessions.has('active-old')).toBe(true);
  });

  it('preserves connected sessions', () => {
    act(() => {
      getState().createSession('connected-1');
    });
    act(() => {
      getState().updateSessionStatus('connected-1', 'connected' as StreamConnectionState);
      getState().setActiveSession(null);
    });

    act(() => {
      getState().cleanupOldSessions(0); // maxAge = 0 means all are old
    });

    // connected sessions should not be cleaned
    expect(getState().sessions.has('connected-1')).toBe(true);
  });
});

describe('Streaming Store - clearAll', () => {
  it('resets all state', () => {
    act(() => {
      getState().createSession('s-1');
      getState().addStream({ id: 'ls-1', name: 'L', status: 'active', data: [], console: [] });
      getState().pushEvent(makeMessage());
    });

    act(() => {
      getState().clearAll();
    });

    expect(getState().sessions.size).toBe(0);
    expect(getState().activeSessionId).toBeNull();
    expect(getState().streams).toEqual({});
    expect(getState().activeStreamId).toBeNull();
    expect(getState().eventBuffer).toEqual([]);
    expect(getState().flushScheduled).toBe(false);
  });
});

// ============================================================================
// updateStreamStatus (overloaded)
// ============================================================================

describe('Streaming Store - updateStreamStatus (overloaded)', () => {
  it('legacy call: updates active legacy stream status', () => {
    const stream: LegacyStream = {
      id: 'ls-1',
      name: 'Stream',
      status: 'active',
      data: [],
      console: [],
    };
    act(() => {
      getState().addStream(stream);
      getState().setActiveStreamId('ls-1');
    });

    act(() => {
      getState().updateStreamStatus('paused');
    });
    expect(getState().streams['ls-1'].status).toBe('paused');
  });

  it('new API call: updates session status', () => {
    act(() => {
      getState().createSession('s-1');
    });

    act(() => {
      getState().updateStreamStatus('s-1', 'connected' as StreamConnectionState);
    });
    expect(getState().sessions.get('s-1')!.status).toBe('connected');
  });
});

// ============================================================================
// Selectors
// ============================================================================

describe('Streaming Store - selectors', () => {
  it('selectActiveSession returns active session', () => {
    act(() => {
      getState().createSession('s-1');
    });
    const session = selectActiveSession(getState());
    expect(session).not.toBeNull();
    expect(session!.id).toBe('s-1');
  });

  it('selectActiveSession returns null when no active session', () => {
    expect(selectActiveSession(getState())).toBeNull();
  });

  it('selectSessionById returns specific session', () => {
    act(() => {
      getState().createSession('s-1');
    });
    const selector = selectSessionById('s-1');
    expect(selector(getState())).not.toBeNull();
    expect(selector(getState())!.id).toBe('s-1');
  });

  it('selectSessionById returns null for missing session', () => {
    const selector = selectSessionById('missing');
    expect(selector(getState())).toBeNull();
  });

  it('selectSessionMessages returns messages for session', () => {
    act(() => {
      getState().createSession('s-1');
      getState().addSessionMessage('s-1', makeMessage());
    });
    const selector = selectSessionMessages('s-1');
    expect(selector(getState())).toHaveLength(1);
  });

  it('selectSessionMessages returns empty array for missing session', () => {
    const selector = selectSessionMessages('missing');
    expect(selector(getState())).toEqual([]);
  });

  it('selectActiveStream returns active legacy stream', () => {
    const stream: LegacyStream = {
      id: 'ls-1',
      name: 'Active Legacy',
      status: 'active',
      data: [],
      console: [],
    };
    act(() => {
      getState().addStream(stream);
      getState().setActiveStreamId('ls-1');
    });
    expect(selectActiveStream(getState())).not.toBeNull();
    expect(selectActiveStream(getState())!.name).toBe('Active Legacy');
  });

  it('selectActiveStream returns null when no active stream', () => {
    expect(selectActiveStream(getState())).toBeNull();
  });

  it('selectConnectionStatus returns global connection status', () => {
    expect(selectConnectionStatus(getState())).toBe('disconnected');
    act(() => {
      getState().setConnectionStatus('connected' as StreamConnectionState);
    });
    expect(selectConnectionStatus(getState())).toBe('connected');
  });
});
