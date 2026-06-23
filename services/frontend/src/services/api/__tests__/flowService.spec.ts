// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FlowService, type CreateFlowRequest } from '../flowService';

function makeMockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  };
}

describe('FlowService', () => {
  const sampleGraph: CreateFlowRequest['graph'] = {
    nodes: [
      {
        id: 'n1',
        type: 'agent',
        position: { x: 12, y: 34 },
        data: { agent_id: 'mentatlab.echo' },
      },
    ],
    edges: [
      {
        id: 'e-1',
        source: 'n1',
        target: 'n2',
      },
    ],
  };

  let mockHttp: ReturnType<typeof makeMockHttp>;
  let svc: FlowService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttp = makeMockHttp();
    svc = new FlowService(mockHttp as any);
  });

  it('listFlows() forwards query params to GET /api/v1/flows', async () => {
    mockHttp.get.mockResolvedValueOnce({ flows: [], count: 0 });

    await svc.listFlows({ limit: 25, created_by: 'builder@example.com' });

    expect(mockHttp.get).toHaveBeenCalledWith('/api/v1/flows', {
      params: { limit: 25, created_by: 'builder@example.com' },
    });
  });

  it('saveFlow() updates existing flow when id is provided', async () => {
    mockHttp.put.mockResolvedValueOnce({
      id: 'flow-1',
      name: 'Updated',
      graph: sampleGraph,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:01Z',
    });

    await svc.saveFlow({
      id: 'flow-1',
      name: 'Updated',
      graph: sampleGraph,
      metadata: { test: true },
    });

    expect(mockHttp.put).toHaveBeenCalledWith('/api/v1/flows/flow-1', {
      name: 'Updated',
      description: undefined,
      graph: sampleGraph,
      layout: undefined,
      metadata: { test: true },
    }, { params: undefined });
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it('saveFlow() falls back to create when update returns 404', async () => {
    const notFoundErr: any = new Error('not found');
    notFoundErr.status = 404;
    mockHttp.put.mockRejectedValueOnce(notFoundErr);
    mockHttp.post.mockResolvedValueOnce({
      id: 'flow-2',
      name: 'Created',
      graph: sampleGraph,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    await svc.saveFlow({
      id: 'flow-2',
      name: 'Created',
      graph: sampleGraph,
      metadata: { source: 'autosave' },
    });

    expect(mockHttp.put).toHaveBeenCalledTimes(1);
    expect(mockHttp.post).toHaveBeenCalledWith('/api/v1/flows', {
      id: 'flow-2',
      name: 'Created',
      graph: sampleGraph,
      metadata: { source: 'autosave' },
    }, { params: undefined });
  });

  it('saveFlow() preserves graph payload when creating new flow', async () => {
    mockHttp.post.mockResolvedValueOnce({
      id: 'flow-3',
      name: 'New Flow',
      graph: sampleGraph,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    await svc.saveFlow({
      name: 'New Flow',
      graph: sampleGraph,
      metadata: { parity: 'check' },
    });

    expect(mockHttp.post).toHaveBeenCalledWith('/api/v1/flows', {
      name: 'New Flow',
      graph: sampleGraph,
      metadata: { parity: 'check' },
    }, { params: undefined });
  });

  it('saveFlow() rethrows non-404 update failures', async () => {
    const conflictErr: any = new Error('conflict');
    conflictErr.status = 409;
    mockHttp.put.mockRejectedValueOnce(conflictErr);

    await expect(
      svc.saveFlow({
        id: 'flow-4',
        name: 'Conflict Flow',
        graph: sampleGraph,
      })
    ).rejects.toMatchObject({ status: 409 });

    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it('importLoomWorkflow() posts workflow payload to /api/v1/flows/import/loom', async () => {
    mockHttp.post.mockResolvedValueOnce({
      id: 'flow-loom-import',
      name: 'Imported Loom Workflow',
      graph: sampleGraph,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    });

    await svc.importLoomWorkflow({
      name: 'Imported Loom Workflow',
      steps: [
        { id: 'fetch', name: 'Fetch', tool_name: 'k8s_apps_k3s__k8s_get' },
        { id: 'infer', name: 'Infer', depends_on: ['fetch'], tool_name: 'flexinfer__inference_chat' },
      ],
    });

    expect(mockHttp.post).toHaveBeenCalledWith('/api/v1/flows/import/loom', {
      name: 'Imported Loom Workflow',
      steps: [
        { id: 'fetch', name: 'Fetch', tool_name: 'k8s_apps_k3s__k8s_get' },
        { id: 'infer', name: 'Infer', depends_on: ['fetch'], tool_name: 'flexinfer__inference_chat' },
      ],
    }, { params: undefined });
  });

  it('exportFlowAsLoomWorkflow() gets workflow payload from /api/v1/flows/{id}/export/loom', async () => {
    mockHttp.get.mockResolvedValueOnce({
      name: 'Bridge Export Flow',
      steps: [
        { id: 'fetch', name: 'Fetch', tool_name: 'k8s_apps_k3s__k8s_get' },
        { id: 'infer', name: 'Infer', depends_on: ['fetch'], tool_name: 'flexinfer__inference_chat' },
      ],
    });

    const workflow = await svc.exportFlowAsLoomWorkflow('flow-bridge');

    expect(mockHttp.get).toHaveBeenCalledWith('/api/v1/flows/flow-bridge/export/loom', {
      params: undefined,
    });
    expect(workflow.name).toBe('Bridge Export Flow');
    expect(workflow.steps[1]?.depends_on).toEqual(['fetch']);
  });
});
