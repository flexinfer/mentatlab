// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the orchestrator base URL helper to avoid import.meta.env
vi.mock('@/config/orchestrator', () => ({
  getOrchestratorBaseUrl: () => 'http://orch.test'
}));

// Hoisted mock so it can be referenced in the vi.mock factory below
const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn()
  }
}));

// Mock the apiService module (default export)
vi.mock('../apiService', () => ({
  default: { httpClient: mockClient }
}));

// Import the module under test after mocks are in place
import orchestratorService from '../orchestratorService';

// The service now appends /api/v1, so the base is http://orch.test/api/v1
const BASE = 'http://orch.test/api/v1';

describe('OrchestratorService (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listRuns() returns runs array and calls correct URL', async () => {
    const run = { id: 'r1', mode: 'redis', createdAt: new Date().toISOString(), status: 'queued' };
    mockClient.get.mockResolvedValueOnce({ data: { runs: [run] } });

    const res = await orchestratorService.listRuns();
    expect(Array.isArray(res)).toBe(true);
    expect(res[0].id).toBe('r1');

    // ensure correct URL used (now includes /api/v1)
    expect(mockClient.get).toHaveBeenCalled();
    const calledUrl = String(mockClient.get.mock.calls[0][0]);
    expect(calledUrl).toBe(`${BASE}/runs`);
  });

  it('getRun() returns run object from /runs/:id', async () => {
    const run = { id: 'r2', mode: 'redis', createdAt: new Date().toISOString(), status: 'running' };
    mockClient.get.mockResolvedValueOnce({ data: { run } });

    const res = await orchestratorService.getRun('r2');
    expect(res.id).toBe('r2');

    const calledUrl = String(mockClient.get.mock.calls[0][0]);
    expect(calledUrl).toBe(`${BASE}/runs/r2`);
  });

  it('listCheckpoints() returns checkpoints array', async () => {
    const cps = [{ id: 'c1', runId: 'r1', ts: new Date().toISOString(), type: 'progress' }];
    mockClient.get.mockResolvedValueOnce({ data: { checkpoints: cps } });

    const res = await orchestratorService.listCheckpoints('r1');
    expect(Array.isArray(res)).toBe(true);
    expect(res[0].id).toBe('c1');

    const calledUrl = String(mockClient.get.mock.calls[0][0]);
    expect(calledUrl).toBe(`${BASE}/runs/r1/checkpoints`);
  });

  it('postCheckpoint() posts payload and returns checkpointId', async () => {
    mockClient.post.mockResolvedValueOnce({ data: { checkpointId: 'cp-123' } });

    const res = await orchestratorService.postCheckpoint('r1', { type: 'progress', data: { n: 1 } });
    expect(res.checkpointId).toBe('cp-123');

    const calledUrl = String(mockClient.post.mock.calls[0][0]);
    expect(calledUrl).toBe(`${BASE}/runs/r1/checkpoints`);
  });

  it('createRun() calls POST /runs and returns runId for non-plan', async () => {
    mockClient.post.mockResolvedValueOnce({ data: { runId: 'r-create-1' } });

    const res = await orchestratorService.createRun('redis');
    expect(res.runId).toBe('r-create-1');

    const calledUrl = String(mockClient.post.mock.calls[0][0]);
    expect(calledUrl).toBe(`${BASE}/runs`);
  });

  it('cancelRun() success returns status via POST cancel endpoint', async () => {
    // cancelRun now POSTs to /runs/{id}/cancel first
    mockClient.post.mockResolvedValueOnce({ data: { status: 'cancelled' } });

    const res = await orchestratorService.cancelRun('r1');
    expect(res.status).toBe('cancelled');

    const calledUrl = String(mockClient.post.mock.calls[0][0]);
    expect(calledUrl).toBe(`${BASE}/runs/r1/cancel`);
  });

  it('cancelRun() falls back to DELETE when POST returns 404', async () => {
    // POST cancel returns 404, then falls back to DELETE
    const notFoundErr: any = new Error('not found');
    notFoundErr.status = 404;
    mockClient.post.mockRejectedValueOnce(notFoundErr);
    mockClient.delete.mockResolvedValueOnce({ data: { status: 'cancelled' } });

    const res = await orchestratorService.cancelRun('r1');
    expect(res.status).toBe('cancelled');

    // Verify POST was tried first
    const postUrl = String(mockClient.post.mock.calls[0][0]);
    expect(postUrl).toBe(`${BASE}/runs/r1/cancel`);

    // Then DELETE fallback
    const deleteUrl = String(mockClient.delete.mock.calls[0][0]);
    expect(deleteUrl).toBe(`${BASE}/runs/r1`);
  });

  it('cancelRun() propagates non-404/405 errors from POST', async () => {
    const err: any = new Error('conflict');
    err.status = 409;
    mockClient.post.mockRejectedValueOnce(err);

    await expect(orchestratorService.cancelRun('badstate')).rejects.toMatchObject({ status: 409 });
  });
});
