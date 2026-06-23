package scheduler

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func startGateRun(t *testing.T, gate *types.GateConfig) (*Scheduler, *runstore.MemoryStore, string) {
	t.Helper()
	store := runstore.NewMemoryStore(nil)
	s := New(store, &mockDriver{}, testCommandResolver, nil, slog.Default())
	plan := &types.Plan{Nodes: []types.NodeSpec{{ID: "gate1", Type: types.NodeTypeGate, Gate: gate}}}
	ctx := context.Background()
	runID, _ := store.CreateRun(ctx, "gate", plan, "")
	if err := s.EnqueueRun(ctx, runID, "gate", plan); err != nil {
		t.Fatalf("EnqueueRun: %v", err)
	}
	if err := s.StartRun(ctx, runID); err != nil {
		t.Fatalf("StartRun: %v", err)
	}
	return s, store, runID
}

// A timed-out gate with no explicit auto-approve must REJECT (fail-safe).
// This is the regression test for the previous behavior, which auto-approved
// whenever AutoReject was false.
func TestGateTimeout_DefaultRejects(t *testing.T) {
	_, store, runID := startGateRun(t, &types.GateConfig{
		Description: "no explicit timeout policy",
		Timeout:     100 * time.Millisecond,
		// neither AutoReject nor AutoApprove set
	})

	time.Sleep(400 * time.Millisecond)

	state, _ := store.GetNodeState(context.Background(), runID, "gate1")
	if state.Status != types.NodeStatusFailed {
		t.Errorf("default timeout must be fail-safe (reject); got node status %s", state.Status)
	}
}

// A timed-out gate explicitly configured to auto-approve must SUCCEED.
func TestGateTimeout_AutoApprove(t *testing.T) {
	_, store, runID := startGateRun(t, &types.GateConfig{
		Description: "auto-approve on timeout",
		Timeout:     100 * time.Millisecond,
		AutoApprove: true,
	})

	time.Sleep(400 * time.Millisecond)

	state, _ := store.GetNodeState(context.Background(), runID, "gate1")
	if state.Status != types.NodeStatusSucceeded {
		t.Errorf("auto-approve timeout should succeed; got node status %s", state.Status)
	}
}

// Once a gate has resolved, a second decision is rejected (no double-approve).
func TestGateApproveTwice_SecondErrors(t *testing.T) {
	s, _, runID := startGateRun(t, &types.GateConfig{Description: "approve once"})

	time.Sleep(100 * time.Millisecond)
	if err := s.ApproveGate(runID, "gate1"); err != nil {
		t.Fatalf("first approve: %v", err)
	}
	time.Sleep(150 * time.Millisecond) // let the gate resolve + deregister

	if err := s.ApproveGate(runID, "gate1"); err == nil {
		t.Error("second approve on an already-resolved gate should error")
	}
}

// Signaling a valid run but a node that is not a waiting gate must error.
func TestGateSignal_UnknownNode(t *testing.T) {
	s, _, runID := startGateRun(t, &types.GateConfig{Description: "real gate"})

	time.Sleep(100 * time.Millisecond)
	if err := s.ApproveGate(runID, "does-not-exist"); err == nil {
		t.Error("approving an unknown node should error")
	}
}
