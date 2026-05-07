package scheduler

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

type resumeCapturingDriver struct {
	env map[string]string
}

func (d *resumeCapturingDriver) RunNode(_ context.Context, _, _ string, _ []string, env map[string]string, _ float64) (int, error) {
	d.env = make(map[string]string, len(env))
	for k, v := range env {
		d.env[k] = v
	}
	return 0, nil
}

func TestAgentExecutorInjectsResumeStateOnRetry(t *testing.T) {
	ctx := context.Background()
	store := runstore.NewMemoryStore(nil)
	driver := &resumeCapturingDriver{}
	s := NewScheduler(store, driver, func(node *types.NodeSpec) []string {
		return []string{"noop"}
	})

	spec := &types.NodeSpec{
		ID:      "node-1",
		Type:    "agent",
		Command: []string{"noop"},
		Env: map[string]string{
			"INPUT_CONTEXT": `{"existing":true}`,
		},
	}
	runID, err := store.CreateRun(ctx, "resume-test", &types.Plan{Nodes: []types.NodeSpec{*spec}}, "")
	if err != nil {
		t.Fatalf("CreateRun failed: %v", err)
	}
	if err := store.UpdateNodeState(ctx, runID, "node-1", &types.NodeState{
		NodeID:  "node-1",
		Status:  types.NodeStatusPending,
		Retries: 1,
	}); err != nil {
		t.Fatalf("UpdateNodeState failed: %v", err)
	}
	if _, err := store.AppendEvent(ctx, runID, &types.EventInput{
		Type:   types.EventTypeCheckpoint,
		NodeID: "node-1",
		Data: map[string]interface{}{
			"type": "checkpoint",
			"data": map[string]interface{}{
				"stage": "page",
				"state": map[string]interface{}{"cursor": "abc", "offset": float64(7)},
			},
		},
	}); err != nil {
		t.Fatalf("AppendEvent failed: %v", err)
	}

	rctx := &runContext{
		runID:      runID,
		dependents: map[string]map[string]bool{},
	}
	exitCode, err := (&agentExecutor{}).Execute(ctx, s, rctx, "node-1", spec)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}
	if exitCode != 0 {
		t.Fatalf("exitCode = %d, want 0", exitCode)
	}

	if got, want := driver.env["RESUME_STATE"], `{"cursor":"abc","offset":7}`; got != want {
		t.Fatalf("RESUME_STATE = %s, want %s", got, want)
	}

	var inputContext map[string]interface{}
	if err := json.Unmarshal([]byte(driver.env["INPUT_CONTEXT"]), &inputContext); err != nil {
		t.Fatalf("INPUT_CONTEXT is not JSON: %v", err)
	}
	if inputContext["existing"] != true {
		t.Fatalf("existing context not preserved: %#v", inputContext)
	}
	resume, ok := inputContext["resume_state"].(map[string]interface{})
	if !ok {
		t.Fatalf("resume_state missing or wrong type: %#v", inputContext["resume_state"])
	}
	if resume["cursor"] != "abc" || resume["offset"] != float64(7) {
		t.Fatalf("resume_state = %#v, want cursor abc offset 7", resume)
	}
}
