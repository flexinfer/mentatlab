package scheduler

import (
	"context"
	"log/slog"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/metrics"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// handleRunTimeout cancels active tasks and marks the run as failed due to timeout.
func (s *Scheduler) handleRunTimeout(ctx context.Context, rctx *runContext, err error) {
	_, span := tracer.Start(context.Background(), "scheduler.handleRunTimeout",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
		),
	)
	defer span.End()

	reason := "timeout"
	if err == context.Canceled {
		reason = "cancelled"
	}
	span.SetAttributes(attribute.String("reason", reason))
	if rctx.planTimeout > 0 {
		span.SetAttributes(attribute.String("timeout_duration", rctx.planTimeout.String()))
	}

	s.logger.Warn("run terminated",
		slog.String("run_id", rctx.runID),
		slog.String("reason", reason),
	)

	// Cancel all active node tasks
	rctx.tasksMu.Lock()
	for _, cancel := range rctx.tasks {
		cancel()
	}
	rctx.tasksMu.Unlock()

	// Close all gate channels
	rctx.gatesMu.Lock()
	for nodeID, ch := range rctx.gates {
		close(ch)
		delete(rctx.gates, nodeID)
	}
	rctx.gatesMu.Unlock()

	// Use background context since the run context may be expired
	bgCtx := context.Background()

	finishedAt := utcISO()
	s.store.UpdateRunStatus(bgCtx, rctx.runID, types.RunStatusFailed, nil, &finishedAt)
	s.emitEvent(bgCtx, rctx.runID, "status", map[string]interface{}{
		"runId":  rctx.runID,
		"status": "failed",
		"reason": reason,
	}, "", "")

	metrics.RunsActive.Dec()
	metrics.RunsTotal.WithLabelValues("failed").Inc()

	// Cleanup
	s.runsMu.Lock()
	delete(s.runs, rctx.runID)
	s.runsMu.Unlock()
}

// checkRunCompletion determines if the run is complete and emits final status.
func (s *Scheduler) checkRunCompletion(ctx context.Context, rctx *runContext) bool {
	_, span := tracer.Start(ctx, "scheduler.checkRunCompletion",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
			attribute.Int("node_count", len(rctx.nodeSpecs)),
		),
	)
	defer span.End()

	// Check cancelled
	rctx.cancelledMu.Lock()
	cancelled := rctx.cancelled
	rctx.cancelledMu.Unlock()

	rctx.tasksMu.Lock()
	activeTasks := len(rctx.tasks)
	rctx.tasksMu.Unlock()

	if cancelled && activeTasks == 0 {
		span.SetAttributes(attribute.String("final_status", "cancelled"))
		finishedAt := utcISO()
		s.store.UpdateRunStatus(ctx, rctx.runID, types.RunStatusFailed, nil, &finishedAt)
		s.emitRunStatus(ctx, rctx.runID, "failed")
		s.fireWebhookCallback(ctx, rctx.runID)
		// Note: metrics for cancelled runs are recorded in CancelRun
		return true
	}

	// Check all node states
	var running, pending, failed, succeeded, waiting, skipped int
	for nodeID := range rctx.nodeSpecs {
		state, err := s.store.GetNodeState(ctx, rctx.runID, nodeID)
		if err != nil {
			pending++
			continue
		}
		switch state.Status {
		case types.NodeStatusRunning:
			running++
		case types.NodeStatusPending, "queued":
			pending++
		case types.NodeStatusFailed:
			failed++
		case types.NodeStatusSucceeded:
			succeeded++
		case types.NodeStatusSkipped:
			skipped++
		case types.NodeStatusWaitingApproval:
			waiting++
		}
	}

	total := len(rctx.nodeSpecs)

	// All nodes resolved (succeeded + skipped)
	if succeeded+skipped == total {
		span.SetAttributes(attribute.String("final_status", "succeeded"))
		finishedAt := utcISO()
		s.store.UpdateRunStatus(ctx, rctx.runID, types.RunStatusSucceeded, nil, &finishedAt)
		s.emitRunStatus(ctx, rctx.runID, "succeeded")
		s.fireWebhookCallback(ctx, rctx.runID)
		metrics.RunsActive.Dec()
		metrics.RunsTotal.WithLabelValues("succeeded").Inc()
		return true
	}

	// Failed with no hope of completion (no running, pending, or waiting nodes)
	if failed > 0 && running == 0 && pending == 0 && waiting == 0 {
		span.SetAttributes(attribute.String("final_status", "failed"))
		finishedAt := utcISO()
		s.store.UpdateRunStatus(ctx, rctx.runID, types.RunStatusFailed, nil, &finishedAt)
		s.emitRunStatus(ctx, rctx.runID, "failed")
		s.fireWebhookCallback(ctx, rctx.runID)
		metrics.RunsActive.Dec()
		metrics.RunsTotal.WithLabelValues("failed").Inc()
		return true
	}

	return false
}
