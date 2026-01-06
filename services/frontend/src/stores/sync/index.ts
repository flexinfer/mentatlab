/**
 * Sync Store - Multi-tab synchronization via BroadcastChannel
 *
 * Enables real-time state synchronization across browser tabs:
 * - Broadcasts state changes to other tabs
 * - Receives updates from other tabs
 * - Leader election for single-tab operations
 * - Conflict resolution with timestamps
 *
 * Use cases:
 * - Keep canvas in sync across tabs
 * - Share streaming connection (only one tab connects)
 * - Propagate flow saves
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type SyncMessageType =
  | 'state_update'
  | 'leader_claim'
  | 'leader_heartbeat'
  | 'leader_release'
  | 'ping'
  | 'pong';

export interface SyncMessage {
  type: SyncMessageType;
  tabId: string;
  timestamp: number;
  payload?: unknown;
  store?: string; // Which store this update is for
}

export interface TabInfo {
  id: string;
  lastSeen: number;
  isLeader: boolean;
}

export interface SyncState {
  // Tab identity
  tabId: string;
  isLeader: boolean;

  // Known tabs
  knownTabs: Map<string, TabInfo>;

  // Channel state
  channelConnected: boolean;
  lastSyncTimestamp: number;

  // Subscribed stores
  subscribedStores: Set<string>;

  // Actions
  initialize: () => void;
  destroy: () => void;
  claimLeadership: () => void;
  releaseLeadership: () => void;
  broadcast: (store: string, payload: unknown) => void;
  subscribeStore: (storeName: string, handler: (payload: unknown) => void) => () => void;
  getActiveTabs: () => TabInfo[];
  isAnyTabLeader: () => boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL_NAME = 'mentatlab-sync';
const LEADER_HEARTBEAT_INTERVAL = 5000; // 5 seconds
const TAB_TIMEOUT = 15000; // 15 seconds without heartbeat = tab considered dead
const LEADER_CLAIM_DELAY = 1000; // Wait before claiming leadership

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

// BroadcastChannel instance (module-level)
let channel: BroadcastChannel | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

// Store handlers for different stores
const storeHandlers = new Map<string, Set<(payload: unknown) => void>>();

export const useSyncStore = create<SyncState>()(
  devtools(
    (set, get) => ({
      // Initial state
      tabId: generateTabId(),
      isLeader: false,
      knownTabs: new Map(),
      channelConnected: false,
      lastSyncTimestamp: 0,
      subscribedStores: new Set(),

      // ─────────────────────────────────────────────────────────────────────
      // Lifecycle
      // ─────────────────────────────────────────────────────────────────────

      initialize: () => {
        // Skip if not in browser
        if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
          console.warn('[Sync] BroadcastChannel not available');
          return;
        }

        // Skip if already initialized
        if (channel) {
          return;
        }

        const state = get();

        try {
          channel = new BroadcastChannel(CHANNEL_NAME);

          channel.onmessage = (event: MessageEvent<SyncMessage>) => {
            const message = event.data;
            const currentState = get();

            // Ignore messages from self
            if (message.tabId === currentState.tabId) {
              return;
            }

            // Update known tabs
            const knownTabs = new Map(currentState.knownTabs);
            knownTabs.set(message.tabId, {
              id: message.tabId,
              lastSeen: message.timestamp,
              isLeader: message.type === 'leader_claim' || message.type === 'leader_heartbeat',
            });
            set({ knownTabs, lastSyncTimestamp: message.timestamp });

            // Handle message types
            switch (message.type) {
              case 'state_update':
                if (message.store) {
                  const handlers = storeHandlers.get(message.store);
                  if (handlers) {
                    handlers.forEach((handler) => handler(message.payload));
                  }
                }
                break;

              case 'leader_claim':
              case 'leader_heartbeat':
                // Another tab claimed leadership
                if (currentState.isLeader && message.timestamp > currentState.lastSyncTimestamp) {
                  // Yield leadership if they claimed after us
                  set({ isLeader: false });
                }
                break;

              case 'leader_release':
                // Leader released, try to claim
                setTimeout(() => {
                  const afterTimeout = get();
                  if (!afterTimeout.isAnyTabLeader()) {
                    afterTimeout.claimLeadership();
                  }
                }, LEADER_CLAIM_DELAY);
                break;

              case 'ping':
                // Respond to ping
                channel?.postMessage({
                  type: 'pong',
                  tabId: currentState.tabId,
                  timestamp: Date.now(),
                } as SyncMessage);
                break;
            }
          };

          channel.onmessageerror = (err) => {
            console.error('[Sync] Message error:', err);
          };

          // Register this tab
          const registerMessage: SyncMessage = {
            type: 'ping',
            tabId: state.tabId,
            timestamp: Date.now(),
          };
          channel.postMessage(registerMessage);

          // Start heartbeat if leader
          heartbeatInterval = setInterval(() => {
            const currentState = get();
            if (currentState.isLeader && channel) {
              channel.postMessage({
                type: 'leader_heartbeat',
                tabId: currentState.tabId,
                timestamp: Date.now(),
              } as SyncMessage);
            }
          }, LEADER_HEARTBEAT_INTERVAL);

          // Cleanup dead tabs
          cleanupInterval = setInterval(() => {
            const now = Date.now();
            const knownTabs = new Map(get().knownTabs);
            let hadLeader = false;

            for (const [id, tab] of knownTabs) {
              if (now - tab.lastSeen > TAB_TIMEOUT) {
                if (tab.isLeader) {
                  hadLeader = true;
                }
                knownTabs.delete(id);
              }
            }

            set({ knownTabs });

            // If leader died, try to claim
            if (hadLeader && !get().isLeader) {
              setTimeout(() => {
                if (!get().isAnyTabLeader()) {
                  get().claimLeadership();
                }
              }, LEADER_CLAIM_DELAY);
            }
          }, TAB_TIMEOUT / 2);

          set({ channelConnected: true });

          // Try to claim leadership if no leader
          setTimeout(() => {
            if (!get().isAnyTabLeader()) {
              get().claimLeadership();
            }
          }, LEADER_CLAIM_DELAY);
        } catch (err) {
          console.error('[Sync] Failed to initialize BroadcastChannel:', err);
        }
      },

      destroy: () => {
        const state = get();

        // Release leadership before closing
        if (state.isLeader && channel) {
          channel.postMessage({
            type: 'leader_release',
            tabId: state.tabId,
            timestamp: Date.now(),
          } as SyncMessage);
        }

        // Clear intervals
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        if (cleanupInterval) {
          clearInterval(cleanupInterval);
          cleanupInterval = null;
        }

        // Close channel
        if (channel) {
          channel.close();
          channel = null;
        }

        // Clear handlers
        storeHandlers.clear();

        set({
          channelConnected: false,
          isLeader: false,
          knownTabs: new Map(),
          subscribedStores: new Set(),
        });
      },

      // ─────────────────────────────────────────────────────────────────────
      // Leadership
      // ─────────────────────────────────────────────────────────────────────

      claimLeadership: () => {
        const state = get();
        if (state.isLeader) return;

        set({ isLeader: true });

        if (channel) {
          channel.postMessage({
            type: 'leader_claim',
            tabId: state.tabId,
            timestamp: Date.now(),
          } as SyncMessage);
        }
      },

      releaseLeadership: () => {
        const state = get();
        if (!state.isLeader) return;

        set({ isLeader: false });

        if (channel) {
          channel.postMessage({
            type: 'leader_release',
            tabId: state.tabId,
            timestamp: Date.now(),
          } as SyncMessage);
        }
      },

      // ─────────────────────────────────────────────────────────────────────
      // Broadcasting
      // ─────────────────────────────────────────────────────────────────────

      broadcast: (store: string, payload: unknown) => {
        if (!channel) return;

        const state = get();
        const message: SyncMessage = {
          type: 'state_update',
          tabId: state.tabId,
          timestamp: Date.now(),
          store,
          payload,
        };

        channel.postMessage(message);
      },

      subscribeStore: (storeName: string, handler: (payload: unknown) => void) => {
        // Add handler
        if (!storeHandlers.has(storeName)) {
          storeHandlers.set(storeName, new Set());
        }
        storeHandlers.get(storeName)!.add(handler);

        // Track subscription
        set((state) => ({
          subscribedStores: new Set([...state.subscribedStores, storeName]),
        }));

        // Return unsubscribe function
        return () => {
          const handlers = storeHandlers.get(storeName);
          if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
              storeHandlers.delete(storeName);
            }
          }
        };
      },

      // ─────────────────────────────────────────────────────────────────────
      // Queries
      // ─────────────────────────────────────────────────────────────────────

      getActiveTabs: () => {
        const state = get();
        const now = Date.now();
        const active: TabInfo[] = [];

        // Add self
        active.push({
          id: state.tabId,
          lastSeen: now,
          isLeader: state.isLeader,
        });

        // Add known tabs that are still alive
        for (const tab of state.knownTabs.values()) {
          if (now - tab.lastSeen <= TAB_TIMEOUT) {
            active.push(tab);
          }
        }

        return active;
      },

      isAnyTabLeader: () => {
        const state = get();
        if (state.isLeader) return true;

        const now = Date.now();
        for (const tab of state.knownTabs.values()) {
          if (tab.isLeader && now - tab.lastSeen <= TAB_TIMEOUT) {
            return true;
          }
        }
        return false;
      },
    }),
    { name: 'sync-store' }
  )
);

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────────────────────

export const selectIsLeader = (state: SyncState) => state.isLeader;
export const selectTabId = (state: SyncState) => state.tabId;
export const selectIsConnected = (state: SyncState) => state.channelConnected;
export const selectActiveTabCount = (state: SyncState) => {
  const now = Date.now();
  let count = 1; // Self
  for (const tab of state.knownTabs.values()) {
    if (now - tab.lastSeen <= TAB_TIMEOUT) {
      count++;
    }
  }
  return count;
};

// ─────────────────────────────────────────────────────────────────────────────
// Hooks for common patterns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize sync on mount, cleanup on unmount
 * Call this in your root App component
 */
export function initializeSync() {
  const store = useSyncStore.getState();
  store.initialize();

  // Cleanup on page unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      store.destroy();
    });
  }

  return () => store.destroy();
}

export default useSyncStore;
