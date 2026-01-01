// Package scheduler provides DAG execution for orchestrator runs.
package scheduler

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// mockDriver implements driver.Driver for testing
type mockDriver struct {
	runNodeFunc func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error)
}

func (m *mockDriver) RunNode(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
	if m.runNodeFunc != nil {
		return m.runNodeFunc(ctx, runID, nodeID, cmd, env, timeout)
	}
	return 0, nil
}

func (m *mockDriver) GetNodeStatus(ctx context.Context, runID, nodeID string) (types.NodeStatus, error) {
	return types.NodeStatusSucceeded, nil
}

func (m *mockDriver) CancelNode(ctx context.Context, runID, nodeID string) error {
	return nil
}

func (m *mockDriver) CleanupRun(ctx context.Context, runID string) error {
	return nil
}

// testCommandResolver returns a simple command resolver for tests
func testCommandResolver(node *types.NodeSpec) []string {
	return node.Command
}

func newTestScheduler(t *testing.T) (*Scheduler, *runstore.MemoryStore) {
	store := runstore.NewMemoryStore(nil)
	driver := &mockDriver{}
	logger := slog.Default()

	s := New(store, driver, testCommandResolver, nil, logger)
	return s, store
}

func TestExecuteConditional_IfTrue(t *testing.T) {
	s, store := newTestScheduler(t)
	ctx := context.Background()

	// Create a run with conditional node
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "check",
				Type: types.NodeTypeConditional,
				Conditional: &types.ConditionalConfig{
					Type:       "if",
					Expression: "inputs.input.score > 0.5",
					Branches: map[string]types.ConditionalBranch{
						"true":  {Targets: []string{"success_path"}},
						"false": {Targets: []string{"failure_path"}},
					},
				},
				Inputs: []string{"input"},
			},
			{
				ID:     "success_path",
				Type:   "agent",
				Inputs: []string{"check"},
			},
			{
				ID:     "failure_path",
				Type:   "agent",
				Inputs: []string{"check"},
			},
		},
	}

	// Create run
	runID, err := store.CreateRun(ctx, "test-if-true", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	// Set up node outputs for input node
	outputs := map[string]interface{}{"score": 0.8}
	if err := store.SetNodeOutputs(ctx, runID, "input", outputs); err != nil {
		t.Fatalf("Failed to set node outputs: %v", err)
	}

	// Build run context
	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}
	// Build dependents map
	rctx.dependents["check"] = map[string]bool{
		"success_path": true,
		"failure_path": true,
	}

	// Execute conditional
	node := rctx.nodeSpecs["check"]
	err = s.executeConditional(ctx, rctx, node)
	if err != nil {
		t.Fatalf("executeConditional failed: %v", err)
	}

	// Verify failure_path was skipped
	state, err := store.GetNodeState(ctx, runID, "failure_path")
	if err != nil {
		t.Fatalf("Failed to get node state: %v", err)
	}
	if state.Status != types.NodeStatusSkipped {
		t.Errorf("failure_path should be skipped, got %v", state.Status)
	}
}

func TestExecuteConditional_IfFalse(t *testing.T) {
	s, store := newTestScheduler(t)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "check",
				Type: types.NodeTypeConditional,
				Conditional: &types.ConditionalConfig{
					Type:       "if",
					Expression: "inputs.input.score > 0.5",
					Branches: map[string]types.ConditionalBranch{
						"true":  {Targets: []string{"success_path"}},
						"false": {Targets: []string{"failure_path"}},
					},
				},
				Inputs: []string{"input"},
			},
			{
				ID:     "success_path",
				Type:   "agent",
				Inputs: []string{"check"},
			},
			{
				ID:     "failure_path",
				Type:   "agent",
				Inputs: []string{"check"},
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-if-false", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	// Score below threshold
	outputs := map[string]interface{}{"score": 0.3}
	if err := store.SetNodeOutputs(ctx, runID, "input", outputs); err != nil {
		t.Fatalf("Failed to set node outputs: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}
	rctx.dependents["check"] = map[string]bool{
		"success_path": true,
		"failure_path": true,
	}

	node := rctx.nodeSpecs["check"]
	err = s.executeConditional(ctx, rctx, node)
	if err != nil {
		t.Fatalf("executeConditional failed: %v", err)
	}

	// Verify success_path was skipped
	state, err := store.GetNodeState(ctx, runID, "success_path")
	if err != nil {
		t.Fatalf("Failed to get node state: %v", err)
	}
	if state.Status != types.NodeStatusSkipped {
		t.Errorf("success_path should be skipped, got %v", state.Status)
	}
}

func TestExecuteConditional_Switch(t *testing.T) {
	s, store := newTestScheduler(t)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "router",
				Type: types.NodeTypeConditional,
				Conditional: &types.ConditionalConfig{
					Type:       "switch",
					Expression: "inputs.input.category",
					Branches: map[string]types.ConditionalBranch{
						"A": {Targets: []string{"path_a"}},
						"B": {Targets: []string{"path_b"}},
						"C": {Targets: []string{"path_c"}},
					},
					Default: "C",
				},
				Inputs: []string{"input"},
			},
			{ID: "path_a", Type: "agent", Inputs: []string{"router"}},
			{ID: "path_b", Type: "agent", Inputs: []string{"router"}},
			{ID: "path_c", Type: "agent", Inputs: []string{"router"}},
		},
	}

	runID, err := store.CreateRun(ctx, "test-switch", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	// Set category to "B"
	outputs := map[string]interface{}{"category": "B"}
	if err := store.SetNodeOutputs(ctx, runID, "input", outputs); err != nil {
		t.Fatalf("Failed to set node outputs: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}
	rctx.dependents["router"] = map[string]bool{
		"path_a": true,
		"path_b": true,
		"path_c": true,
	}

	node := rctx.nodeSpecs["router"]
	err = s.executeConditional(ctx, rctx, node)
	if err != nil {
		t.Fatalf("executeConditional failed: %v", err)
	}

	// path_a should be skipped
	stateA, _ := store.GetNodeState(ctx, runID, "path_a")
	if stateA.Status != types.NodeStatusSkipped {
		t.Errorf("path_a should be skipped, got %v", stateA.Status)
	}

	// path_c should be skipped
	stateC, _ := store.GetNodeState(ctx, runID, "path_c")
	if stateC.Status != types.NodeStatusSkipped {
		t.Errorf("path_c should be skipped, got %v", stateC.Status)
	}

	// path_b should NOT be skipped (it's the selected branch)
	stateB, _ := store.GetNodeState(ctx, runID, "path_b")
	if stateB.Status == types.NodeStatusSkipped {
		t.Error("path_b should NOT be skipped")
	}
}

func TestExecuteConditional_SwitchDefault(t *testing.T) {
	s, store := newTestScheduler(t)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "input",
				Type: "agent",
			},
			{
				ID:   "router",
				Type: types.NodeTypeConditional,
				Conditional: &types.ConditionalConfig{
					Type:       "switch",
					Expression: "inputs.input.category",
					Branches: map[string]types.ConditionalBranch{
						"A":       {Targets: []string{"path_a"}},
						"B":       {Targets: []string{"path_b"}},
						"default": {Targets: []string{"path_default"}},
					},
					Default: "default",
				},
				Inputs: []string{"input"},
			},
			{ID: "path_a", Type: "agent", Inputs: []string{"router"}},
			{ID: "path_b", Type: "agent", Inputs: []string{"router"}},
			{ID: "path_default", Type: "agent", Inputs: []string{"router"}},
		},
	}

	runID, err := store.CreateRun(ctx, "test-switch-default", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	// Set category to "X" which doesn't match any branch
	outputs := map[string]interface{}{"category": "X"}
	if err := store.SetNodeOutputs(ctx, runID, "input", outputs); err != nil {
		t.Fatalf("Failed to set node outputs: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		nodeSpecs:  make(map[string]*types.NodeSpec),
		dependents: make(map[string]map[string]bool),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}
	rctx.dependents["router"] = map[string]bool{
		"path_a":       true,
		"path_b":       true,
		"path_default": true,
	}

	node := rctx.nodeSpecs["router"]
	err = s.executeConditional(ctx, rctx, node)
	if err != nil {
		t.Fatalf("executeConditional failed: %v", err)
	}

	// path_a and path_b should be skipped
	stateA, _ := store.GetNodeState(ctx, runID, "path_a")
	if stateA.Status != types.NodeStatusSkipped {
		t.Errorf("path_a should be skipped, got %v", stateA.Status)
	}

	stateB, _ := store.GetNodeState(ctx, runID, "path_b")
	if stateB.Status != types.NodeStatusSkipped {
		t.Errorf("path_b should be skipped, got %v", stateB.Status)
	}

	// path_default should NOT be skipped
	stateDefault, _ := store.GetNodeState(ctx, runID, "path_default")
	if stateDefault.Status == types.NodeStatusSkipped {
		t.Error("path_default should NOT be skipped")
	}
}

func TestExecuteConditional_InvalidExpression(t *testing.T) {
	s, store := newTestScheduler(t)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "check",
				Type: types.NodeTypeConditional,
				Conditional: &types.ConditionalConfig{
					Type:       "if",
					Expression: "invalid @@@ expression",
					Branches: map[string]types.ConditionalBranch{
						"true":  {Targets: []string{"path_a"}},
						"false": {Targets: []string{"path_b"}},
					},
				},
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-invalid-expr", plan)
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

	node := rctx.nodeSpecs["check"]
	err = s.executeConditional(ctx, rctx, node)
	if err == nil {
		t.Error("Expected error for invalid expression")
	}
}

func TestSkipBranch_Recursive(t *testing.T) {
	s, store := newTestScheduler(t)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "root", Type: "agent"},
			{ID: "branch1", Type: "agent", Inputs: []string{"root"}},
			{ID: "branch1_child1", Type: "agent", Inputs: []string{"branch1"}},
			{ID: "branch1_child2", Type: "agent", Inputs: []string{"branch1"}},
			{ID: "branch1_grandchild", Type: "agent", Inputs: []string{"branch1_child1"}},
		},
	}

	runID, err := store.CreateRun(ctx, "test-recursive-skip", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	rctx := &runContext{
		runID:          runID,
		nodeSpecs:      make(map[string]*types.NodeSpec),
		dependents:     make(map[string]map[string]bool),
		remainingPreds: make(map[string]int),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}
	// Build dependents
	rctx.dependents["root"] = map[string]bool{"branch1": true}
	rctx.dependents["branch1"] = map[string]bool{"branch1_child1": true, "branch1_child2": true}
	rctx.dependents["branch1_child1"] = map[string]bool{"branch1_grandchild": true}
	// Initialize remaining preds
	rctx.remainingPreds["branch1"] = 1
	rctx.remainingPreds["branch1_child1"] = 1
	rctx.remainingPreds["branch1_child2"] = 1
	rctx.remainingPreds["branch1_grandchild"] = 1

	// Skip branch1
	s.skipBranch(ctx, rctx, "cond_node", "skipped_branch", []string{"branch1"})

	// All descendants should be skipped
	nodesToCheck := []string{"branch1", "branch1_child1", "branch1_child2", "branch1_grandchild"}
	for _, nodeID := range nodesToCheck {
		state, err := store.GetNodeState(ctx, runID, nodeID)
		if err != nil {
			t.Fatalf("Failed to get state for %s: %v", nodeID, err)
		}
		if state.Status != types.NodeStatusSkipped {
			t.Errorf("Node %s should be skipped, got %v", nodeID, state.Status)
		}
	}
}

func TestBuildExprEnvironment(t *testing.T) {
	s, store := newTestScheduler(t)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "node1", Type: "agent"},
			{ID: "node2", Type: "agent"},
			{ID: "target", Type: "agent", Inputs: []string{"node1", "node2"}},
		},
	}

	runID, err := store.CreateRun(ctx, "test-env-build", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	// Set outputs for predecessor nodes
	if err := store.SetNodeOutputs(ctx, runID, "node1", map[string]interface{}{"result": "success", "count": 42}); err != nil {
		t.Fatalf("Failed to set outputs: %v", err)
	}
	if err := store.SetNodeOutputs(ctx, runID, "node2", map[string]interface{}{"data": []interface{}{1, 2, 3}}); err != nil {
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

	target := rctx.nodeSpecs["target"]
	env := s.buildExprEnvironment(ctx, rctx, target)

	// Check inputs structure - note: it's map[string]map[string]interface{}
	inputs, ok := env["inputs"].(map[string]map[string]interface{})
	if !ok {
		t.Fatal("inputs should be map[string]map[string]interface{}")
	}

	node1Outputs, ok := inputs["node1"]
	if !ok || node1Outputs == nil {
		t.Fatal("inputs.node1 should exist")
	}
	if node1Outputs["result"] != "success" {
		t.Errorf("inputs.node1.result should be 'success', got %v", node1Outputs["result"])
	}

	// Check context
	ctxMap, ok := env["context"].(map[string]interface{})
	if !ok {
		t.Fatal("context should exist")
	}
	if ctxMap["run_id"] != runID {
		t.Errorf("context.run_id should be %s, got %v", runID, ctxMap["run_id"])
	}
}

func TestExecuteConditional_SimpleCondition(t *testing.T) {
	// Test a simple conditional that doesn't depend on any predecessor outputs
	s, store := newTestScheduler(t)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "check",
				Type: types.NodeTypeConditional,
				Conditional: &types.ConditionalConfig{
					Type:       "if",
					Expression: "true", // Simple true expression
					Branches: map[string]types.ConditionalBranch{
						"true":  {Targets: []string{"path_a"}},
						"false": {Targets: []string{"path_b"}},
					},
				},
			},
			{ID: "path_a", Type: "agent", Inputs: []string{"check"}},
			{ID: "path_b", Type: "agent", Inputs: []string{"check"}},
		},
	}

	runID, err := store.CreateRun(ctx, "test-simple", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	rctx := &runContext{
		runID:          runID,
		nodeSpecs:      make(map[string]*types.NodeSpec),
		dependents:     make(map[string]map[string]bool),
		remainingPreds: make(map[string]int),
	}
	for i := range plan.Nodes {
		rctx.nodeSpecs[plan.Nodes[i].ID] = &plan.Nodes[i]
	}
	rctx.dependents["check"] = map[string]bool{"path_a": true, "path_b": true}
	rctx.remainingPreds["path_a"] = 1
	rctx.remainingPreds["path_b"] = 1

	node := rctx.nodeSpecs["check"]
	err = s.executeConditional(ctx, rctx, node)
	if err != nil {
		t.Fatalf("executeConditional failed: %v", err)
	}

	// path_b should be skipped since "true" evaluates to truthy
	stateB, _ := store.GetNodeState(ctx, runID, "path_b")
	if stateB.Status != types.NodeStatusSkipped {
		t.Errorf("path_b should be skipped, got %v", stateB.Status)
	}
}

func TestExecuteConditional_NoConfig(t *testing.T) {
	s, store := newTestScheduler(t)
	ctx := context.Background()

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:          "check",
				Type:        types.NodeTypeConditional,
				Conditional: nil, // No config
			},
		},
	}

	runID, err := store.CreateRun(ctx, "test-no-config", plan)
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

	node := rctx.nodeSpecs["check"]
	err = s.executeConditional(ctx, rctx, node)
	if err == nil {
		t.Error("Expected error for nil conditional config")
	}
}

func TestExecuteConditional_EmitEvents(t *testing.T) {
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
				ID:   "check",
				Type: types.NodeTypeConditional,
				Conditional: &types.ConditionalConfig{
					Type:       "if",
					Expression: "inputs.input.value > 10",
					Branches: map[string]types.ConditionalBranch{
						"true":  {Targets: []string{"path_true"}},
						"false": {Targets: []string{"path_false"}},
					},
				},
				Inputs: []string{"input"},
			},
			{ID: "path_true", Type: "agent", Inputs: []string{"check"}},
			{ID: "path_false", Type: "agent", Inputs: []string{"check"}},
		},
	}

	runID, err := store.CreateRun(ctx, "test-events", plan)
	if err != nil {
		t.Fatalf("Failed to create run: %v", err)
	}

	if err := store.SetNodeOutputs(ctx, runID, "input", map[string]interface{}{"value": 20}); err != nil {
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
	rctx.dependents["check"] = map[string]bool{
		"path_true":  true,
		"path_false": true,
	}

	node := rctx.nodeSpecs["check"]
	err = s.executeConditional(ctx, rctx, node)
	if err != nil {
		t.Fatalf("executeConditional failed: %v", err)
	}

	// Wait a bit for events to be emitted
	time.Sleep(10 * time.Millisecond)

	// Get events from store
	events, err := store.GetEventsSince(ctx, runID, "")
	if err != nil {
		t.Fatalf("Failed to get events: %v", err)
	}

	var foundEvaluated, foundSelected, foundSkipped bool
	for _, event := range events {
		switch event.Type {
		case types.EventTypeConditionEvaluated:
			foundEvaluated = true
		case types.EventTypeBranchSelected:
			foundSelected = true
		case types.EventTypeBranchSkipped:
			foundSkipped = true
		}
	}

	if !foundEvaluated {
		t.Error("Expected condition_evaluated event")
	}
	if !foundSelected {
		t.Error("Expected branch_selected event")
	}
	if !foundSkipped {
		t.Error("Expected branch_skipped event")
	}
}
