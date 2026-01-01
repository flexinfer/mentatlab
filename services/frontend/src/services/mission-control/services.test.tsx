/**
 * Unit tests for FlowLinterService quick-fix transformations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { linter, type LintIssue } from './services';
import type { Flow, Node, Edge } from '../../types/graph';

// Mock flow factory
function createTestFlow(nodes: Partial<Node>[] = [], edges: Partial<Edge & { id?: string }>[] = []): Flow {
  return {
    apiVersion: 'v1',
    kind: 'Flow',
    meta: {
      id: 'test-flow',
      name: 'Test Flow',
      version: '0.0.0',
      createdAt: new Date().toISOString(),
    },
    graph: {
      nodes: nodes.map((n, i) => ({
        id: n.id ?? `node-${i}`,
        type: n.type ?? 'default',
        params: n.params ?? {},
        position: n.position ?? { x: 0, y: 0 },
        ...n,
      })) as Node[],
      edges: edges.map((e, i) => ({
        id: (e as any).id ?? `edge-${i}`,
        from: e.from ?? `node-${i}`,
        to: e.to ?? `node-${i + 1}`,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        ...e,
      })) as Edge[],
    },
  };
}

// Mock issue factory
function createLintIssue(overrides: Partial<LintIssue> = {}): LintIssue {
  return {
    id: 'issue-1',
    kind: 'warning',
    rule: 'test-rule',
    target: { type: 'node', id: 'node-0' },
    message: 'Test issue',
    ...overrides,
  };
}

describe('FlowLinterService.applyQuickFix', () => {
  beforeEach(() => {
    // Suppress console.debug during tests
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  describe('suggest-set-timeout action', () => {
    it('should add timeoutMs param to target node', () => {
      const flow = createTestFlow([
        { id: 'node-1', type: 'agent', params: { name: 'test' } },
        { id: 'node-2', type: 'agent', params: {} },
      ]);

      const issue = createLintIssue({
        target: { type: 'node', id: 'node-1' },
        fix: {
          id: 'fix-timeout',
          title: 'Set timeout to 30s',
          action: 'suggest-set-timeout',
          params: { nodeId: 'node-1', timeoutMs: 30000 },
        },
      });

      const result = linter.applyQuickFix(flow, issue);

      // Node-1 should have timeoutMs added
      const node1 = result.graph.nodes.find(n => n.id === 'node-1');
      expect(node1?.params).toHaveProperty('timeoutMs', 30000);

      // Node-2 should be unchanged
      const node2 = result.graph.nodes.find(n => n.id === 'node-2');
      expect(node2?.params).not.toHaveProperty('timeoutMs');
    });

    it('should use default 30000ms if timeoutMs not provided', () => {
      const flow = createTestFlow([{ id: 'node-1', type: 'agent', params: {} }]);

      const issue = createLintIssue({
        fix: {
          id: 'fix-timeout',
          title: 'Set default timeout',
          action: 'suggest-set-timeout',
          params: { nodeId: 'node-1' }, // No timeoutMs
        },
      });

      const result = linter.applyQuickFix(flow, issue);
      const node = result.graph.nodes.find(n => n.id === 'node-1');
      expect(node?.params).toHaveProperty('timeoutMs', 30000);
    });

    it('should return unchanged flow if nodeId not found', () => {
      const flow = createTestFlow([{ id: 'node-1', type: 'agent', params: {} }]);

      const issue = createLintIssue({
        fix: {
          id: 'fix-timeout',
          title: 'Set timeout',
          action: 'suggest-set-timeout',
          params: { nodeId: 'nonexistent', timeoutMs: 5000 },
        },
      });

      const result = linter.applyQuickFix(flow, issue);
      expect(result).toEqual(flow);
    });
  });

  describe('remove-circular-edge action', () => {
    it('should remove the specified edge', () => {
      const flow = createTestFlow(
        [{ id: 'node-1' }, { id: 'node-2' }],
        [
          { id: 'edge-forward', from: 'node-1', to: 'node-2' },
          { id: 'edge-circular', from: 'node-2', to: 'node-1' }, // Circular edge
        ]
      );

      const issue = createLintIssue({
        fix: {
          id: 'fix-circular',
          title: 'Remove circular edge',
          action: 'remove-circular-edge',
          params: { edgeId: 'edge-circular' }, // String edge ID
        },
      });

      const result = linter.applyQuickFix(flow, issue);
      expect(result.graph.edges).toHaveLength(1);
      expect(result.graph.edges[0].from).toBe('node-1');
      expect(result.graph.edges[0].id).toBe('edge-forward');
    });

    it('should return unchanged flow if edgeId not found', () => {
      const flow = createTestFlow(
        [{ id: 'node-1' }, { id: 'node-2' }],
        [{ id: 'edge-1', from: 'node-1', to: 'node-2' }]
      );

      const issue = createLintIssue({
        fix: {
          id: 'fix-circular',
          title: 'Remove circular edge',
          action: 'remove-circular-edge',
          params: { edgeId: 'nonexistent-edge' }, // Non-existent string ID
        },
      });

      const result = linter.applyQuickFix(flow, issue);
      expect(result.graph.edges).toHaveLength(1);
    });
  });

  describe('set-pin-type action', () => {
    it('should update node output pin type', () => {
      // Note: The implementation stores pins directly on node, not in params
      const flow = createTestFlow([
        {
          id: 'node-1',
          type: 'agent',
          params: {},
          outputs: { out1: { type: 'text' } },
        } as any,
      ]);

      const issue = createLintIssue({
        fix: {
          id: 'fix-pin',
          title: 'Set pin type to json',
          action: 'set-pin-type',
          params: { nodeId: 'node-1', pinId: 'out1', location: 'outputs', type: 'json' },
        },
      });

      const result = linter.applyQuickFix(flow, issue);
      const node = result.graph.nodes.find(n => n.id === 'node-1') as any;
      expect(node?.outputs?.out1?.type).toBe('json');
    });

    it('should update node input pin type', () => {
      const flow = createTestFlow([
        {
          id: 'node-1',
          type: 'agent',
          params: {},
          inputs: { in1: { type: 'text' } },
        } as any,
      ]);

      const issue = createLintIssue({
        fix: {
          id: 'fix-pin',
          title: 'Set pin type',
          action: 'set-pin-type',
          params: { nodeId: 'node-1', pinId: 'in1', location: 'inputs', type: 'stream' },
        },
      });

      const result = linter.applyQuickFix(flow, issue);
      const node = result.graph.nodes.find(n => n.id === 'node-1') as any;
      expect(node?.inputs?.in1?.type).toBe('stream');
    });
  });

  describe('add-edge action', () => {
    it('should add a new edge between nodes', () => {
      const flow = createTestFlow([{ id: 'node-1' }, { id: 'node-2' }], []);

      const issue = createLintIssue({
        fix: {
          id: 'fix-edge',
          title: 'Add missing edge',
          action: 'add-edge',
          // Note: Implementation uses fromNode/toNode/fromPin/toPin
          params: { fromNode: 'node-1', toNode: 'node-2', fromPin: 'out', toPin: 'in' },
        },
      });

      const result = linter.applyQuickFix(flow, issue);
      expect(result.graph.edges).toHaveLength(1);
      // The implementation creates edges with format "nodeId.pinId" in from/to
      expect(result.graph.edges[0].from).toBe('node-1.out');
      expect(result.graph.edges[0].to).toBe('node-2.in');
    });

    it('should add edge without pin handles', () => {
      const flow = createTestFlow([{ id: 'node-1' }, { id: 'node-2' }], []);

      const issue = createLintIssue({
        fix: {
          id: 'fix-edge',
          title: 'Add edge',
          action: 'add-edge',
          params: { fromNode: 'node-1', toNode: 'node-2' },
        },
      });

      const result = linter.applyQuickFix(flow, issue);
      expect(result.graph.edges).toHaveLength(1);
      expect(result.graph.edges[0].from).toBe('node-1');
      expect(result.graph.edges[0].to).toBe('node-2');
    });
  });

  describe('UI-only actions', () => {
    it('should return unchanged flow for open-edge-helper', () => {
      const flow = createTestFlow([{ id: 'node-1' }]);

      const issue = createLintIssue({
        fix: {
          id: 'fix-ui',
          title: 'Open edge helper',
          action: 'open-edge-helper',
          params: {},
        },
      });

      const result = linter.applyQuickFix(flow, issue);
      expect(result).toEqual(flow);
    });

    it('should return unchanged flow for open-connector-helper', () => {
      const flow = createTestFlow([{ id: 'node-1' }]);

      const issue = createLintIssue({
        fix: {
          id: 'fix-ui',
          title: 'Open connector helper',
          action: 'open-connector-helper',
          params: {},
        },
      });

      const result = linter.applyQuickFix(flow, issue);
      expect(result).toEqual(flow);
    });
  });

  describe('edge cases', () => {
    it('should return unchanged flow if no fix provided', () => {
      const flow = createTestFlow([{ id: 'node-1' }]);
      const issue = createLintIssue({ fix: undefined });

      const result = linter.applyQuickFix(flow, issue);
      expect(result).toEqual(flow);
    });

    it('should return unchanged flow for unknown action', () => {
      const flow = createTestFlow([{ id: 'node-1' }]);

      const issue = createLintIssue({
        fix: {
          id: 'fix-unknown',
          title: 'Unknown action',
          action: 'unknown-action' as any,
          params: {},
        },
      });

      const result = linter.applyQuickFix(flow, issue);
      expect(result).toEqual(flow);
    });
  });
});

describe('FlowLinterService.canAutoApply', () => {
  it('should return true for auto-applicable actions', () => {
    const autoActions = ['suggest-set-timeout', 'remove-circular-edge', 'set-pin-type', 'add-edge'];

    for (const action of autoActions) {
      const issue = createLintIssue({
        fix: { id: 'fix', title: 'Test', action, params: {} },
      });
      expect(linter.canAutoApply(issue)).toBe(true);
    }
  });

  it('should return false for UI-only actions', () => {
    const uiActions = ['open-edge-helper', 'open-connector-helper', 'open-pin-schema'];

    for (const action of uiActions) {
      const issue = createLintIssue({
        fix: { id: 'fix', title: 'Test', action, params: {} },
      });
      expect(linter.canAutoApply(issue)).toBe(false);
    }
  });

  it('should return false if no fix provided', () => {
    const issue = createLintIssue({ fix: undefined });
    expect(linter.canAutoApply(issue)).toBe(false);
  });
});
