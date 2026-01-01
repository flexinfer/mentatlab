// Package scheduler provides DAG execution for orchestrator runs.
package scheduler

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// executeForEach executes body nodes for each item in a collection.
// It supports both sequential and parallel execution based on MaxParallel config.
func (s *Scheduler) executeForEach(ctx context.Context, rctx *runContext, node *types.NodeSpec) error {
	config := node.ForEach
	if config == nil {
		return fmt.Errorf("node %s has no for_each config", node.ID)
	}

	// Build evaluation environment from predecessor outputs
	env := s.buildExprEnvironment(ctx, rctx, node)

	// Evaluate collection expression to get items
	items, err := s.exprEval.EvaluateSlice(config.Collection, env)
	if err != nil {
		return fmt.Errorf("evaluate collection for node %s: %w", node.ID, err)
	}

	// Emit loop_started event
	s.emitEvent(ctx, rctx.runID, string(types.EventTypeLoopStarted), map[string]interface{}{
		"collection":  config.Collection,
		"item_count":  len(items),
		"max_parallel": config.MaxParallel,
	}, node.ID, "")

	// Handle empty collection
	if len(items) == 0 {
		s.emitEvent(ctx, rctx.runID, string(types.EventTypeLoopComplete), map[string]interface{}{
			"iterations": 0,
			"skipped":    true,
		}, node.ID, "")
		return nil
	}

	// Determine parallelism
	maxParallel := config.MaxParallel
	if maxParallel <= 0 {
		maxParallel = 1 // Sequential by default
	}

	// Execute iterations
	sem := make(chan struct{}, maxParallel)
	var wg sync.WaitGroup
	var iterErr error
	var iterErrMu sync.Mutex

	for i, item := range items {
		// Check for cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Check for previous error (fail-fast)
		iterErrMu.Lock()
		hasError := iterErr != nil
		iterErrMu.Unlock()
		if hasError {
			break
		}

		// Acquire semaphore slot
		sem <- struct{}{}
		wg.Add(1)

		go func(index int, itemValue interface{}) {
			defer wg.Done()
			defer func() { <-sem }()

			// Emit iteration start event
			s.emitEvent(ctx, rctx.runID, string(types.EventTypeLoopIteration), map[string]interface{}{
				"index": index,
				"item":  itemValue,
				"total": len(items),
			}, node.ID, "")

			// Build iteration context with scoped variables
			iterEnv := make(map[string]interface{})
			for k, v := range env {
				iterEnv[k] = v
			}
			iterEnv[config.ItemVar] = itemValue
			if config.IndexVar != "" {
				iterEnv[config.IndexVar] = index
			}

			// Execute body nodes with iteration context
			if err := s.executeLoopBody(ctx, rctx, node.ID, config.Body, iterEnv, index); err != nil {
				iterErrMu.Lock()
				if iterErr == nil {
					iterErr = fmt.Errorf("iteration %d: %w", index, err)
				}
				iterErrMu.Unlock()
			}
		}(i, item)
	}

	// Wait for all iterations to complete
	wg.Wait()

	// Emit loop_complete event
	s.emitEvent(ctx, rctx.runID, string(types.EventTypeLoopComplete), map[string]interface{}{
		"iterations": len(items),
		"error":      iterErr != nil,
	}, node.ID, "")

	return iterErr
}

// executeLoopBody executes the body nodes for a single loop iteration.
// This is a simplified execution that runs body nodes in dependency order.
func (s *Scheduler) executeLoopBody(ctx context.Context, rctx *runContext, loopNodeID string, bodyNodeIDs []string, iterEnv map[string]interface{}, iterIndex int) error {
	if len(bodyNodeIDs) == 0 {
		return nil
	}

	// For now, execute body nodes sequentially in order
	// A more sophisticated implementation would build a sub-DAG and execute it
	for _, nodeID := range bodyNodeIDs {
		spec, ok := rctx.nodeSpecs[nodeID]
		if !ok {
			s.logger.Warn("loop body node not found",
				"loop_node", loopNodeID,
				"body_node", nodeID,
				"iteration", iterIndex)
			continue
		}

		// Check for cancellation
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Store iteration context for this node
		iterOutputs := map[string]interface{}{
			"_iteration": map[string]interface{}{
				"index":   iterIndex,
				"loop_id": loopNodeID,
			},
		}
		for k, v := range iterEnv {
			if k != "inputs" && k != "context" {
				iterOutputs[k] = v
			}
		}
		if err := s.store.SetNodeOutputs(ctx, rctx.runID, fmt.Sprintf("%s_iter_%d", loopNodeID, iterIndex), iterOutputs); err != nil {
			s.logger.Warn("failed to store iteration context", "error", err)
		}

		// Execute the body node synchronously
		// This is a simplified approach - in a full implementation,
		// body nodes would be scheduled through the normal scheduler
		if err := s.executeBodyNode(ctx, rctx, spec, iterEnv, iterIndex); err != nil {
			return fmt.Errorf("body node %s: %w", nodeID, err)
		}
	}

	return nil
}

// executeBodyNode executes a single body node within a loop iteration.
func (s *Scheduler) executeBodyNode(ctx context.Context, rctx *runContext, spec *types.NodeSpec, iterEnv map[string]interface{}, iterIndex int) error {
	nodeID := spec.ID

	// Update node state to running
	startedAt := time.Now().UTC()
	state := &types.NodeState{
		NodeID:    nodeID,
		Status:    types.NodeStatusRunning,
		StartedAt: &startedAt,
	}
	if err := s.store.UpdateNodeState(ctx, rctx.runID, nodeID, state); err != nil {
		s.logger.Error("failed to update node state",
			"run_id", rctx.runID,
			"node_id", nodeID,
			"error", err)
	}

	// Emit node_status running
	s.emitNodeStatus(ctx, rctx.runID, nodeID, "running", map[string]interface{}{
		"iteration": iterIndex,
	})

	// Resolve command
	cmd := s.resolveCmd(spec)
	if len(cmd) == 0 {
		// No command - mark as succeeded
		finishedAt := time.Now().UTC()
		exitCode := 0
		state := &types.NodeState{
			NodeID:     nodeID,
			Status:     types.NodeStatusSucceeded,
			StartedAt:  &startedAt,
			FinishedAt: &finishedAt,
			ExitCode:   &exitCode,
		}
		s.store.UpdateNodeState(ctx, rctx.runID, nodeID, state)
		s.emitNodeStatus(ctx, rctx.runID, nodeID, "succeeded", nil)
		return nil
	}

	// Build env with iteration variables
	env := make(map[string]string)
	for k, v := range spec.Env {
		env[k] = v
	}
	env["ITERATION_INDEX"] = fmt.Sprintf("%d", iterIndex)

	// Add iteration env as JSON-encoded strings for complex values
	for k, v := range iterEnv {
		if k != "inputs" && k != "context" {
			switch val := v.(type) {
			case string:
				env[fmt.Sprintf("LOOP_%s", k)] = val
			case int, int64, float64, bool:
				env[fmt.Sprintf("LOOP_%s", k)] = fmt.Sprint(val)
			}
		}
	}

	// Calculate timeout
	timeout := 0.0
	if spec.Timeout > 0 {
		timeout = spec.Timeout.Seconds()
	}

	// Run via driver
	exitCode, err := s.driver.RunNode(ctx, rctx.runID, nodeID, cmd, env, timeout)
	if err != nil {
		s.logger.Error("driver execution failed",
			"run_id", rctx.runID,
			"node_id", nodeID,
			"iteration", iterIndex,
			"error", err)
		exitCode = 1
	}

	// Update final state
	finishedAt := time.Now().UTC()
	var finalStatus types.NodeStatus
	if exitCode == 0 {
		finalStatus = types.NodeStatusSucceeded
	} else {
		finalStatus = types.NodeStatusFailed
	}

	finalState := &types.NodeState{
		NodeID:     nodeID,
		Status:     finalStatus,
		StartedAt:  &startedAt,
		FinishedAt: &finishedAt,
		ExitCode:   &exitCode,
	}
	s.store.UpdateNodeState(ctx, rctx.runID, nodeID, finalState)
	s.emitNodeStatus(ctx, rctx.runID, nodeID, string(finalStatus), nil)

	if exitCode != 0 {
		return fmt.Errorf("exit code %d", exitCode)
	}

	return nil
}
