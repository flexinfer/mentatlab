package runstore

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// RunRecoveryReason is the reason recorded on runs/nodes failed by startup
// recovery.
const RunRecoveryReason = "orchestrator_restart"

// RecoverInterruptedRuns reconciles runs left in a non-terminal state by a
// previous orchestrator process. The in-process scheduler and agent
// subprocesses do not survive a restart, so such runs cannot continue; left
// alone they remain "running" forever (an orphaned zombie). This marks each
// interrupted run — and any of its still-in-flight nodes — failed with a
// reason and emits a terminal "status" event so live subscribers learn the
// outcome instead of hanging on a run that will never progress.
//
// It assumes a single active orchestrator, which is the default deployment.
// With multiple replicas sharing one store this would incorrectly fail runs
// owned by a peer, so gate it before enabling multi-replica execution.
//
// Returns the number of runs recovered. A nil/empty store (e.g. a fresh
// in-memory store) simply yields zero.
func RecoverInterruptedRuns(ctx context.Context, store RunStore, logger *slog.Logger) (int, error) {
	if logger == nil {
		logger = slog.Default()
	}

	ids, err := store.ListRuns(ctx)
	if err != nil {
		return 0, fmt.Errorf("list runs: %w", err)
	}

	recovered := 0
	for _, id := range ids {
		run, err := store.GetRun(ctx, id)
		if err != nil {
			logger.Warn("run recovery: failed to load run", "run_id", id, "error", err)
			continue
		}
		if run == nil || isTerminalRunStatus(run.Status) {
			continue
		}

		// Fail any node still in flight so node-level views stay consistent
		// with the run's terminal state.
		if run.Plan != nil {
			for i := range run.Plan.Nodes {
				nodeID := run.Plan.Nodes[i].ID
				ns, nerr := store.GetNodeState(ctx, id, nodeID)
				if nerr != nil || ns == nil || isTerminalNodeStatus(ns.Status) {
					continue
				}
				ns.Status = types.NodeStatusFailed
				ns.Error = "orchestrator restarted before node completion"
				finished := time.Now().UTC()
				ns.FinishedAt = &finished
				if uerr := store.UpdateNodeState(ctx, id, nodeID, ns); uerr != nil {
					logger.Warn("run recovery: failed to fail node",
						"run_id", id, "node_id", nodeID, "error", uerr)
				}
			}
		}

		finishedAt := time.Now().UTC().Format(time.RFC3339)
		if err := store.UpdateRunStatus(ctx, id, types.RunStatusFailed, nil, &finishedAt); err != nil {
			logger.Warn("run recovery: failed to mark run failed", "run_id", id, "error", err)
			continue
		}

		// Mirror the scheduler's terminal "status" event shape so SSE clients
		// observe the failure and its reason.
		if _, err := store.AppendEvent(ctx, id, &types.EventInput{
			Type: types.EventType("status"),
			Data: map[string]interface{}{
				"runId":  id,
				"status": string(types.RunStatusFailed),
				"reason": RunRecoveryReason,
			},
		}); err != nil {
			logger.Warn("run recovery: failed to emit terminal event", "run_id", id, "error", err)
		}

		recovered++
		logger.Warn("run recovery: marked interrupted run failed",
			"run_id", id, "previous_status", string(run.Status), "reason", RunRecoveryReason)
	}

	if recovered > 0 {
		logger.Warn("run recovery complete", "recovered_runs", recovered)
	}
	return recovered, nil
}

func isTerminalRunStatus(s types.RunStatus) bool {
	switch s {
	case types.RunStatusSucceeded, types.RunStatusFailed, types.RunStatusCancelled:
		return true
	default:
		return false
	}
}

func isTerminalNodeStatus(s types.NodeStatus) bool {
	switch s {
	case types.NodeStatusSucceeded, types.NodeStatusFailed, types.NodeStatusSkipped:
		return true
	default:
		return false
	}
}
