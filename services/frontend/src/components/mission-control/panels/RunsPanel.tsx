import React, { useEffect, useRef, useState } from 'react';
import { orchestratorService } from '@/services/api';
import OrchestratorSSE from '@/services/api/streaming/orchestratorSSE';
import type { Run, Checkpoint, RunMode, RunStatus } from '@/types/orchestrator';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/utils'; // Assuming this exists, based on other files

/**
 * RunsPanel
 * 
 * Orchestrator Mission Control:
 * - Create and manage runs
 * - Live inspection via SSE
 * - Checkpoint timeline
 */

export default function RunsPanel(): JSX.Element {
  const [runIdInput, setRunIdInput] = useState<string>('');
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [mode, setMode] = useState<RunMode>('plan');
  const [creating, setCreating] = useState<boolean>(false);
  const [posting, setPosting] = useState<boolean>(false);
  
  // Use OrchestratorSSE helper via service factory
  const sseRef = useRef<OrchestratorSSE | null>(null);

  // Plan result view
  const [planResult, setPlanResult] = useState<any | null>(null);

  // Simple toast state
  const [toasts, setToasts] = useState<{ id: number; text: string; tone?: 'info' | 'error' | 'success' }[]>([]);
  const toastSeq = useRef(1);

  function showToast(text: string, tone: 'info' | 'error' | 'success' = 'info') {
    const id = toastSeq.current++;
    setToasts((t) => [...t, { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }

  // Auto-scroll timeline
  const checkpointsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (checkpointsRef.current) {
        checkpointsRef.current.scrollTop = checkpointsRef.current.scrollHeight;
    }
  }, [checkpoints]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      sseRef.current?.close();
    };
  }, []);

  async function handleCreateRun() {
    setCreating(true);
    try {
      const res = await orchestratorService.createRun(mode);
      const newRunId = res.runId || res.run_id || res.id;
      
      if (newRunId) {
        setRunIdInput(newRunId);
        setPlanResult(null);
        await refreshRun(newRunId);
        connectToRun(newRunId);
        showToast(`Run created: ${newRunId}`, 'success');
      } else if (res.mode === 'plan' && res.plan) {
        setPlanResult(res.plan);
        showToast('Plan generated successfully', 'info');
      }
    } catch (err: any) {
      console.error('Create run failed', err);
      showToast(err.message || 'Failed to create run', 'error');
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
    } catch (err: any) {
      console.error('Refresh failed', err);
      showToast('Failed to load run details', 'error');
    }
  }

  function connectToRun(runId: string) {
    disconnectSSE(); // ensure clean state
    
    // Use factory method from service
    const client = orchestratorService.streamRunEvents(runId, {
        onOpen: () => {
            setSseConnected(true);
            showToast('Connected to live stream', 'success');
        },
        onHello: (data: any) => {
            // Optional: verify runId matches
        },
        onCheckpoint: (cp: Checkpoint) => {
             setCheckpoints(prev => {
                if (prev.find(p => p.id === cp.id)) return prev;
                return [...prev, cp].sort((a,b) => a.ts.localeCompare(b.ts));
             });
        },
        onStatus: (data: { runId: string, status: string}) => {
             if (data.runId === runId) {
                 setCurrentRun(prev => prev ? { ...prev, status: data.status as RunStatus } : prev);
                 showToast(`Status update: ${data.status}`, 'info');
             }
        },
        onError: (err: any) => {
             console.warn('SSE Error', err);
             // Reconnect is automatic in client, but we show toast
        }
    });
    sseRef.current = client;
  }

  function disconnectSSE() {
    if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
        setSseConnected(false);
        showToast('Stream disconnected', 'info');
    }
  }

  async function handlePostCheckpoint() {
      if (!runIdInput) return;
      setPosting(true);
      try {
          await orchestratorService.postCheckpoint(runIdInput, {
              type: 'user_annotation',
              data: { note: 'Manual checkpoint', ts: Date.now() }
          });
          // Refresh list to be sure, though SSE should catch it
          const cps = await orchestratorService.listCheckpoints(runIdInput);
          setCheckpoints(cps);
          showToast('Checkpoint added', 'success');
      } catch (e: any) {
          showToast('Failed to post checkpoint', 'error');
      } finally {
          setPosting(false);
      }
  }

  async function handleCancelRun() {
      if (!runIdInput) return;
      try {
          const res = await orchestratorService.cancelRun(runIdInput);
          if (res.status) {
              setCurrentRun(prev => prev ? { ...prev, status: res.status } : prev);
              showToast(`Run cancelled: ${res.status}`, 'info');
          }
      } catch (err: any) {
          showToast('Cancel failed: ' + (err.message || 'unknown'), 'error');
      }
  }

  return (
    <div className="h-full flex flex-col gap-4 p-4">
      {/* Top Controls */}
      <Card className="flex-none p-3 flex flex-wrap gap-4 items-center bg-card/80">
        <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Mode</label>
            <Select 
                value={mode} 
                onChange={(e) => setMode(e.target.value as RunMode)}
                className="w-24 h-8 text-xs bg-muted/50 border-white/10"
            >
                <option value="plan">Plan</option>
                <option value="redis">Redis</option>
                <option value="k8s">K8s</option>
            </Select>
            <Button 
                size="sm" 
                variant="glow" 
                onClick={handleCreateRun} 
                disabled={creating}
                className="h-8 text-xs font-semibold"
            >
                {creating ? 'Creating...' : '+ New Run'}
            </Button>
        </div>
        
        <div className="h-6 w-px bg-white/10" />

        <div className="flex items-center gap-2 flex-1">
             <Input 
                size="sm"
                placeholder="Run ID..."
                value={runIdInput}
                onChange={(e) => setRunIdInput(e.target.value)}
                className="font-mono text-xs max-w-[240px]"
             />
             <Button 
                size="sm" 
                variant="secondary"
                onClick={() => { refreshRun(runIdInput); connectToRun(runIdInput); }}
                className="h-8 text-xs"
             >
                Connect
             </Button>
             {sseConnected && (
                 <Button size="sm" variant="ghost" onClick={disconnectSSE} className="h-8 text-xs text-red-400 hover:text-red-300">
                    Disconnect
                 </Button>
             )}
        </div>

        <div className="flex items-center gap-2 text-xs">
            <span className={cn("w-2 h-2 rounded-full", sseConnected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-zinc-600")} />
            <span className="text-muted-foreground">{sseConnected ? 'Live' : 'Offline'}</span>
        </div>
      </Card>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex gap-4">
            {/* Run Details & Checkpoints */}
            <Card className="flex-1 flex flex-col min-h-0 border-white/5 bg-black/20">
                <CardHeader className="py-2 px-3 border-white/5 flex flex-row justify-between items-center">
                    <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">Values</span>
                    {currentRun && (
                        <span className={cn(
                            "text-[10px] px-2 py-0.5 rounded-full border", 
                            currentRun.status === 'running' ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : 
                            currentRun.status === 'failed' ? "bg-red-500/10 text-red-400 border-red-500/20" : 
                            "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                        )}>
                            {currentRun.status.toUpperCase()}
                        </span>
                    )}
                </CardHeader>
                <div className="flex-1 overflow-auto p-0" ref={checkpointsRef}>
                    {checkpoints.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-muted-foreground/40 text-xs italic">
                            Waiting for events...
                        </div>
                    ) : (
                        <div className="flex flex-col font-mono text-xs">
                            {checkpoints.map((cp) => (
                                <div key={cp.id} className="border-b border-white/5 p-2 hover:bg-white/5 transition-colors group">
                                    <div className="flex justify-between items-baseline mb-1 opacity-60 group-hover:opacity-100">
                                        <span className="text-blue-400 font-semibold">{cp.type}</span>
                                        <span className="text-[10px]">{new Date(cp.ts).toLocaleTimeString()}</span>
                                    </div>
                                    <pre className="whitespace-pre-wrap break-all text-zinc-300 opacity-80 pl-2 border-l-2 border-white/10">
                                        {JSON.stringify(cp.data, null, 2)}
                                    </pre>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="p-2 border-t border-white/5 bg-zinc-950/30 flex gap-2">
                     <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={handlePostCheckpoint} disabled={posting || !runIdInput}>
                        + Annotation
                     </Button>
                     <Button size="sm" variant="destructive" className="h-7 text-[10px] ml-auto" onClick={handleCancelRun} disabled={!runIdInput}>
                        Cancel Run
                     </Button>
                </div>
            </Card>
      </div>

      {/* Local Toasts */}
      <div className="absolute bottom-6 right-6 flex flex-col gap-2 pointer-events-none z-50">
           {toasts.map(t => (
               <div key={t.id} className={cn(
                   "bg-zinc-900 border text-xs px-3 py-2 rounded shadow-xl animate-in slide-in-from-bottom-2 fade-in",
                   t.tone === 'error' ? "border-red-500/50 text-red-200" : 
                   t.tone === 'success' ? "border-emerald-500/50 text-emerald-200" : 
                   "border-zinc-700 text-zinc-200"
               )}>
                   {t.text}
               </div>
           ))}
      </div>
    </div>
  );
}