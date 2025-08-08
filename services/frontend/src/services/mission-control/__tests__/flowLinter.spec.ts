import { FlowLinterService } from '../services';

describe('FlowLinterService (unit)', () => {
  test('analyze() returns issues with optional fix shape when applicable', () => {
    const svc = new FlowLinterService();
    const flow = {
      apiVersion: 'v1',
      kind: 'Flow',
      meta: { id: 'flow-1', name: 'flow-1', version: '1.0', createdAt: new Date().toISOString() },
      graph: { nodes: [], edges: [] },
    } as any;

    const issues = svc.analyze(flow);
    expect(Array.isArray(issues)).toBe(true);
    // Expect at least the "no-edges" rule for an empty graph
    const noEdges = issues.find((i) => i.rule === 'no-edges');
    expect(noEdges).toBeDefined();
    expect(noEdges?.fix).toBeDefined();
    expect(noEdges?.fix).toHaveProperty('id');
    expect(noEdges?.fix).toHaveProperty('title');
    expect(noEdges?.fix).toHaveProperty('action');
  });

  test('applyQuickFix() is a no-op returning the same flow reference and logs invocation; applyFix delegates', () => {
    const svc = new FlowLinterService();
    const flow = { meta: { id: 'flow-2' } } as any;
    const issue = {
      id: 'issue-1',
      kind: 'warning',
      target: { type: 'node', id: 'node-1' },
      rule: 'test-rule',
      message: 'test',
      fix: { id: 'fx-1', title: 'Fix it', action: 'do-fix' },
    } as any;

    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const result = svc.applyQuickFix(flow, issue);
    expect(result).toBe(flow);
    // Expect the debug log to have been called with the applyQuickFix tag and an object
    expect(debugSpy).toHaveBeenCalled();
    // Ensure the alias delegates to applyQuickFix
    const applyQuickFixSpy = jest.spyOn(svc, 'applyQuickFix');
    const res2 = svc.applyFix(flow, issue);
    expect(applyQuickFixSpy).toHaveBeenCalledWith(flow, issue);
    expect(res2).toBe(flow);

    debugSpy.mockRestore();
    applyQuickFixSpy.mockRestore();
  });
});