// Package scheduler provides DAG execution for orchestrator runs.
package scheduler

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func TestExecuteForEach_Sequential(t *testing.T) {
	store := runstore.NewMemoryStore(nil)

	var executionOrder []string
	var mu sync.Mutex

	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			mu.Lock()
			executionOrder = append(executionOrder, nodeID)
			mu.Unlock()
			return 0, nil
		},
	}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "loop",
				Type: types.NodeTypeForEach,
				ForEach: &types.ForEachConfig{
					Collection:  "inputs.input.items",
					ItemVar:     "item",
					IndexVar:    "idx",
					MaxParallel: 1, // Sequential
					Body:        []string{"process"},
				},
				Inputs: []string{"input"},
			},
			{
				ID:      "process",
				Type:    "agent",
				Command: []string{"echo", "processing"},
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-foreach-seq", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	// Set collection with 3 items
	if err := store.SetNodeOutputs(ctx, runID, "input", map[string]interface{}{
		"items": []interface{}{"a", "b", "c"},
	}); err != nil {
		t.Fatalf("Failed to set outputs: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}

	node := rctx.nodeSpecs["loop"]
	err = s.executeForEach(ctx, rctx, node)
	if err != nil {
		t.Fatalf("executeForEach failed: %v", err)
	}

	// Should have executed process node 3 times
	if len(executionOrder) != 3 {
		t.Errorf("Expected 3 executions, got %d", len(executionOrder))
	}
}

func TestExecuteForEach_Parallel(t *testing.T) {
	store := runstore.NewMemoryStore(nil)

	var concurrentMax int32
	var current int32

	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			curr := atomic.AddInt32(&current, 1)
			// Track max concurrency
			for {
				max := atomic.LoadInt32(&concurrentMax)
				if curr <= max || atomic.CompareAndSwapInt32(&concurrentMax, max, curr) {
					break
				}
			}

			// Simulate some work
			time.Sleep(20 * time.Millisecond)

			atomic.AddInt32(&current, -1)
			return 0, nil
		},
	}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "loop",
				Type: types.NodeTypeForEach,
				ForEach: &types.ForEachConfig{
					Collection:  "inputs.input.items",
					ItemVar:     "item",
					MaxParallel: 3, // Allow 3 concurrent
					Body:        []string{"process"},
				},
				Inputs: []string{"input"},
			},
			{
				ID:      "process",
				Type:    "agent",
				Command: []string{"echo"},
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-foreach-parallel", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	// Set collection with 6 items
	if err := store.SetNodeOutputs(ctx, runID, "input", map[string]interface{}{
		"items": []interface{}{1, 2, 3, 4, 5, 6},
	}); err != nil {
		t.Fatalf("Failed to set outputs: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}

	node := rctx.nodeSpecs["loop"]
	err = s.executeForEach(ctx, rctx, node)
	if err != nil {
		t.Fatalf("executeForEach failed: %v", err)
	}

	// Check that we actually ran with concurrency
	maxConcurrent := atomic.LoadInt32(&concurrentMax)
	if maxConcurrent < 2 {
		t.Logf("Max concurrency was %d (expected >= 2 with MaxParallel=3)", maxConcurrent)
	}
	if maxConcurrent > 3 {
		t.Errorf("Max concurrency %d exceeded MaxParallel of 3", maxConcurrent)
	}
}

func TestExecuteForEach_EmptyCollection(t *testing.T) {
	store := runstore.NewMemoryStore(nil)

	executionCount := 0
	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			executionCount++
			return 0, nil
		},
	}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "loop",
				Type: types.NodeTypeForEach,
				ForEach: &types.ForEachConfig{
					Collection:  "inputs.input.items",
					ItemVar:     "item",
					MaxParallel: 1,
					Body:        []string{"process"},
				},
				Inputs: []string{"input"},
			},
			{
				ID:      "process",
				Type:    "agent",
				Command: []string{"echo"},
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-foreach-empty", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	// Set empty collection
	if err := store.SetNodeOutputs(ctx, runID, "input", map[string]interface{}{
		"items": []interface{}{},
	}); err != nil {
		t.Fatalf("Failed to set outputs: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}

	node := rctx.nodeSpecs["loop"]
	err = s.executeForEach(ctx, rctx, node)
	if err != nil {
		t.Fatalf("executeForEach failed: %v", err)
	}

	// No executions should have occurred
	if executionCount != 0 {
		t.Errorf("Expected 0 executions for empty collection, got %d", executionCount)
	}
}

func TestExecuteForEach_ErrorInIteration(t *testing.T) {
	store := runstore.NewMemoryStore(nil)

	var executionCount int32
	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			count := atomic.AddInt32(&executionCount, 1)
			// Fail on 3rd iteration
			if count == 3 {
				return 1, errors.New("simulated failure")
			}
			return 0, nil
		},
	}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "loop",
				Type: types.NodeTypeForEach,
				ForEach: &types.ForEachConfig{
					Collection:  "inputs.input.items",
					ItemVar:     "item",
					MaxParallel: 1, // Sequential to control order
					Body:        []string{"process"},
				},
				Inputs: []string{"input"},
			},
			{
				ID:      "process",
				Type:    "agent",
				Command: []string{"echo"},
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-foreach-error", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	if err := store.SetNodeOutputs(ctx, runID, "input", map[string]interface{}{
		"items": []interface{}{1, 2, 3, 4, 5},
	}); err != nil {
		t.Fatalf("Failed to set outputs: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}

	node := rctx.nodeSpecs["loop"]
	err = s.executeForEach(ctx, rctx, node)

	// Should return an error
	if err == nil {
		t.Error("Expected error from failed iteration")
	}

	// Should not have run all iterations (fail-fast behavior)
	// Note: Due to semaphore acquire before error check, one extra may run
	count := atomic.LoadInt32(&executionCount)
	if count >= 5 {
		t.Errorf("Expected fail-fast behavior, but all %d iterations ran", count)
	}
}

func TestExecuteForEach_Cancellation(t *testing.T) {
	store := runstore.NewMemoryStore(nil)

	var executionCount int32
	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			atomic.AddInt32(&executionCount, 1)
			// Simulate some work
			time.Sleep(50 * time.Millisecond)
			return 0, nil
		},
	}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)

	// Cancel context after short delay
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(30 * time.Millisecond)
		cancel()
	}()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "loop",
				Type: types.NodeTypeForEach,
				ForEach: &types.ForEachConfig{
					Collection:  "inputs.input.items",
					ItemVar:     "item",
					MaxParallel: 1,
					Body:        []string{"process"},
				},
				Inputs: []string{"input"},
			},
			{
				ID:      "process",
				Type:    "agent",
				Command: []string{"sleep", "1"},
			},
		},
	}

	runID, err := store.CreateRun(context.Background(), "test-foreach-cancel", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	if err := store.SetNodeOutputs(context.Background(), runID, "input", map[string]interface{}{
		"items": []interface{}{1, 2, 3, 4, 5, 6, 7, 8, 9, 10},
	}); err != nil {
		t.Fatalf("Failed to set outputs: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}

	node := rctx.nodeSpecs["loop"]
	err = s.executeForEach(ctx, rctx, node)

	if err != context.Canceled {
		t.Errorf("Expected context.Canceled, got %v", err)
	}

	// Should not have completed all iterations
	count := atomic.LoadInt32(&executionCount)
	if count >= 10 {
		t.Errorf("Expected early termination, but all %d iterations ran", count)
	}
}

func TestExecuteForEach_InvalidCollection(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	driver := &mockDriver{}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "loop",
				Type: types.NodeTypeForEach,
				ForEach: &types.ForEachConfig{
					Collection:  "invalid@@expression",
					ItemVar:     "item",
					MaxParallel: 1,
					Body:        []string{"process"},
				},
				Inputs: []string{"input"},
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-foreach-invalid", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}

	node := rctx.nodeSpecs["loop"]
	err = s.executeForEach(ctx, rctx, node)

	if err == nil {
		t.Error("Expected error for invalid collection expression")
	}
}

func TestExecuteForEach_NonSliceCollection(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	driver := &mockDriver{}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "loop",
				Type: types.NodeTypeForEach,
				ForEach: &types.ForEachConfig{
					Collection:  "inputs.input.value",
					ItemVar:     "item",
					MaxParallel: 1,
					Body:        []string{"process"},
				},
				Inputs: []string{"input"},
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-foreach-nonslice", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	// Set a non-slice value
	if err := store.SetNodeOutputs(ctx, runID, "input", map[string]interface{}{
		"value": "not a slice",
	}); err != nil {
		t.Fatalf("Failed to set outputs: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}

	node := rctx.nodeSpecs["loop"]
	err = s.executeForEach(ctx, rctx, node)

	if err == nil {
		t.Error("Expected error for non-slice collection")
	}
}

func TestExecuteForEach_NoConfig(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	driver := &mockDriver{}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:      "loop",
				Type:    types.NodeTypeForEach,
				ForEach: nil, // No config
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-foreach-noconfig", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}

	node := rctx.nodeSpecs["loop"]
	err = s.executeForEach(ctx, rctx, node)

	if err == nil {
		t.Error("Expected error for nil for_each config")
	}
}

func TestExecuteForEach_IterationEnvVars(t *testing.T) {
	store := runstore.NewMemoryStore(nil)

	var capturedEnvs []map[string]string
	var mu sync.Mutex

	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			mu.Lock()
			envCopy := make(map[string]string)
			for k, v := range env {
				envCopy[k] = v
			}
			capturedEnvs = append(capturedEnvs, envCopy)
			mu.Unlock()
			return 0, nil
		},
	}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "loop",
				Type: types.NodeTypeForEach,
				ForEach: &types.ForEachConfig{
					Collection:  "inputs.input.items",
					ItemVar:     "item",
					IndexVar:    "idx",
					MaxParallel: 1,
					Body:        []string{"process"},
				},
				Inputs: []string{"input"},
			},
			{
				ID:      "process",
				Type:    "agent",
				Command: []string{"echo"},
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-foreach-env", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	if err := store.SetNodeOutputs(ctx, runID, "input", map[string]interface{}{
		"items": []interface{}{"apple", "banana", "cherry"},
	}); err != nil {
		t.Fatalf("Failed to set outputs: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}

	node := rctx.nodeSpecs["loop"]
	err = s.executeForEach(ctx, rctx, node)
	if err != nil {
		t.Fatalf("executeForEach failed: %v", err)
	}

	// Check that environment variables were set correctly
	if len(capturedEnvs) != 3 {
		t.Fatalf("Expected 3 captured envs, got %d", len(capturedEnvs))
	}

	for i, env := range capturedEnvs {
		// Check ITERATION_INDEX
		expectedIndex := string(rune('0' + i))
		if env["ITERATION_INDEX"] != expectedIndex {
			t.Errorf("Iteration %d: ITERATION_INDEX = %s, want %s", i, env["ITERATION_INDEX"], expectedIndex)
		}

		// Check LOOP_item (string values get LOOP_ prefix)
		expectedItems := []string{"apple", "banana", "cherry"}
		if env["LOOP_item"] != expectedItems[i] {
			t.Errorf("Iteration %d: LOOP_item = %s, want %s", i, env["LOOP_item"], expectedItems[i])
		}
	}
}

func TestExecuteForEach_EmitEvents(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			return 0, nil
		},
	}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "loop",
				Type: types.NodeTypeForEach,
				ForEach: &types.ForEachConfig{
					Collection:  "inputs.input.items",
					ItemVar:     "item",
					MaxParallel: 1,
					Body:        []string{"process"},
				},
				Inputs: []string{"input"},
			},
			{
				ID:      "process",
				Type:    "agent",
				Command: []string{"echo"},
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-foreach-events", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	if err := store.SetNodeOutputs(ctx, runID, "input", map[string]interface{}{
		"items": []interface{}{1, 2},
	}); err != nil {
		t.Fatalf("Failed to set outputs: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}

	node := rctx.nodeSpecs["loop"]
	err = s.executeForEach(ctx, rctx, node)
	if err != nil {
		t.Fatalf("executeForEach failed: %v", err)
	}

	time.Sleep(10 * time.Millisecond)

	// Get events from store
	events, err := store.GetEventsSince(ctx, runID, "")
	if err != nil {
		t.Fatalf("Failed to get events: %v", err)
	}

	var foundStarted, foundComplete bool
	iterationCount := 0

	for _, event := range events {
		switch event.Type {
		case types.EventTypeLoopStarted:
			foundStarted = true
		case types.EventTypeLoopIteration:
			iterationCount++
		case types.EventTypeLoopComplete:
			foundComplete = true
		}
	}

	if !foundStarted {
		t.Error("Expected loop_started event")
	}
	if iterationCount != 2 {
		t.Errorf("Expected 2 loop_iteration events, got %d", iterationCount)
	}
	if !foundComplete {
		t.Error("Expected loop_complete event")
	}
}

func TestExecuteLoopBody_EmptyBody(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	driver := &mockDriver{}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{}
	runID, err := store.CreateRun(ctx, "test-empty-body", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}

	// Empty body should succeed without error
	err = s.executeLoopBody(ctx, rctx, "loop_node", []string{}, map[string]interface{}{}, 0)
	if err != nil {
		t.Errorf("Empty body should not error: %v", err)
	}
}

func TestExecuteLoopBody_MissingBodyNode(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	driver := &mockDriver{}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{}
	runID, err := store.CreateRun(ctx, "test-missing-body", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec), // Empty - no nodes defined
		dependents: make(map[string]map[string]bool),
	}

	// Reference a node that doesn't exist
	err = s.executeLoopBody(ctx, rctx, "loop_node", []string{"nonexistent_node"}, map[string]interface{}{}, 0)

	// Should skip missing nodes with warning, not error
	if err != nil {
		t.Errorf("Missing body node should be skipped, not error: %v", err)
	}
}

func TestExecuteBodyNode_NoCommand(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			t.Error("Driver should not be called for node with no command")
			return 0, nil
		},
	}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	ctx := context.Background()

	plan := &types.Plan{}
	runID, err := store.CreateRun(ctx, "test-no-cmd", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}

	spec := &types.NodeSpec{
		ID:      "no_cmd_node",
		Type:    "agent",
		Command: nil, // No command
	}

	err = s.executeBodyNode(ctx, rctx, spec, map[string]interface{}{}, 0)
	if err != nil {
		t.Errorf("Node with no command should succeed: %v", err)
	}

	// Check that node was marked as succeeded
	state, err := store.GetNodeState(ctx, runID, "no_cmd_node")
	if err != nil {
		t.Fatalf("Failed to get node state: %v", err)
	}
	if state.Status != types.NodeStatusSucceeded {
		t.Errorf("Node should be succeeded, got %v", state.Status)
	}
}
