package runstore

import (
	"context"
	"testing"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// helper: create a run and drive it into the running state.
func mkRun(t *testing.T, store RunStore, status types.RunStatus) string {
	t.Helper()
	ctx := context.Background()
	id, err := store.CreateRun(ctx, "r", &types.Plan{Nodes: []types.NodeSpec{{ID: "n1"}}}, "")
	if err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	if status != types.RunStatusQueued {
		if err := store.UpdateRunStatus(ctx, id, status, nil, nil); err != nil {
			t.Fatalf("UpdateRunStatus: %v", err)
		}
	}
	return id
}

func TestRecoverInterruptedRuns_FailsRunningRuns(t *testing.T) {
	store, _ := newTestRedisStore(t)
	ctx := context.Background()

	running := mkRun(t, store, types.RunStatusRunning)
	queued := mkRun(t, store, types.RunStatusQueued)
	// mark a node running so we can assert it gets failed too
	if err := store.UpdateNodeState(ctx, running, "n1", &types.NodeState{
		NodeID: "n1", Status: types.NodeStatusRunning,
	}); err != nil {
		t.Fatalf("UpdateNodeState: %v", err)
	}

	n, err := RecoverInterruptedRuns(ctx, store, nil)
	if err != nil {
		t.Fatalf("RecoverInterruptedRuns: %v", err)
	}
	if n != 2 {
		t.Fatalf("recovered = %d, want 2 (running + queued)", n)
	}

	for _, id := range []string{running, queued} {
		run, err := store.GetRun(ctx, id)
		if err != nil {
			t.Fatalf("GetRun(%s): %v", id, err)
		}
		if run.Status != types.RunStatusFailed {
			t.Errorf("run %s status = %q, want failed", id, run.Status)
		}
		if run.FinishedAt == nil {
			t.Errorf("run %s FinishedAt not set", id)
		}
	}

	ns, err := store.GetNodeState(ctx, running, "n1")
	if err != nil {
		t.Fatalf("GetNodeState: %v", err)
	}
	if ns.Status != types.NodeStatusFailed {
		t.Errorf("node status = %q, want failed", ns.Status)
	}

	// A terminal status event must be observable for the recovered run.
	events, err := store.GetEventsSince(ctx, running, "")
	if err != nil {
		t.Fatalf("GetEventsSince: %v", err)
	}
	found := false
	for _, e := range events {
		if e.Type == types.EventType("status") {
			found = true
		}
	}
	if !found {
		t.Error("expected a terminal status event for the recovered run")
	}
}

func TestRecoverInterruptedRuns_LeavesTerminalRunsAlone(t *testing.T) {
	store, _ := newTestRedisStore(t)
	ctx := context.Background()

	done := mkRun(t, store, types.RunStatusSucceeded)
	cancelled := mkRun(t, store, types.RunStatusCancelled)

	n, err := RecoverInterruptedRuns(ctx, store, nil)
	if err != nil {
		t.Fatalf("RecoverInterruptedRuns: %v", err)
	}
	if n != 0 {
		t.Fatalf("recovered = %d, want 0 (no non-terminal runs)", n)
	}

	d, _ := store.GetRun(ctx, done)
	if d.Status != types.RunStatusSucceeded {
		t.Errorf("succeeded run mutated to %q", d.Status)
	}
	c, _ := store.GetRun(ctx, cancelled)
	if c.Status != types.RunStatusCancelled {
		t.Errorf("cancelled run mutated to %q", c.Status)
	}
}

// Memory store with no runs must be a clean no-op.
func TestRecoverInterruptedRuns_EmptyMemoryStore(t *testing.T) {
	store := NewMemoryStore(nil)
	n, err := RecoverInterruptedRuns(context.Background(), store, nil)
	if err != nil {
		t.Fatalf("RecoverInterruptedRuns: %v", err)
	}
	if n != 0 {
		t.Fatalf("recovered = %d, want 0", n)
	}
}
