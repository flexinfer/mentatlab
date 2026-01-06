/**
 * Flow Store - Flow persistence with undo/redo support
 *
 * Manages flow definitions and execution state:
 * - Flow CRUD operations
 * - Undo/redo history with configurable depth
 * - Flow persistence to localStorage
 * - Active flow tracking
 */

import { create } from 'zustand';
import { devtools, persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data?: Record<string, unknown>;
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

// Snapshot for undo/redo
interface FlowSnapshot {
  flows: Map<string, Flow>;
  activeFlowId: string | null;
  timestamp: number;
}

export interface FlowState {
  // Flow state
  flows: Map<string, Flow>;
  activeFlowId: string | null;

  // Undo/Redo history
  history: FlowSnapshot[];
  historyIndex: number;
  maxHistorySize: number;

  // Flow CRUD
  createFlow: (name: string, description?: string) => string;
  updateFlow: (flowId: string, updates: Partial<Omit<Flow, 'id' | 'createdAt'>>) => void;
  deleteFlow: (flowId: string) => void;
  duplicateFlow: (flowId: string) => string | null;

  // Flow nodes/edges
  setFlowNodes: (flowId: string, nodes: FlowNode[]) => void;
  setFlowEdges: (flowId: string, edges: FlowEdge[]) => void;
  addFlowNode: (flowId: string, node: FlowNode) => void;
  removeFlowNode: (flowId: string, nodeId: string) => void;
  updateFlowNode: (flowId: string, nodeId: string, updates: Partial<FlowNode>) => void;

  // Active flow
  setActiveFlow: (flowId: string | null) => void;
  getActiveFlow: () => Flow | null;

  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
  saveSnapshot: () => void;

  // Import/Export
  exportFlow: (flowId: string) => string | null;
  importFlow: (json: string) => string | null;
  exportAllFlows: () => string;
  importAllFlows: (json: string) => number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_HISTORY_SIZE = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function cloneFlowsMap(flows: Map<string, Flow>): Map<string, Flow> {
  const cloned = new Map<string, Flow>();
  flows.forEach((value, key) => {
    cloned.set(key, JSON.parse(JSON.stringify(value)));
  });
  return cloned;
}

function generateFlowId(): string {
  return `flow-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useFlowStore = create<FlowState>()(
  devtools(
    persist(
      subscribeWithSelector(
        immer((set, get) => ({
          // Initial state
          flows: new Map(),
          activeFlowId: null,
          history: [],
          historyIndex: -1,
          maxHistorySize: DEFAULT_MAX_HISTORY_SIZE,

          // ─────────────────────────────────────────────────────────────────
          // Flow CRUD
          // ─────────────────────────────────────────────────────────────────

          createFlow: (name: string, description?: string) => {
            const flowId = generateFlowId();
            const now = Date.now();
            const flow: Flow = {
              id: flowId,
              name,
              description,
              nodes: [],
              edges: [],
              createdAt: now,
              updatedAt: now,
            };

            const state = get();
            state.saveSnapshot();

            set((draft) => {
              draft.flows.set(flowId, flow);
              draft.activeFlowId = flowId;
            });

            return flowId;
          },

          updateFlow: (flowId: string, updates: Partial<Omit<Flow, 'id' | 'createdAt'>>) => {
            const state = get();
            if (!state.flows.has(flowId)) return;

            state.saveSnapshot();

            set((draft) => {
              const flow = draft.flows.get(flowId);
              if (flow) {
                Object.assign(flow, { ...updates, updatedAt: Date.now() });
              }
            });
          },

          deleteFlow: (flowId: string) => {
            const state = get();
            if (!state.flows.has(flowId)) return;

            state.saveSnapshot();

            set((draft) => {
              draft.flows.delete(flowId);
              if (draft.activeFlowId === flowId) {
                // Set active to first available flow or null
                const firstFlow = draft.flows.keys().next().value;
                draft.activeFlowId = firstFlow ?? null;
              }
            });
          },

          duplicateFlow: (flowId: string) => {
            const state = get();
            const original = state.flows.get(flowId);
            if (!original) return null;

            const newFlowId = generateFlowId();
            const now = Date.now();
            const duplicated: Flow = {
              ...JSON.parse(JSON.stringify(original)),
              id: newFlowId,
              name: `${original.name} (Copy)`,
              createdAt: now,
              updatedAt: now,
            };

            state.saveSnapshot();

            set((draft) => {
              draft.flows.set(newFlowId, duplicated);
            });

            return newFlowId;
          },

          // ─────────────────────────────────────────────────────────────────
          // Flow nodes/edges
          // ─────────────────────────────────────────────────────────────────

          setFlowNodes: (flowId: string, nodes: FlowNode[]) => {
            const state = get();
            if (!state.flows.has(flowId)) return;

            state.saveSnapshot();

            set((draft) => {
              const flow = draft.flows.get(flowId);
              if (flow) {
                flow.nodes = nodes;
                flow.updatedAt = Date.now();
              }
            });
          },

          setFlowEdges: (flowId: string, edges: FlowEdge[]) => {
            const state = get();
            if (!state.flows.has(flowId)) return;

            state.saveSnapshot();

            set((draft) => {
              const flow = draft.flows.get(flowId);
              if (flow) {
                flow.edges = edges;
                flow.updatedAt = Date.now();
              }
            });
          },

          addFlowNode: (flowId: string, node: FlowNode) => {
            const state = get();
            if (!state.flows.has(flowId)) return;

            state.saveSnapshot();

            set((draft) => {
              const flow = draft.flows.get(flowId);
              if (flow) {
                flow.nodes.push(node);
                flow.updatedAt = Date.now();
              }
            });
          },

          removeFlowNode: (flowId: string, nodeId: string) => {
            const state = get();
            if (!state.flows.has(flowId)) return;

            state.saveSnapshot();

            set((draft) => {
              const flow = draft.flows.get(flowId);
              if (flow) {
                flow.nodes = flow.nodes.filter((n) => n.id !== nodeId);
                // Also remove connected edges
                flow.edges = flow.edges.filter(
                  (e) => e.source !== nodeId && e.target !== nodeId
                );
                flow.updatedAt = Date.now();
              }
            });
          },

          updateFlowNode: (flowId: string, nodeId: string, updates: Partial<FlowNode>) => {
            const state = get();
            if (!state.flows.has(flowId)) return;

            state.saveSnapshot();

            set((draft) => {
              const flow = draft.flows.get(flowId);
              if (flow) {
                const nodeIndex = flow.nodes.findIndex((n) => n.id === nodeId);
                if (nodeIndex !== -1) {
                  const node = flow.nodes[nodeIndex];
                  if (node) {
                    Object.assign(node, updates);
                    flow.updatedAt = Date.now();
                  }
                }
              }
            });
          },

          // ─────────────────────────────────────────────────────────────────
          // Active flow
          // ─────────────────────────────────────────────────────────────────

          setActiveFlow: (flowId: string | null) => {
            set({ activeFlowId: flowId });
          },

          getActiveFlow: () => {
            const state = get();
            if (!state.activeFlowId) return null;
            return state.flows.get(state.activeFlowId) ?? null;
          },

          // ─────────────────────────────────────────────────────────────────
          // Undo/Redo
          // ─────────────────────────────────────────────────────────────────

          saveSnapshot: () => {
            set((draft) => {
              const snapshot: FlowSnapshot = {
                flows: cloneFlowsMap(draft.flows),
                activeFlowId: draft.activeFlowId,
                timestamp: Date.now(),
              };

              // Trim future history if we're not at the end
              if (draft.historyIndex < draft.history.length - 1) {
                draft.history = draft.history.slice(0, draft.historyIndex + 1);
              }

              // Add snapshot
              draft.history.push(snapshot);

              // Trim if exceeds max size
              if (draft.history.length > draft.maxHistorySize) {
                draft.history = draft.history.slice(draft.history.length - draft.maxHistorySize);
              }

              draft.historyIndex = draft.history.length - 1;
            });
          },

          undo: () => {
            set((draft) => {
              if (draft.historyIndex > 0) {
                draft.historyIndex -= 1;
                const snapshot = draft.history[draft.historyIndex];
                if (snapshot) {
                  draft.flows = cloneFlowsMap(snapshot.flows);
                  draft.activeFlowId = snapshot.activeFlowId;
                }
              }
            });
          },

          redo: () => {
            set((draft) => {
              if (draft.historyIndex < draft.history.length - 1) {
                draft.historyIndex += 1;
                const snapshot = draft.history[draft.historyIndex];
                if (snapshot) {
                  draft.flows = cloneFlowsMap(snapshot.flows);
                  draft.activeFlowId = snapshot.activeFlowId;
                }
              }
            });
          },

          canUndo: () => {
            return get().historyIndex > 0;
          },

          canRedo: () => {
            const state = get();
            return state.historyIndex < state.history.length - 1;
          },

          clearHistory: () => {
            set((draft) => {
              draft.history = [];
              draft.historyIndex = -1;
            });
          },

          // ─────────────────────────────────────────────────────────────────
          // Import/Export
          // ─────────────────────────────────────────────────────────────────

          exportFlow: (flowId: string) => {
            const flow = get().flows.get(flowId);
            if (!flow) return null;
            return JSON.stringify(flow, null, 2);
          },

          importFlow: (json: string) => {
            try {
              const flow = JSON.parse(json) as Flow;
              if (!flow.id || !flow.name) {
                console.error('Invalid flow JSON: missing id or name');
                return null;
              }

              // Generate new ID to avoid conflicts
              const newFlowId = generateFlowId();
              const now = Date.now();
              const imported: Flow = {
                ...flow,
                id: newFlowId,
                createdAt: now,
                updatedAt: now,
              };

              get().saveSnapshot();

              set((draft) => {
                draft.flows.set(newFlowId, imported);
              });

              return newFlowId;
            } catch (err) {
              console.error('Failed to import flow:', err);
              return null;
            }
          },

          exportAllFlows: () => {
            const flows = Array.from(get().flows.values());
            return JSON.stringify(flows, null, 2);
          },

          importAllFlows: (json: string) => {
            try {
              const flows = JSON.parse(json) as Flow[];
              if (!Array.isArray(flows)) {
                console.error('Invalid flows JSON: expected array');
                return 0;
              }

              get().saveSnapshot();

              let imported = 0;
              set((draft) => {
                flows.forEach((flow) => {
                  if (flow.id && flow.name) {
                    const newFlowId = generateFlowId();
                    const now = Date.now();
                    draft.flows.set(newFlowId, {
                      ...flow,
                      id: newFlowId,
                      createdAt: now,
                      updatedAt: now,
                    });
                    imported++;
                  }
                });
              });

              return imported;
            } catch (err) {
              console.error('Failed to import flows:', err);
              return 0;
            }
          },
        }))
      ),
      {
        name: 'mentatlab-flows',
        partialize: (state) => ({
          flows: Array.from(state.flows.entries()),
          activeFlowId: state.activeFlowId,
          // Don't persist history (too large)
        }),
        onRehydrateStorage: () => (state) => {
          if (state?.flows) {
            // Convert array back to Map
            if (Array.isArray(state.flows)) {
              state.flows = new Map(state.flows as [string, Flow][]);
            }
          }
          // Initialize history with current state
          if (state) {
            state.history = [];
            state.historyIndex = -1;
          }
        },
      }
    ),
    { name: 'flow-store' }
  )
);

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────────────────────

export const selectFlows = (state: FlowState) => state.flows;
export const selectActiveFlowId = (state: FlowState) => state.activeFlowId;
export const selectActiveFlow = (state: FlowState) => {
  if (!state.activeFlowId) return null;
  return state.flows.get(state.activeFlowId) ?? null;
};
export const selectFlowById = (flowId: string) => (state: FlowState) =>
  state.flows.get(flowId) ?? null;
export const selectCanUndo = (state: FlowState) => state.historyIndex > 0;
export const selectCanRedo = (state: FlowState) =>
  state.historyIndex < state.history.length - 1;

export default useFlowStore;
