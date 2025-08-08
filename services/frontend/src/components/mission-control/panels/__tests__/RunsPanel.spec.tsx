// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RunsPanel from '../RunsPanel';

// Mock orchestratorService (module path relative to this test)
const mockCreateRun = vi.fn();
const mockGetRun = vi.fn();
const mockListCheckpoints = vi.fn();
const mockCancelRun = vi.fn();
const mockPostCheckpoint = vi.fn();

vi.mock('../../../../services/api', () => {
  return {
    orchestratorService: {
      createRun: mockCreateRun,
      getRun: mockGetRun,
      listCheckpoints: mockListCheckpoints,
      cancelRun: mockCancelRun,
      postCheckpoint: mockPostCheckpoint
    }
  };
});

// Mock OrchestratorSSE class used by RunsPanel
vi.mock('../../../../services/api/streaming/orchestratorSSE', () => {
  return {
    default: class MockOrchestratorSSE {
      handlers: any = {};
      constructor(config?: any) {
        // register for tests
        (globalThis as any).__MockSSEs = (globalThis as any).__MockSSEs || [];
        (globalThis as any).__MockSSEs.push(this);
      }
      connect(runId: string, handlers: any) {
        this.handlers = handlers || {};
        // simulate async open
        return Promise.resolve().then(() => {
          this.handlers.onOpen?.();
        });
      }
      emit(type: string, data: any) {
        if (type === 'hello') this.handlers.onHello?.(data);
        if (type === 'checkpoint') this.handlers.onCheckpoint?.(data);
        if (type === 'status') this.handlers.onStatus?.(data);
        this.handlers.onRaw?.({ type, data });
      }
      close() {
        (this as any)._closed = true;
      }
    }
  };
});

describe('RunsPanel (integration - mocked services/SSE)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).__MockSSEs = [];
  });

  it('initial render shows disconnected and no run', () => {
    render(<RunsPanel />);
    expect(screen.getByText('No checkpoints yet')).toBeTruthy();
    expect(screen.getByText(/SSE:/)).toBeTruthy();
    expect(screen.getByText('disconnected')).toBeTruthy();
    expect(screen.getByText(/Run:/)).toBeTruthy();
    expect(screen.getByText('no run loaded')).toBeTruthy();
  });

  it('creates a run, auto-connects SSE, handles checkpoint events and status update, and cancels run successfully', async () => {
    // Arrange mocks
    mockCreateRun.mockResolvedValueOnce({ runId: 'r1' });
    mockGetRun.mockResolvedValueOnce({ id: 'r1', mode: 'redis', createdAt: new Date().toISOString(), status: 'pending' });
    mockListCheckpoints.mockResolvedValueOnce([]).mockResolvedValueOnce([]); // initial and after post
    mockCancelRun.mockResolvedValueOnce({ status: 'canceled' });

    render(<RunsPanel />);

    // select 'redis' mode
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'redis' } });

    // click Create Run
    const createBtn = screen.getByText('Create Run');
    fireEvent.click(createBtn);

    // wait for createRun to be called and getRun/listCheckpoints to be awaited inside component
    await waitFor(() => expect(mockCreateRun).toHaveBeenCalled());

    // The mock SSE instance should have been created
    const sseInstances = (globalThis as any).__MockSSEs as any[];
    expect(sseInstances.length).toBeGreaterThanOrEqual(1);
    const sse = sseInstances[0];

    // After connect, SSE connected state should be updated (onOpen sets sseConnected true)
    await waitFor(() => expect(screen.getByText('connected')).toBeTruthy());

    // Emit a 'hello' event (component logs it but doesn't affect UI)
    sse.emit('hello', { runId: 'r1' });

    // Emit checkpoints: two items including a duplicate id to verify dedupe
    const now = new Date();
    const cp1 = { id: 'cp-1', runId: 'r1', ts: new Date(now.getTime() + 1).toISOString(), type: 'progress', data: { p: 10 } };
    const cpDup = { ...cp1 }; // duplicate id
    const cp2 = { id: 'cp-2', runId: 'r1', ts: new Date(now.getTime() + 2).toISOString(), type: 'progress', data: { p: 20 } };

    sse.emit('checkpoint', cp1);
    sse.emit('checkpoint', cpDup);
    sse.emit('checkpoint', cp2);

    // Check that checkpoints are rendered (deduped, so cp-1 and cp-2)
    await waitFor(() => {
      expect(screen.getByText(/cp-1/)).toBeTruthy();
      expect(screen.getByText(/cp-2/)).toBeTruthy();
    });

    // Emit status update -> should update displayed run status if currentRun present
    sse.emit('status', { runId: 'r1', status: 'canceled' });

    // Because component updates currentRun on status only if currentRun exists,
    // ensure the run display reflects canceled
    await waitFor(() => {
      expect(screen.getByText(/canceled/)).toBeTruthy();
    });

    // Now trigger cancel via UI (should call orchestratorService.cancelRun)
    const cancelBtn = screen.getByText('Cancel run');
    fireEvent.click(cancelBtn);

    await waitFor(() => expect(mockCancelRun).toHaveBeenCalledWith('r1'));

    // UI should reflect canceled status (the handler sets status from response)
    await waitFor(() => {
      expect(screen.getByText(/canceled/)).toBeTruthy();
    });
  });

  it('displays error alert when cancelRun returns 409', async () => {
    // Arrange mocks: create run, get run, list checkpoints
    mockCreateRun.mockResolvedValueOnce({ runId: 'r2' });
    mockGetRun.mockResolvedValueOnce({ id: 'r2', mode: 'redis', createdAt: new Date().toISOString(), status: 'running' });
    mockListCheckpoints.mockResolvedValueOnce([]);
    // cancelRun rejects with status 409
    const conflictErr: any = new Error('conflict');
    conflictErr.status = 409;
    mockCancelRun.mockRejectedValueOnce(conflictErr);

    // spy on window.alert
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<RunsPanel />);

    // select redis and create run
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'redis' } });
    const createBtn = screen.getByText('Create Run');
    fireEvent.click(createBtn);

    await waitFor(() => expect(mockCreateRun).toHaveBeenCalled());

    // Grab SSE instance and simulate open
    const sseInstances = (globalThis as any).__MockSSEs as any[];
    const sse = sseInstances[0];
    // Wait for UI to show connected
    await waitFor(() => expect(screen.getByText('connected')).toBeTruthy());

    // Click cancel - should trigger alert for 409
    const cancelBtn = screen.getByText('Cancel run');
    fireEvent.click(cancelBtn);

    await waitFor(() => expect(mockCancelRun).toHaveBeenCalled());

    expect(alertSpy).toHaveBeenCalledWith('Invalid status transition');

    alertSpy.mockRestore();
  });
});