import React, { useEffect, useRef, useState } from 'react';
import { orchestratorService } from '@/services/api';
import OrchestratorSSE from '@/services/api/streaming/orchestratorSSE';
import type { Run, Checkpoint, RunMode } from '@/types/orchestrator';

/**
 * RunsPanel
 *
 * Minimal Mission Control panel for orchestrator:
 * - Create a run (mode: plan|redis|k8s)
 * - Connect to a run's SSE stream to see hello/status/checkpoint events in real time
 * - Post a simple "progress" checkpoint
 * - Cancel a run
 *
 * This component is intentionally self-contained and uses the orchestratorService + OrchestratorSSE helper.
 */

export default function RunsPanel(): JSX.Element {
  const [runIdInput, setRunIdInput] = useState<string>('');
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [mode, setMode] = useState<RunMode>('plan');
  const [creating, setCreating] = useState<boolean>(false);
  const [posting, setPosting] = useState<boolean>(false);
  const sseRef = useRef<OrchestratorSSE | null>(null);

  useEffect(() => {
    // cleanup on unmount
    return () => {
      sseRef.current?.close();
    };
  }, []);

  async function handleCreateRun() {
    setCreating(true);
    try {
      const res = await orchestratorService.createRun(mode);
      if (res.runId) {
        setRunIdInput(res.runId);
        // If plan mode, server returns plan instead of runId
        // For plan mode we just show the plan in console
        if (mode === 'plan') {
          // plan returned in res.plan
          // no run created
          // keep currentRun null
        } else {
          // fetch run and checkpoints
          const run = await orchestratorService.getRun(res.runId as string);
          setCurrentRun(run);
          const cps = await orchestratorService.listCheckpoints(res.runId as string);
          setCheckpoints(cps);
          // auto-connect SSE
          connectToRun(res.runId as string);
        }
      } else if (res.mode === 'plan' && res.plan) {
        // show plan in console for now
        console.info('Plan:', res.plan);
      }
    } catch (err) {
      console.error('createRun error', err);
      alert('Failed to create run: ' + String(err));
    } finally {
      setCreating(false);
    }
  }

  async function refreshRun(runId: string) {
    try {
      const run = await orchestratorService.getRun(runId);
      setCurrentRun(run);
      const cps = await orchestratorService.listCheckpoints(runId);
      setCheckpoints(cps);
    } catch (err) {
      console.error('refreshRun error', err);
    }
  }

  function connectToRun(runId: string) {
    // close existing
    sseRef.current?.close();
    const client = new OrchestratorSSE({ replay: 10, debug: false });
    sseRef.current = client;

    client.connect(runId, {
      onOpen: () => {
        setSseConnected(true);
      },
      onHello: (data) => {
        console.debug('SSE hello', data);
      },
      onCheckpoint: (cp) => {
        setCheckpoints((prev) => {
          // avoid duplicates by id
          if (prev.find((p) => p.id === cp.id)) return prev;
          return [...prev, cp].sort((a, b) => (a.ts > b.ts ? 1 : -1));
        });
      },
      onStatus: (data) => {
        // update run status if matches
        if (currentRun && data.runId === currentRun.id) {
          setCurrentRun((r) => (r ? { ...r, status: data.status as Run['status'] } : r));
        }
      },
      onError: (err) => {
        console.warn('SSE error', err);
      },
      onRaw: () => {
        // noop
      }
    }).catch((err) => {
      console.error('SSE connect failed', err);
    });
  }

  function disconnectSSE() {
    sseRef.current?.close();
    sseRef.current = null;
    setSseConnected(false);
  }

  async function handleConnectClick() {
    if (!runIdInput) {
      alert('Enter a runId to connect');
      return;
    }
    try {
      await refreshRun(runIdInput);
      connectToRun(runIdInput);
    } catch (err) {
      console.error(err);
    }
  }

  async function handlePostCheckpoint() {
    if (!runIdInput) {
      alert('Enter runId first');
      return;
    }
    setPosting(true);
    try {
      const payload = { type: 'progress', data: { percent: Math.floor(Math.random() * 100) } };
      const res = await orchestratorService.postCheckpoint(runIdInput, payload);
      // refresh checkpoints (SSE will push too)
      const cps = await orchestratorService.listCheckpoints(runIdInput);
      setCheckpoints(cps);
      return res;
    } catch (err) {
      console.error('postCheckpoint error', err);
      alert('Failed to post checkpoint');
    } finally {
      setPosting(false);
    }
  }

  async function handleCancelRun() {
    if (!runIdInput) {
      alert('Enter runId first');
      return;
    }
    try {
      const res = await orchestratorService.cancelRun(runIdInput);
      if (res && res.status) {
        setCurrentRun((r) => (r ? { ...r, status: res.status } : r));
      }
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 409) {
        alert('Invalid status transition');
      } else if (status === 404) {
        alert('Run not found');
      } else {
        alert('Failed to cancel run');
      }
    }
  }

  return (
    <div style={{ padding: 12, border: '1px solid #ddd', borderRadius: 6, background: '#fff' }}>
      <h3>Orchestrator — Runs</h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <select value={mode} onChange={(e) => setMode(e.target.value as RunMode)}>
          <option value="plan">plan</option>
          <option value="redis">redis</option>
          <option value="k8s">k8s</option>
        </select>
        <button onClick={handleCreateRun} disabled={creating}>
          {creating ? 'Creating...' : 'Create Run'}
        </button>

        <input
          placeholder="run id"
          value={runIdInput}
          onChange={(e) => setRunIdInput(e.target.value)}
          style={{ width: 300 }}
        />
        <button onClick={handleConnectClick}>Connect</button>
        <button onClick={disconnectSSE} disabled={!sseConnected}>
          Disconnect
        </button>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>SSE:</strong> {sseConnected ? 'connected' : 'disconnected'}
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>Run:</strong>{' '}
        {currentRun ? (
          <span>
            {currentRun.id} — {currentRun.mode} — <em>{currentRun.status}</em>
          </span>
        ) : (
          <em>no run loaded</em>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <button onClick={handlePostCheckpoint} disabled={posting || !runIdInput}>
          {posting ? 'Posting...' : 'Post progress checkpoint'}
        </button>
        <button onClick={handleCancelRun} disabled={!runIdInput}>
          Cancel run
        </button>
      </div>

      <div>
        <h4>Checkpoints</h4>
        <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #eee', padding: 8 }}>
          {checkpoints.length === 0 ? (
            <div style={{ color: '#666' }}>No checkpoints yet</div>
          ) : (
            checkpoints.map((cp) => (
              <div key={cp.id} style={{ padding: 6, borderBottom: '1px solid #f4f4f4' }}>
                <div style={{ fontSize: 12, color: '#888' }}>{new Date(cp.ts).toLocaleString()}</div>
                <div>
                  <strong>{cp.type}</strong> — <span style={{ fontFamily: 'monospace' }}>{cp.id}</span>
                </div>
                {cp.data ? (
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 6 }}>
                    {JSON.stringify(cp.data, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}