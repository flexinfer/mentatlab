package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/metrics"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// scheduleNode starts execution of a single node.
func (s *Scheduler) scheduleNode(ctx context.Context, rctx *runContext, nodeID string, spec *types.NodeSpec, attempts int, startTime time.Time) {
	_, span := tracer.Start(ctx, "scheduler.scheduleNode",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
			attribute.String("node_id", nodeID),
			attribute.Int("attempt", attempts+1),
		),
	)
	defer span.End()

	// Create cancellable context for this node
	nodeCtx, cancel := context.WithCancel(ctx)

	rctx.tasksMu.Lock()
	rctx.tasks[nodeID] = cancel
	rctx.tasksMu.Unlock()

	// Update node state to running
	startedAt := startTime
	state := &types.NodeState{
		NodeID:    nodeID,
		Status:    types.NodeStatusRunning,
		StartedAt: &startedAt,
		Retries:   attempts,
	}
	if err := s.store.UpdateNodeState(ctx, rctx.runID, nodeID, state); err != nil {
		s.logger.Error("failed to update node state", slog.String("run_id", rctx.runID), slog.String("node_id", nodeID), slog.Any("error", err))
	}

	// Execute in goroutine
	go func() {
		defer func() {
			rctx.tasksMu.Lock()
			delete(rctx.tasks, nodeID)
			rctx.tasksMu.Unlock()
		}()

		// Acquire semaphore if parallelism limited
		if s.sem != nil {
			select {
			case s.sem <- struct{}{}:
				defer func() { <-s.sem }()
			case <-nodeCtx.Done():
				return
			}
		}

		// Dispatch based on node type
		if spec.IsControlFlow() {
			// Gate nodes have special handling — they block until approval
			if spec.Gate != nil {
				s.executeGate(nodeCtx, rctx, nodeID, spec)
				return
			}

			var err error
			switch {
			case spec.Conditional != nil:
				err = s.executeConditional(ctx, rctx, spec)
			case spec.ForEach != nil:
				err = s.executeForEach(ctx, rctx, spec)
			// Subflow not yet implemented
			default:
				err = fmt.Errorf("unknown control flow type for node %s", nodeID)
			}

			exitCode := 0
			if err != nil {
				s.logger.Error("control flow execution failed",
					slog.String("run_id", rctx.runID),
					slog.String("node_id", nodeID),
					slog.Any("error", err))
				exitCode = 1
			}
			s.onNodeFinished(ctx, rctx, nodeID, exitCode)
			return
		}

		// Regular agent node - resolve command
		cmd := s.resolveCmd(spec)
		if len(cmd) == 0 {
			// No command - skip this node
			s.onNodeFinished(ctx, rctx, nodeID, 0)
			return
		}

		// Build env
		env := make(map[string]string)
		for k, v := range spec.Env {
			env[k] = v
		}
		env["ATTEMPT"] = fmt.Sprintf("%d", attempts+1)
		// Pass image to driver so K8s driver can use it for the Job container.
		if spec.Image != "" {
			env["AGENT_IMAGE"] = spec.Image
		}

		// Calculate timeout
		timeout := 0.0
		if spec.Timeout > 0 {
			timeout = spec.Timeout.Seconds()
		}

		// Run via driver
		exitCode, err := s.driver.RunNode(nodeCtx, rctx.runID, nodeID, cmd, env, timeout)
		if err != nil {
			s.logger.Error("driver execution failed", slog.String("run_id", rctx.runID), slog.String("node_id", nodeID), slog.Any("error", err))
			exitCode = 1
		}

		// Capture agent outputs for downstream data flow
		if exitCode == 0 {
			s.captureNodeOutputs(ctx, rctx.runID, nodeID)
		}

		s.onNodeFinished(ctx, rctx, nodeID, exitCode)
	}()
}

// onNodeFinished handles node completion - success, failure, or retry.
func (s *Scheduler) onNodeFinished(ctx context.Context, rctx *runContext, nodeID string, exitCode int) {
	_, span := tracer.Start(ctx, "scheduler.onNodeFinished",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
			attribute.String("node_id", nodeID),
			attribute.Int("exit_code", exitCode),
		),
	)
	defer span.End()

	spec := rctx.nodeSpecs[nodeID]
	finishedAt := time.Now().UTC()

	// Get current state for attempt count
	state, _ := s.store.GetNodeState(ctx, rctx.runID, nodeID)
	attempts := 0
	if state != nil {
		attempts = state.Retries
	}

	if exitCode == 0 {
		// Success - update state and unlock downstream
		newState := &types.NodeState{
			NodeID:     nodeID,
			Status:     types.NodeStatusSucceeded,
			FinishedAt: &finishedAt,
			ExitCode:   &exitCode,
			Retries:    attempts,
		}
		if state != nil && state.StartedAt != nil {
			newState.StartedAt = state.StartedAt
			duration := finishedAt.Sub(*state.StartedAt).Seconds()
			metrics.NodeDuration.WithLabelValues("succeeded").Observe(duration)
		}
		s.store.UpdateNodeState(ctx, rctx.runID, nodeID, newState)
		metrics.NodesTotal.WithLabelValues("succeeded").Inc()
		metrics.NodeRetries.WithLabelValues("succeeded").Observe(float64(attempts))

		// Unlock downstream nodes
		for downstream := range rctx.dependents[nodeID] {
			rctx.remainingPreds[downstream]--
		}
	} else {
		// Failure - check if we should retry
		maxRetries, backoffSec := s.resolveRetryPolicy(spec, attempts)
		willRetry := attempts < maxRetries
		span.SetAttributes(attribute.Bool("will_retry", willRetry))
		if willRetry {
			// Update state back to pending for retry
			newState := &types.NodeState{
				NodeID:     nodeID,
				Status:     types.NodeStatusPending,
				FinishedAt: &finishedAt,
				ExitCode:   &exitCode,
				Retries:    attempts + 1,
				Error:      fmt.Sprintf("exit_code=%d, retry in %.0fs", exitCode, backoffSec),
			}
			s.store.UpdateNodeState(ctx, rctx.runID, nodeID, newState)

			// Emit queued status with retry info
			s.emitNodeStatus(ctx, rctx.runID, nodeID, "queued", map[string]interface{}{
				"attempts": attempts + 1,
				"retryIn":  backoffSec,
			})

			// Schedule retry after backoff
			go func() {
				time.Sleep(time.Duration(backoffSec) * time.Second)
				// Re-check if still should retry
				rctx.cancelledMu.Lock()
				cancelled := rctx.cancelled
				rctx.cancelledMu.Unlock()
				if !cancelled {
					s.maybeScheduleReady(ctx, rctx)
				}
			}()
		} else {
			// Permanent failure
			newState := &types.NodeState{
				NodeID:     nodeID,
				Status:     types.NodeStatusFailed,
				FinishedAt: &finishedAt,
				ExitCode:   &exitCode,
				Retries:    attempts,
				Error:      fmt.Sprintf("exit_code=%d", exitCode),
			}
			if state != nil && state.StartedAt != nil {
				newState.StartedAt = state.StartedAt
				duration := finishedAt.Sub(*state.StartedAt).Seconds()
				metrics.NodeDuration.WithLabelValues("failed").Observe(duration)
			}
			s.store.UpdateNodeState(ctx, rctx.runID, nodeID, newState)
			metrics.NodesTotal.WithLabelValues("failed").Inc()
			metrics.NodeRetries.WithLabelValues("failed").Observe(float64(attempts))
		}
	}
}

// resolveRetryPolicy returns the max retries and backoff seconds for a node.
// Per-node RetryPolicy takes precedence over the legacy Retries field and global defaults.
func (s *Scheduler) resolveRetryPolicy(spec *types.NodeSpec, attempt int) (maxRetries int, backoffSec float64) {
	if spec.RetryPolicy != nil {
		rp := spec.RetryPolicy
		maxRetries = rp.MaxRetries

		base := rp.BackoffBase.Seconds()
		if base <= 0 {
			base = float64(s.defaultBackoffSecs)
		}
		maxBackoff := rp.BackoffMax.Seconds()
		if maxBackoff <= 0 {
			maxBackoff = 60
		}

		switch rp.BackoffType {
		case types.BackoffFixed:
			backoffSec = base
		case types.BackoffLinear:
			backoffSec = base * float64(attempt+1)
		default: // exponential (default)
			backoffSec = base * math.Pow(2, float64(attempt))
		}

		if backoffSec > maxBackoff {
			backoffSec = maxBackoff
		}
		return maxRetries, backoffSec
	}

	// Fallback to legacy Retries field / global defaults
	maxRetries = spec.Retries
	backoffSec = float64(s.defaultBackoffSecs) * math.Pow(2, float64(attempt))
	if backoffSec > 60 {
		backoffSec = 60
	}
	return maxRetries, backoffSec
}
