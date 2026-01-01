// Package scheduler provides DAG execution for orchestrator runs.
package scheduler

import (
	"context"
	"fmt"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// executeConditional evaluates the condition and marks appropriate branches.
// It does not execute child nodes directly - they execute via normal dependency resolution.
func (s *Scheduler) executeConditional(ctx context.Context, rctx *runContext, node *types.NodeSpec) error {
	config := node.Conditional
	if config == nil {
		return fmt.Errorf("node %s has no conditional config", node.ID)
	}

	// Build evaluation environment from predecessor outputs
	env := s.buildExprEnvironment(ctx, rctx, node)

	// Evaluate condition expression
	result, err := s.exprEval.Evaluate(config.Expression, env)
	if err != nil {
		return fmt.Errorf("evaluate condition for node %s: %w", node.ID, err)
	}

	// Emit condition_evaluated event
	s.emitEvent(ctx, rctx.runID, string(types.EventTypeConditionEvaluated), map[string]interface{}{
		"expression": config.Expression,
		"result":     result,
	}, node.ID, "")

	// Determine which branch to take
	var selectedBranch string
	switch config.Type {
	case "if":
		truthy, _ := s.exprEval.EvaluateBool(config.Expression, env)
		if truthy {
			selectedBranch = "true"
		} else {
			selectedBranch = "false"
		}
	case "switch":
		selectedBranch = fmt.Sprint(result)
		if _, ok := config.Branches[selectedBranch]; !ok {
			if config.Default != "" {
				selectedBranch = config.Default
			} else {
				return fmt.Errorf("no matching branch for switch result %q and no default", selectedBranch)
			}
		}
	default:
		return fmt.Errorf("unknown conditional type: %s", config.Type)
	}

	// Emit branch_selected event
	s.emitEvent(ctx, rctx.runID, string(types.EventTypeBranchSelected), map[string]interface{}{
		"branch":     selectedBranch,
		"expression": config.Expression,
	}, node.ID, "")

	// Mark non-selected branches as skipped
	for branchID, branch := range config.Branches {
		if branchID != selectedBranch {
			s.skipBranch(ctx, rctx, node.ID, branchID, branch.Targets)
		}
	}

	// The selected branch targets will be unlocked by onNodeFinished
	// when this conditional node completes successfully
	return nil
}

// skipBranch recursively marks all downstream nodes as skipped.
// This follows the dependency graph to skip entire subtrees.
func (s *Scheduler) skipBranch(ctx context.Context, rctx *runContext, condNodeID, branchID string, targetIDs []string) {
	visited := make(map[string]bool)

	var skip func(nodeID string)
	skip = func(nodeID string) {
		if visited[nodeID] {
			return
		}
		visited[nodeID] = true

		// Get current state to avoid overwriting failed/succeeded nodes
		state, _ := s.store.GetNodeState(ctx, rctx.runID, nodeID)
		if state != nil {
			// Don't skip nodes that have already completed
			if state.Status == types.NodeStatusSucceeded || state.Status == types.NodeStatusFailed {
				return
			}
		}

		// Update node status to skipped
		now := time.Now().UTC()
		newState := &types.NodeState{
			NodeID:     nodeID,
			Status:     types.NodeStatusSkipped,
			FinishedAt: &now,
		}
		if err := s.store.UpdateNodeState(ctx, rctx.runID, nodeID, newState); err != nil {
			s.logger.Error("failed to update skipped node state",
				"run_id", rctx.runID,
				"node_id", nodeID,
				"error", err)
		}

		// Emit branch_skipped event
		s.emitEvent(ctx, rctx.runID, string(types.EventTypeBranchSkipped), map[string]interface{}{
			"conditional_node": condNodeID,
			"branch":           branchID,
		}, nodeID, "")

		// Emit node_status skipped
		s.emitNodeStatus(ctx, rctx.runID, nodeID, "skipped", map[string]interface{}{
			"reason": "branch_not_taken",
		})

		// Recursively skip all dependents of this node
		for depID := range rctx.dependents[nodeID] {
			skip(depID)
		}

		// Also decrement remaining predecessors for downstream nodes
		// This ensures they don't block waiting for skipped nodes
		for depID := range rctx.dependents[nodeID] {
			rctx.remainingPreds[depID]--
		}
	}

	// Skip each target node and its dependents
	for _, targetID := range targetIDs {
		skip(targetID)
	}
}

// buildExprEnvironment creates an evaluation environment from node outputs.
func (s *Scheduler) buildExprEnvironment(ctx context.Context, rctx *runContext, node *types.NodeSpec) map[string]interface{} {
	// Gather outputs from predecessor nodes
	nodeOutputs := make(map[string]map[string]interface{})

	// Get outputs from nodes this one depends on (via Inputs field or edges)
	predecessorIDs := make(map[string]bool)
	for _, inputID := range node.Inputs {
		predecessorIDs[inputID] = true
	}

	// Also check edges for predecessors
	for predID := range rctx.dependents {
		if _, hasDep := rctx.dependents[predID][node.ID]; hasDep {
			predecessorIDs[predID] = true
		}
	}

	// Fetch outputs for each predecessor
	for predID := range predecessorIDs {
		outputs, err := s.store.GetNodeOutputs(ctx, rctx.runID, predID)
		if err == nil && outputs != nil {
			nodeOutputs[predID] = outputs
		}
	}

	// Build context with run metadata
	contextVars := map[string]interface{}{
		"run_id":  rctx.runID,
		"node_id": node.ID,
	}

	return BuildEnvironment(nodeOutputs, contextVars)
}

// onConditionalFinished is called when a conditional node completes.
// It unlocks the selected branch targets for execution.
func (s *Scheduler) onConditionalFinished(ctx context.Context, rctx *runContext, nodeID string) {
	// The conditional node succeeded - its targets will be unlocked
	// via the normal dependency resolution in onNodeFinished.
	// No special handling needed here since skipBranch already
	// decremented the remainingPreds for skipped paths.

	// Emit node status succeeded
	s.emitNodeStatus(ctx, rctx.runID, nodeID, "succeeded", nil)
}
