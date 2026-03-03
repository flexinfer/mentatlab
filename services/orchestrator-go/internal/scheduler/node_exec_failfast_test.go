package scheduler

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func TestRunFailsFastWhenAgentCommandCannotBeResolved(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			t.Fatal("driver should not be called when command resolution fails")
			return 0, nil
		},
	}
	s := New(store, driver, testCommandResolver, nil, slog.Default())

	ctx := context.Background()
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "agent_no_command", Type: "agent"},
		},
	}

	runID, err := store.CreateRun(ctx, "failfast-no-command", plan, "")
	if err != nil {
		t.Fatalf("create run: %v", err)
	}
	if err := s.EnqueueRun(ctx, runID, "failfast-no-command", plan); err != nil {
		t.Fatalf("enqueue run: %v", err)
	}
	if err := s.StartRun(ctx, runID); err != nil {
		t.Fatalf("start run: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		run, getErr := store.GetRun(ctx, runID)
		if getErr != nil {
			t.Fatalf("get run: %v", getErr)
		}
		if run.Status == types.RunStatusFailed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("run did not fail in time, current status=%s", run.Status)
		}
		time.Sleep(20 * time.Millisecond)
	}

	state, err := store.GetNodeState(ctx, runID, "agent_no_command")
	if err != nil {
		t.Fatalf("get node state: %v", err)
	}
	if state.Status != types.NodeStatusFailed {
		t.Fatalf("expected node status failed, got %s", state.Status)
	}
	if state.ExitCode == nil || *state.ExitCode == 0 {
		t.Fatalf("expected non-zero node exit code, got %+v", state.ExitCode)
	}

	events, err := store.GetEventsSince(ctx, runID, "")
	if err != nil {
		t.Fatalf("get events: %v", err)
	}

	foundResolutionError := false
	for _, event := range events {
		if event.Type != types.EventType("node_status") {
			continue
		}
		var data map[string]interface{}
		if unmarshalErr := json.Unmarshal(event.Data, &data); unmarshalErr != nil {
			continue
		}
		if data["nodeId"] == "agent_no_command" &&
			data["status"] == "failed" &&
			data["reason"] == "command_resolution_failed" {
			foundResolutionError = true
			break
		}
	}

	if !foundResolutionError {
		t.Fatal("expected explicit command_resolution_failed node_status event")
	}
}
