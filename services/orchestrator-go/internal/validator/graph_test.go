package validator

import (
	"strings"
	"testing"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func TestValidatePlanGraph_NilPlan(t *testing.T) {
	result := ValidatePlanGraph(nil)
	if !result.Valid {
		t.Fatal("nil plan should be valid")
	}
}

func TestValidatePlanGraph_EmptyNodes(t *testing.T) {
	result := ValidatePlanGraph(&types.Plan{})
	if !result.Valid {
		t.Fatal("empty plan should be valid")
	}
}

func TestValidatePlanGraph_SimpleLinear(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
			{ID: "b"},
			{ID: "c"},
		},
		Edges: []types.EdgeSpec{
			{From: "a", To: "b"},
			{From: "b", To: "c"},
		},
	}
	result := ValidatePlanGraph(plan)
	if !result.Valid {
		t.Fatalf("linear DAG should be valid, got errors: %v", result.Errors)
	}
}

func TestValidatePlanGraph_Diamond(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
			{ID: "b"},
			{ID: "c"},
			{ID: "d"},
		},
		Edges: []types.EdgeSpec{
			{From: "a", To: "b"},
			{From: "a", To: "c"},
			{From: "b", To: "d"},
			{From: "c", To: "d"},
		},
	}
	result := ValidatePlanGraph(plan)
	if !result.Valid {
		t.Fatalf("diamond DAG should be valid, got errors: %v", result.Errors)
	}
}

func TestValidatePlanGraph_SingleNode(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "solo"},
		},
	}
	result := ValidatePlanGraph(plan)
	if !result.Valid {
		t.Fatalf("single node should be valid, got errors: %v", result.Errors)
	}
}

func TestValidatePlanGraph_DisconnectedNodes(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
			{ID: "b"},
			{ID: "c"},
		},
	}
	result := ValidatePlanGraph(plan)
	if !result.Valid {
		t.Fatalf("disconnected nodes should be valid, got errors: %v", result.Errors)
	}
}

func TestValidatePlanGraph_InputsDependencies(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
			{ID: "b", Inputs: []string{"a"}},
			{ID: "c", Inputs: []string{"b"}},
		},
	}
	result := ValidatePlanGraph(plan)
	if !result.Valid {
		t.Fatalf("inputs-based DAG should be valid, got errors: %v", result.Errors)
	}
}

func TestValidatePlanGraph_DuplicateNodeIDs(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
			{ID: "b"},
			{ID: "a"},
		},
	}
	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("duplicate node IDs should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, "duplicate node ID") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected duplicate node ID error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_DanglingEdgeFrom(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
		},
		Edges: []types.EdgeSpec{
			{From: "missing", To: "a"},
		},
	}
	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("dangling edge 'from' should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, "non-existent node \"missing\"") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected dangling edge error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_DanglingEdgeTo(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
		},
		Edges: []types.EdgeSpec{
			{From: "a", To: "missing"},
		},
	}
	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("dangling edge 'to' should be invalid")
	}
}

func TestValidatePlanGraph_DanglingInput(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a", Inputs: []string{"missing"}},
		},
	}
	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("dangling input reference should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, "non-existent input \"missing\"") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected dangling input error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_SimpleCycle(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
			{ID: "b"},
		},
		Edges: []types.EdgeSpec{
			{From: "a", To: "b"},
			{From: "b", To: "a"},
		},
	}
	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("cycle should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, "cycle detected") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected cycle error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_SelfLoop(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
		},
		Edges: []types.EdgeSpec{
			{From: "a", To: "a"},
		},
	}
	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("self-loop should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, "cycle detected") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected cycle error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_ThreeNodeCycle(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
			{ID: "b"},
			{ID: "c"},
		},
		Edges: []types.EdgeSpec{
			{From: "a", To: "b"},
			{From: "b", To: "c"},
			{From: "c", To: "a"},
		},
	}
	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("3-node cycle should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, "cycle detected") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected cycle error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_CycleViaInputs(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a", Inputs: []string{"b"}},
			{ID: "b", Inputs: []string{"a"}},
		},
	}
	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("cycle via inputs should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, "cycle detected") {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected cycle error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_CycleInSubgraph(t *testing.T) {
	// DAG portion: a→b, plus a cycle: c→d→c
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
			{ID: "b"},
			{ID: "c"},
			{ID: "d"},
		},
		Edges: []types.EdgeSpec{
			{From: "a", To: "b"},
			{From: "c", To: "d"},
			{From: "d", To: "c"},
		},
	}
	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("cycle in subgraph should be invalid")
	}
}

func TestValidatePlanGraph_MixedEdgesAndInputs(t *testing.T) {
	// Valid: a→b via edge, b→c via input
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a"},
			{ID: "b"},
			{ID: "c", Inputs: []string{"b"}},
		},
		Edges: []types.EdgeSpec{
			{From: "a", To: "b"},
		},
	}
	result := ValidatePlanGraph(plan)
	if !result.Valid {
		t.Fatalf("mixed edges+inputs DAG should be valid, got errors: %v", result.Errors)
	}
}

func TestValidatePlanGraph_ConditionalIfMissingFalseBranch(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "cond",
				Type: types.NodeTypeConditional,
				Conditional: &types.ConditionalConfig{
					Type:       "if",
					Expression: "inputs.score > 0",
					Branches: map[string]types.ConditionalBranch{
						"true": {Targets: []string{"ok"}},
					},
				},
			},
			{ID: "ok"},
		},
	}

	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("conditional missing false branch should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, "requires \"false\" branch") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected missing false branch error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_ConditionalBranchTargetMissingNode(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "cond",
				Type: types.NodeTypeConditional,
				Conditional: &types.ConditionalConfig{
					Type:       "if",
					Expression: "inputs.score > 0",
					Branches: map[string]types.ConditionalBranch{
						"true":  {Targets: []string{"ok"}},
						"false": {Targets: []string{"missing"}},
					},
				},
			},
			{ID: "ok"},
		},
	}

	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("conditional branch with missing target should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, `references non-existent target "missing"`) {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected missing conditional target error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_ConditionalTypeRequiresConfig(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "cond", Type: types.NodeTypeConditional},
		},
	}

	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("conditional node without config should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, "requires conditional config") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected missing conditional config error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_ForEachBodyMissingNode(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "loop",
				Type: types.NodeTypeForEach,
				ForEach: &types.ForEachConfig{
					Collection:  "inputs.items",
					ItemVar:     "item",
					MaxParallel: 1,
					Body:        []string{"missing"},
				},
			},
		},
	}

	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("for_each body referencing missing node should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, `body references non-existent node "missing"`) {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected missing for_each body node error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_ForEachMaxParallelSafetyCap(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "loop",
				Type: types.NodeTypeForEach,
				ForEach: &types.ForEachConfig{
					Collection:  "inputs.items",
					ItemVar:     "item",
					MaxParallel: maxForEachParallel + 1,
					Body:        []string{"body"},
				},
			},
			{ID: "body"},
		},
	}

	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("for_each max_parallel above cap should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, "exceeds safety cap") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected max_parallel cap error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_ForEachTypeRequiresConfig(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "loop", Type: types.NodeTypeForEach},
		},
	}

	result := ValidatePlanGraph(plan)
	if result.Valid {
		t.Fatal("for_each node without config should be invalid")
	}
	found := false
	for _, e := range result.Errors {
		if strings.Contains(e.Message, "requires for_each config") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected missing for_each config error, got: %v", result.Errors)
	}
}

func TestValidatePlanGraph_LargeFanOut(t *testing.T) {
	nodes := []types.NodeSpec{{ID: "root"}}
	edges := []types.EdgeSpec{}
	for i := 0; i < 50; i++ {
		id := "leaf-" + strings.Repeat("x", 1) + string(rune('a'+i%26)) + string(rune('0'+i/26))
		nodes = append(nodes, types.NodeSpec{ID: id})
		edges = append(edges, types.EdgeSpec{From: "root", To: id})
	}
	plan := &types.Plan{Nodes: nodes, Edges: edges}
	result := ValidatePlanGraph(plan)
	if !result.Valid {
		t.Fatalf("large fan-out should be valid, got errors: %v", result.Errors)
	}
}
