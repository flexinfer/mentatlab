import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  useSyncStore,
  selectIsLeader,
  selectTabId,
  selectIsConnected,
  selectActiveTabCount,
  type SyncState,
  type TabInfo,
} from '../index';

// ---------------------------------------------------------------------------
// Mock BroadcastChannel
// ---------------------------------------------------------------------------
const mockPostMessage = vi.fn();
const mockClose = vi.fn();
let mockOnMessage: ((event: MessageEvent) => void) | null = null;

class MockBroadcastChannel {
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  constructor(name: string) {
    this.name = name;
  }

  postMessage(message: any) {
    mockPostMessage(message);
  }

  close() {
    mockClose();
  }
}

// Install the mock globally
Object.defineProperty(globalThis, 'BroadcastChannel', {
  value: MockBroadcastChannel,
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getState(): SyncState {
  return useSyncStore.getState();
}

// ---------------------------------------------------------------------------
// Reset before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers();
  mockPostMessage.mockClear();
  mockClose.mockClear();

  // Reset the store
  act(() => {
    getState().destroy();
  });

  // Reset state fully - regenerate tabId
  act(() => {
    useSyncStore.setState({
      isLeader: false,
      knownTabs: new Map(),
      channelConnected: false,
      lastSyncTimestamp: 0,
      subscribedStores: new Set(),
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================================
// Initial State
// ============================================================================

describe('Sync Store - initial state', () => {
  it('starts with a tabId', () => {
    expect(getState().tabId).toBeTruthy();
    expect(typeof getState().tabId).toBe('string');
  });

  it('starts as non-leader', () => {
    expect(getState().isLeader).toBe(false);
  });

  it('starts with empty knownTabs', () => {
    expect(getState().knownTabs).toBeInstanceOf(Map);
    expect(getState().knownTabs.size).toBe(0);
  });

  it('starts as not connected', () => {
    expect(getState().channelConnected).toBe(false);
  });

  it('starts with lastSyncTimestamp of 0', () => {
    expect(getState().lastSyncTimestamp).toBe(0);
  });

  it('starts with empty subscribedStores', () => {
    expect(getState().subscribedStores).toBeInstanceOf(Set);
    expect(getState().subscribedStores.size).toBe(0);
  });
});

// ============================================================================
// Leadership
// ============================================================================

describe('Sync Store - claimLeadership', () => {
  it('sets isLeader to true', () => {
    act(() => {
      getState().claimLeadership();
    });
    expect(getState().isLeader).toBe(true);
  });

  it('does nothing if already leader', () => {
    act(() => {
      getState().claimLeadership();
    });
    mockPostMessage.mockClear();

    act(() => {
      getState().claimLeadership();
    });
    // Should not post another message
    expect(mockPostMessage).not.toHaveBeenCalled();
  });
});

describe('Sync Store - releaseLeadership', () => {
  it('sets isLeader to false', () => {
    act(() => {
      getState().claimLeadership();
    });
    expect(getState().isLeader).toBe(true);

    act(() => {
      getState().releaseLeadership();
    });
    expect(getState().isLeader).toBe(false);
  });

  it('does nothing if not leader', () => {
    mockPostMessage.mockClear();
    act(() => {
      getState().releaseLeadership();
    });
    expect(mockPostMessage).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Queries
// ============================================================================

describe('Sync Store - getActiveTabs', () => {
  it('always includes self in active tabs', () => {
    const tabs = getState().getActiveTabs();
    expect(tabs.length).toBeGreaterThanOrEqual(1);
    expect(tabs[0].id).toBe(getState().tabId);
  });

  it('includes self leader status', () => {
    act(() => {
      getState().claimLeadership();
    });
    const tabs = getState().getActiveTabs();
    expect(tabs[0].isLeader).toBe(true);
  });

  it('includes known tabs that are within timeout', () => {
    const now = Date.now();
    act(() => {
      useSyncStore.setState({
        knownTabs: new Map([
          ['tab-other', { id: 'tab-other', lastSeen: now, isLeader: false }],
        ]),
      });
    });
    const tabs = getState().getActiveTabs();
    expect(tabs.length).toBe(2); // self + other
  });

  it('excludes tabs beyond timeout threshold', () => {
    const now = Date.now();
    act(() => {
      useSyncStore.setState({
        knownTabs: new Map([
          ['tab-old', { id: 'tab-old', lastSeen: now - 20000, isLeader: false }],
        ]),
      });
    });
    const tabs = getState().getActiveTabs();
    expect(tabs.length).toBe(1); // only self
  });
});

describe('Sync Store - isAnyTabLeader', () => {
  it('returns true when this tab is leader', () => {
    act(() => {
      getState().claimLeadership();
    });
    expect(getState().isAnyTabLeader()).toBe(true);
  });

  it('returns true when a known tab is leader and alive', () => {
    const now = Date.now();
    act(() => {
      useSyncStore.setState({
        knownTabs: new Map([
          ['tab-leader', { id: 'tab-leader', lastSeen: now, isLeader: true }],
        ]),
      });
    });
    expect(getState().isAnyTabLeader()).toBe(true);
  });

  it('returns false when no tab is leader', () => {
    expect(getState().isAnyTabLeader()).toBe(false);
  });

  it('returns false when leader tab is timed out', () => {
    const now = Date.now();
    act(() => {
      useSyncStore.setState({
        knownTabs: new Map([
          ['tab-dead-leader', { id: 'tab-dead-leader', lastSeen: now - 20000, isLeader: true }],
        ]),
      });
    });
    expect(getState().isAnyTabLeader()).toBe(false);
  });
});

// ============================================================================
// Store Subscription
// ============================================================================

describe('Sync Store - subscribeStore', () => {
  it('adds store to subscribedStores', () => {
    act(() => {
      getState().subscribeStore('testStore', () => {});
    });
    expect(getState().subscribedStores.has('testStore')).toBe(true);
  });

  it('returns an unsubscribe function', () => {
    let unsub: () => void;
    act(() => {
      unsub = getState().subscribeStore('testStore', () => {});
    });
    expect(typeof unsub!).toBe('function');
  });

  it('supports multiple handlers for the same store', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    act(() => {
      getState().subscribeStore('shared', handler1);
      getState().subscribeStore('shared', handler2);
    });

    expect(getState().subscribedStores.has('shared')).toBe(true);
  });

  it('unsubscribe removes the specific handler', () => {
    const handler = vi.fn();
    let unsub: () => void;

    act(() => {
      unsub = getState().subscribeStore('myStore', handler);
    });

    unsub!();
    // The unsubscribe should remove the handler without errors
    // Internal details: handler map should be cleaned up
  });
});

// ============================================================================
// Destroy
// ============================================================================

describe('Sync Store - destroy', () => {
  it('resets channelConnected to false', () => {
    act(() => {
      useSyncStore.setState({ channelConnected: true });
    });
    act(() => {
      getState().destroy();
    });
    expect(getState().channelConnected).toBe(false);
  });

  it('resets isLeader to false', () => {
    act(() => {
      getState().claimLeadership();
    });
    act(() => {
      getState().destroy();
    });
    expect(getState().isLeader).toBe(false);
  });

  it('clears knownTabs', () => {
    act(() => {
      useSyncStore.setState({
        knownTabs: new Map([
          ['t1', { id: 't1', lastSeen: Date.now(), isLeader: false }],
        ]),
      });
    });
    act(() => {
      getState().destroy();
    });
    expect(getState().knownTabs.size).toBe(0);
  });

  it('clears subscribedStores', () => {
    act(() => {
      getState().subscribeStore('test', () => {});
    });
    act(() => {
      getState().destroy();
    });
    expect(getState().subscribedStores.size).toBe(0);
  });
});

// ============================================================================
// Selectors
// ============================================================================

describe('Sync Store - selectors', () => {
  it('selectIsLeader returns leadership status', () => {
    expect(selectIsLeader(getState())).toBe(false);
    act(() => {
      getState().claimLeadership();
    });
    expect(selectIsLeader(getState())).toBe(true);
  });

  it('selectTabId returns the tab ID', () => {
    const tabId = selectTabId(getState());
    expect(typeof tabId).toBe('string');
    expect(tabId.length).toBeGreaterThan(0);
  });

  it('selectIsConnected returns channel status', () => {
    expect(selectIsConnected(getState())).toBe(false);
  });

  it('selectActiveTabCount counts self plus alive known tabs', () => {
    expect(selectActiveTabCount(getState())).toBe(1); // just self

    const now = Date.now();
    act(() => {
      useSyncStore.setState({
        knownTabs: new Map([
          ['t1', { id: 't1', lastSeen: now, isLeader: false }],
          ['t2', { id: 't2', lastSeen: now, isLeader: false }],
          ['t3', { id: 't3', lastSeen: now - 20000, isLeader: false }], // timed out
        ]),
      });
    });
    expect(selectActiveTabCount(getState())).toBe(3); // self + t1 + t2
  });
});
