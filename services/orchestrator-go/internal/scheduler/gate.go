package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// executeGate blocks a node until external approval or rejection (or timeout).
func (s *Scheduler) executeGate(ctx context.Context, rctx *runContext, nodeID string, spec *types.NodeSpec) int {
	ctx, span := tracer.Start(ctx, "scheduler.executeGate",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
			attribute.String("node_id", nodeID),
		),
	)
	defer span.End()

	gate := spec.Gate
	if gate.Timeout > 0 {
		span.SetAttributes(attribute.String("gate_timeout", gate.Timeout.String()))
	}

	// Create a channel for approval signals
	ch := make(chan string, 1)
	rctx.gatesMu.Lock()
	rctx.gates[nodeID] = ch
	rctx.gatesMu.Unlock()

	defer func() {
		rctx.gatesMu.Lock()
		delete(rctx.gates, nodeID)
		rctx.gatesMu.Unlock()
	}()

	// Update node state to waiting_approval
	now := time.Now().UTC()
	waitState := &types.NodeState{
		NodeID:    nodeID,
		Status:    types.NodeStatusWaitingApproval,
		StartedAt: &now,
	}
	s.store.UpdateNodeState(ctx, rctx.runID, nodeID, waitState)
	s.emitNodeStatus(ctx, rctx.runID, nodeID, "waiting_approval", map[string]interface{}{
		"description": gate.Description,
	})

	// Set up gate timeout if configured
	var timeoutCh <-chan time.Time
	if gate.Timeout > 0 {
		timer := time.NewTimer(gate.Timeout)
		defer timer.Stop()
		timeoutCh = timer.C
	}

	// Wait for signal
	var decision string
	select {
	case decision = <-ch:
		// Received approve or reject
	case <-timeoutCh:
		if gate.AutoReject {
			decision = "reject"
		} else {
			decision = "approve"
		}
		s.logger.Info("gate timed out",
			slog.String("run_id", rctx.runID),
			slog.String("node_id", nodeID),
			slog.String("decision", decision),
		)
	case <-ctx.Done():
		// Run cancelled or timed out
		return 1
	}

	span.SetAttributes(attribute.String("decision", decision))

	exitCode := 0
	if decision == "reject" {
		exitCode = 1
	}

	s.emitEvent(ctx, rctx.runID, "gate_decision", map[string]interface{}{
		"nodeId":   nodeID,
		"decision": decision,
	}, nodeID, "")

	return exitCode
}

// ApproveGate sends an approval signal to a waiting gate node.
func (s *Scheduler) ApproveGate(runID, nodeID string) error {
	return s.signalGate(runID, nodeID, "approve")
}

// RejectGate sends a rejection signal to a waiting gate node.
func (s *Scheduler) RejectGate(runID, nodeID string) error {
	return s.signalGate(runID, nodeID, "reject")
}

func (s *Scheduler) signalGate(runID, nodeID, decision string) error {
	s.runsMu.Lock()
	rctx, exists := s.runs[runID]
	s.runsMu.Unlock()

	if !exists {
		return fmt.Errorf("run %s not found", runID)
	}

	rctx.gatesMu.Lock()
	ch, ok := rctx.gates[nodeID]
	rctx.gatesMu.Unlock()

	if !ok {
		return fmt.Errorf("node %s is not a waiting gate", nodeID)
	}

	select {
	case ch <- decision:
		return nil
	default:
		return fmt.Errorf("gate %s already received a decision", nodeID)
	}
}
