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

  // Plan (when mode=plan) returned by createRun
  const [planResult, setPlanResult] = useState<any | null>(null);

  // Lightweight in-panel toasts (replace alert())
  const [toasts, setToasts] = useState<{ id: number; text: string; tone?: 'info' | 'error' | 'success' }[]>([]);
  const toastSeq = useRef(1);
  function showToast(text: string, tone: 'info' | 'error' | 'success' = 'info') {
    const id = toastSeq.current++;
    setToasts((t) => [...t, { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }

  // Checkpoints container ref for auto-scroll
  const checkpointsContainerRef = useRef<HTMLDivElement | null>(null);
  // Auto-scroll when new checkpoints arrive
  useEffect(() => {
    if (!checkpointsContainerRef.current) return;
    const el = checkpointsContainerRef.current;
    // scroll to bottom smoothly
    el.scrollTop = el.scrollHeight;
  }, [checkpoints]);

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
        setPlanResult(null);
        // If plan mode, server returns plan instead of runId
        if (mode === 'plan') {
          // Some servers may still return a runId even for plan; tolerate both.
        }
        // fetch run and checkpoints
        const run = await orchestratorService.getRun(res.runId as string);
        setCurrentRun(run);
        const cps = await orchestratorService.listCheckpoints(res.runId as string);
        setCheckpoints(cps);
        // auto-connect SSE
        connectToRun(res.runId as string);
        showToast('Run created: ' + String(res.runId), 'success');
      } else if (res.mode === 'plan' && res.plan) {
        // show plan inline
        setPlanResult(res.plan);
        showToast('Plan generated (mode=plan)', 'info');
      }
    } catch (err) {
      console.error('createRun error', err);
      showToast('Failed to create run: ' + String(err), 'error');
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
        // connection established
        setSseConnected(true);
        showToast('SSE connected', 'success');
      },
      onHello: (data) => {
        console.debug('SSE hello', data);
        showToast('SSE hello for ' + data.runId, 'info');
      },
      onCheckpoint: (cp) => {
        setCheckpoints((prev) => {
          // avoid duplicates by id
          if (prev.find((p) => p.id === cp.id)) return prev;
          const next = [...prev, cp].sort((a, b) => (a.ts > b.ts ? 1 : -1));
          return next;
        });
      },
      onStatus: (data) => {
        // update run status if matches
        if (currentRun && data.runId === currentRun.id) {
          setCurrentRun((r) => (r ? { ...r, status: data.status as Run['status'] } : r));
          showToast(`Run ${data.runId} status: ${data.status}`, 'info');
        }
      },
      onError: (err) => {
        console.warn('SSE error', err);
        showToast('SSE error: ' + String(err), 'error');
      },
      onRaw: () => {
        // noop
      }
    }).catch((err) => {
      console.error('SSE connect failed', err);
      showToast('SSE connect failed: ' + String(err), 'error');
    });
  }

  function disconnectSSE() {
    sseRef.current?.close();
    sseRef.current = null;
    setSseConnected(false);
    showToast('Disconnected SSE', 'info');
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
        showToast('Posted checkpoint', 'success');
        return res;
      } catch (err) {
        console.error('postCheckpoint error', err);
        showToast('Failed to post checkpoint: ' + String(err), 'error');
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
        showToast(`Run canceled: ${res.status}`, 'success');
      }
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status;
      if (status === 409) {
        showToast('Invalid status transition', 'error');
      } else if (status === 404) {
        showToast('Run not found', 'error');
      } else {
        showToast('Failed to cancel run: ' + String(err), 'error');
      }
    }
  }

  return (
    <div className="p-3 border rounded bg-card" style={{ borderColor: 'hsl(var(--border))' }}>
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

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong>SSE:</strong>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 10,
              display: 'inline-block',
              background: sseConnected ? '#10b981' : '#cbd5e1'
            }}
            title={sseConnected ? 'connected' : 'disconnected'}
          />
          <span>{sseConnected ? 'connected' : 'disconnected'}</span>
        </span>
      </div>

      <div style={{ marginBottom: 8 }}>
        <strong>Run:</strong>{' '}
        {currentRun ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span>
              <strong style={{ fontFamily: 'monospace' }}>{currentRun.id}</strong> — {currentRun.mode} — <em>{currentRun.status}</em>
            </span>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(currentRun.id);
                  showToast('Copied runId to clipboard', 'success');
                } catch {
                  showToast('Failed to copy runId', 'error');
                }
              }}
              style={{ padding: '4px 8px', fontSize: 12 }}
            >
              Copy runId
            </button>
          </span>
        ) : (
          <em>no run loaded</em>
        )}
      </div>

      <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={handlePostCheckpoint} disabled={posting || !runIdInput}>
          {posting ? 'Posting...' : 'Post progress checkpoint'}
        </button>
        <button onClick={handleCancelRun} disabled={!runIdInput}>
          Cancel run
        </button>
        <button
          onClick={() => {
            // export checkpoints as JSON file
            try {
              const blob = new Blob([JSON.stringify(checkpoints, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${runIdInput || currentRun?.id || 'checkpoints'}.json`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              showToast('Exported checkpoints', 'success');
            } catch (e) {
              showToast('Failed to export checkpoints', 'error');
            }
          }}
          disabled={checkpoints.length === 0}
        >
          Export checkpoints (JSON)
        </button>
        <button
          onClick={() => {
            setCheckpoints([]);
            showToast('Cleared local checkpoint list', 'info');
          }}
          disabled={checkpoints.length === 0}
        >
          Clear list
        </button>
      </div>

      <div>
        <h4>Checkpoints</h4>
        <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #eee', padding: 8 }}>
          {checkpoints.length === 0 ? (
            <div style={{ color: '#666' }}>No checkpoints yet</div>
          ) : (
            checkpoints.map((cp) => (
              <div key={cp.id} className="px-2 py-2 border-b last:border-b-0">
                <div className="text-[12px] text-gray-400">{new Date(cp.ts).toLocaleString()}</div>
                <div>
                  <strong>{cp.type}</strong> — <span className="font-mono">{cp.id}</span>
                </div>
                {cp.data ? (
                  <pre className="mt-1 text-[12px] whitespace-pre-wrap bg-muted/50 dark:bg-muted/20 rounded p-2 overflow-auto">
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