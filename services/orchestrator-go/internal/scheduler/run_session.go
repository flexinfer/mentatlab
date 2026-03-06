package scheduler

import (
	"context"
	"fmt"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// RunSessionManager bridges run lifecycle state to an external session system.
type RunSessionManager interface {
	StartRunSession(ctx context.Context, runID, runName, owner string) (string, error)
	AddRunUpdate(ctx context.Context, sessionID, runID, status, content string, metadata map[string]interface{}) error
	EndRunSession(ctx context.Context, sessionID string) error
}

func (s *Scheduler) startRunSession(ctx context.Context, rctx *runContext) {
	if s.runSessionManager == nil || rctx == nil {
		return
	}

	owner := ""
	if run, err := s.store.GetRun(ctx, rctx.runID); err == nil && run != nil {
		owner = run.Owner
	}

	sessionID, err := s.runSessionManager.StartRunSession(ctx, rctx.runID, rctx.name, owner)
	if err != nil {
		s.logger.Warn("failed to start run session",
			"run_id", rctx.runID,
			"error", err)
		return
	}
	if sessionID == "" {
		s.logger.Warn("run session manager returned empty session id", "run_id", rctx.runID)
		return
	}

	rctx.sessionMu.Lock()
	rctx.sessionID = sessionID
	rctx.sessionClosed = false
	rctx.sessionMu.Unlock()

	s.emitEvent(ctx, rctx.runID, "agent_context", map[string]interface{}{
		"runId":      rctx.runID,
		"status":     "started",
		"session_id": sessionID,
	}, "", "")

	if err := s.runSessionManager.AddRunUpdate(
		ctx,
		sessionID,
		rctx.runID,
		string(types.RunStatusRunning),
		fmt.Sprintf("Run %s started", rctx.runID),
		map[string]interface{}{"run_name": rctx.name},
	); err != nil {
		s.logger.Warn("failed to add run session update",
			"run_id", rctx.runID,
			"session_id", sessionID,
			"error", err)
	}
}

func (s *Scheduler) finalizeRunSession(ctx context.Context, rctx *runContext, status types.RunStatus, reason string) {
	if s.runSessionManager == nil || rctx == nil {
		return
	}

	rctx.sessionMu.Lock()
	sessionID := rctx.sessionID
	closed := rctx.sessionClosed
	if sessionID != "" && !closed {
		rctx.sessionClosed = true
	}
	rctx.sessionMu.Unlock()

	if sessionID == "" || closed {
		return
	}

	summary, metadata := s.buildRunSummary(ctx, rctx, status, reason)
	if err := s.runSessionManager.AddRunUpdate(ctx, sessionID, rctx.runID, string(status), summary, metadata); err != nil {
		s.logger.Warn("failed to add final run session update",
			"run_id", rctx.runID,
			"session_id", sessionID,
			"status", status,
			"error", err)
	}

	if err := s.runSessionManager.EndRunSession(ctx, sessionID); err != nil {
		s.logger.Warn("failed to end run session",
			"run_id", rctx.runID,
			"session_id", sessionID,
			"status", status,
			"error", err)
		return
	}

	event := map[string]interface{}{
		"runId":      rctx.runID,
		"status":     "ended",
		"session_id": sessionID,
		"run_status": string(status),
	}
	if reason != "" {
		event["reason"] = reason
	}
	s.emitEvent(ctx, rctx.runID, "agent_context", event, "", "")
}

// addNodeUpdate records a node lifecycle event in the linked agent-context session.
func (s *Scheduler) addNodeUpdate(ctx context.Context, rctx *runContext, nodeID string, status types.NodeStatus, exitCode int) {
	if s.runSessionManager == nil || rctx == nil {
		return
	}

	rctx.sessionMu.Lock()
	sessionID := rctx.sessionID
	closed := rctx.sessionClosed
	rctx.sessionMu.Unlock()

	if sessionID == "" || closed {
		return
	}

	content := fmt.Sprintf("Node %s %s (exit_code=%d)", nodeID, status, exitCode)
	metadata := map[string]interface{}{
		"node_id":   nodeID,
		"exit_code": exitCode,
	}

	if err := s.runSessionManager.AddRunUpdate(ctx, sessionID, rctx.runID, string(status), content, metadata); err != nil {
		s.logger.Warn("failed to add node session update",
			"run_id", rctx.runID,
			"session_id", sessionID,
			"node_id", nodeID,
			"error", err)
	}
}

func (s *Scheduler) buildRunSummary(ctx context.Context, rctx *runContext, status types.RunStatus, reason string) (string, map[string]interface{}) {
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

	summary := fmt.Sprintf(
		"Run %s finished with status %s (succeeded=%d failed=%d skipped=%d running=%d pending=%d waiting=%d)",
		rctx.runID,
		status,
		succeeded,
		failed,
		skipped,
		running,
		pending,
		waiting,
	)
	if reason != "" {
		summary = summary + " reason=" + reason
	}

	return summary, map[string]interface{}{
		"succeeded": succeeded,
		"failed":    failed,
		"skipped":   skipped,
		"running":   running,
		"pending":   pending,
		"waiting":   waiting,
		"reason":    reason,
	}
}
