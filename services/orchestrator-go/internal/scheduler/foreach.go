// Package scheduler provides DAG execution for orchestrator runs.
package scheduler

import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// executeForEach executes body nodes for each item in a collection.
// It supports both sequential and parallel execution based on MaxParallel config.
func (s *Scheduler) executeForEach(ctx context.Context, rctx *runContext, node *types.NodeSpec) error {
	ctx, span := tracer.Start(ctx, "scheduler.executeForEach",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
			attribute.String("node_id", node.ID),
		),
	)
	defer span.End()

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

	span.SetAttributes(
		attribute.Int("collection_size", len(items)),
		attribute.Int("max_parallel", config.MaxParallel),
	)

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

// executeLoopBody executes the body nodes for a single loop iteration using
// sub-DAG scheduling. Body nodes with dependencies between them are executed
// in the correct order; independent body nodes run in parallel.
func (s *Scheduler) executeLoopBody(ctx context.Context, rctx *runContext, loopNodeID string, bodyNodeIDs []string, iterEnv map[string]interface{}, iterIndex int) error {
	_, span := tracer.Start(ctx, "scheduler.executeLoopBody",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
			attribute.String("loop_node_id", loopNodeID),
			attribute.Int("iteration_index", iterIndex),
			attribute.Int("body_node_count", len(bodyNodeIDs)),
		),
	)
	defer span.End()

	if len(bodyNodeIDs) == 0 {
		return nil
	}

	// Build a set of body node IDs for quick lookup
	bodySet := make(map[string]bool, len(bodyNodeIDs))
	for _, id := range bodyNodeIDs {
		bodySet[id] = true
	}

	// Build sub-DAG dependency graph from the main plan's edges,
	// filtered to only body nodes within this iteration.
	subDeps := make(map[string]map[string]bool)    // node -> set of downstream body nodes
	subRemaining := make(map[string]int)            // node -> count of unresolved body predecessors

	for id := range bodySet {
		subDeps[id] = make(map[string]bool)
		subRemaining[id] = 0
	}

	for predID := range bodySet {
		for depID := range rctx.dependents[predID] {
			if bodySet[depID] {
				subDeps[predID][depID] = true
				subRemaining[depID]++
			}
		}
	}

	// Store iteration context accessible to all body nodes
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
	iterContextKey := fmt.Sprintf("%s_iter_%d", loopNodeID, iterIndex)
	if err := s.store.SetNodeOutputs(ctx, rctx.runID, iterContextKey, iterOutputs); err != nil {
		s.logger.Warn("failed to store iteration context", "error", err)
	}

	// Execute body nodes in dependency order with parallel scheduling
	var mu sync.Mutex
	var wg sync.WaitGroup
	var firstErr error
	completed := make(map[string]bool)

	// scheduleReady launches all body nodes whose predecessors are satisfied
	var scheduleReady func()
	scheduleReady = func() {
		mu.Lock()
		defer mu.Unlock()

		for _, nodeID := range bodyNodeIDs {
			if completed[nodeID] {
				continue
			}
			if subRemaining[nodeID] > 0 {
				continue
			}
			// Mark as in-flight so we don't schedule again
			subRemaining[nodeID] = -1

			spec, ok := rctx.nodeSpecs[nodeID]
			if !ok {
				s.logger.Warn("loop body node not found",
					"loop_node", loopNodeID,
					"body_node", nodeID,
					"iteration", iterIndex)
				completed[nodeID] = true
				continue
			}

			wg.Add(1)
			go func(nid string, nspec *types.NodeSpec) {
				defer wg.Done()

				// Check for cancellation or previous error
				mu.Lock()
				hasErr := firstErr != nil
				mu.Unlock()
				if hasErr {
					return
				}

				select {
				case <-ctx.Done():
					mu.Lock()
					if firstErr == nil {
						firstErr = ctx.Err()
					}
					mu.Unlock()
					return
				default:
				}

				// Execute the body node
				err := s.executeBodyNode(ctx, rctx, nspec, iterEnv, iterIndex)

				mu.Lock()
				completed[nid] = true
				if err != nil {
					if firstErr == nil {
						firstErr = fmt.Errorf("body node %s: %w", nid, err)
					}
					mu.Unlock()
					return
				}

				// Unlock downstream body nodes
				for depID := range subDeps[nid] {
					subRemaining[depID]--
				}
				mu.Unlock()

				// Attempt to schedule newly ready nodes
				scheduleReady()
			}(nodeID, spec)
		}
	}

	// Kick off initial scheduling
	scheduleReady()

	// Wait for all body nodes to complete
	wg.Wait()

	return firstErr
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
	// Pass image to driver so K8s driver can use it for the Job container.
	if spec.Image != "" {
		env["AGENT_IMAGE"] = spec.Image
	}

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

	// Capture agent outputs for downstream data flow
	if exitCode == 0 {
		s.captureNodeOutputs(ctx, rctx.runID, nodeID)
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
