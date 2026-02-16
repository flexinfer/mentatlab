package scheduler

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// --- M5.3: Run-level timeout tests ---

func TestRunTimeout_ContextExpires(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	// Use a slow driver that takes 5s per node
	drv := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			select {
			case <-ctx.Done():
				return 1, ctx.Err()
			case <-time.After(5 * time.Second):
				return 0, nil
			}
		},
	}

	cfg := &Config{DefaultRunTimeout: 200 * time.Millisecond}
	s := New(store, drv, testCommandResolver, cfg, slog.Default())

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "slow", Type: "agent", Command: []string{"sleep"}},
		},
	}

	ctx := context.Background()
	runID, err := store.CreateRun(ctx, "timeout-test", plan, "")
	if err != nil {
		t.Fatalf("failed to create run: %v", err)
	}

	if err := s.EnqueueRun(ctx, runID, "timeout-test", plan); err != nil {
		t.Fatalf("failed to enqueue: %v", err)
	}
	if err := s.StartRun(ctx, runID); err != nil {
		t.Fatalf("failed to start: %v", err)
	}

	// Wait for the timeout to fire
	time.Sleep(500 * time.Millisecond)

	run, err := store.GetRun(ctx, runID)
	if err != nil {
		t.Fatalf("failed to get run: %v", err)
	}
	if run.Status != types.RunStatusFailed {
		t.Errorf("expected run status failed, got %s", run.Status)
	}
}

func TestRunTimeout_PlanOverridesDefault(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	drv := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			select {
			case <-ctx.Done():
				return 1, ctx.Err()
			case <-time.After(5 * time.Second):
				return 0, nil
			}
		},
	}

	// Default timeout is very long, but plan overrides it to short
	cfg := &Config{DefaultRunTimeout: 10 * time.Minute}
	s := New(store, drv, testCommandResolver, cfg, slog.Default())

	plan := &types.Plan{
		Timeout: 200 * time.Millisecond,
		Nodes: []types.NodeSpec{
			{ID: "slow", Type: "agent", Command: []string{"sleep"}},
		},
	}

	ctx := context.Background()
	runID, _ := store.CreateRun(ctx, "plan-timeout-test", plan, "")
	s.EnqueueRun(ctx, runID, "plan-timeout-test", plan)
	s.StartRun(ctx, runID)

	time.Sleep(500 * time.Millisecond)

	run, _ := store.GetRun(ctx, runID)
	if run.Status != types.RunStatusFailed {
		t.Errorf("expected run status failed (plan timeout), got %s", run.Status)
	}
}

// --- M5.4: Per-node retry policy tests ---

func TestResolveRetryPolicy_Exponential(t *testing.T) {
	s := &Scheduler{defaultBackoffSecs: 2}

	spec := &types.NodeSpec{
		RetryPolicy: &types.RetryPolicy{
			MaxRetries:  3,
			BackoffType: types.BackoffExponential,
			BackoffBase: 1 * time.Second,
			BackoffMax:  30 * time.Second,
		},
	}

	maxR, backoff0 := s.resolveRetryPolicy(spec, 0)
	if maxR != 3 {
		t.Errorf("expected maxRetries=3, got %d", maxR)
	}
	if backoff0 != 1.0 { // 1 * 2^0 = 1
		t.Errorf("expected backoff=1.0 for attempt 0, got %f", backoff0)
	}

	_, backoff1 := s.resolveRetryPolicy(spec, 1)
	if backoff1 != 2.0 { // 1 * 2^1 = 2
		t.Errorf("expected backoff=2.0 for attempt 1, got %f", backoff1)
	}

	_, backoff2 := s.resolveRetryPolicy(spec, 2)
	if backoff2 != 4.0 { // 1 * 2^2 = 4
		t.Errorf("expected backoff=4.0 for attempt 2, got %f", backoff2)
	}
}

func TestResolveRetryPolicy_Fixed(t *testing.T) {
	s := &Scheduler{defaultBackoffSecs: 2}

	spec := &types.NodeSpec{
		RetryPolicy: &types.RetryPolicy{
			MaxRetries:  5,
			BackoffType: types.BackoffFixed,
			BackoffBase: 3 * time.Second,
		},
	}

	for attempt := 0; attempt < 5; attempt++ {
		_, backoff := s.resolveRetryPolicy(spec, attempt)
		if backoff != 3.0 {
			t.Errorf("expected fixed backoff=3.0 for attempt %d, got %f", attempt, backoff)
		}
	}
}

func TestResolveRetryPolicy_Linear(t *testing.T) {
	s := &Scheduler{defaultBackoffSecs: 2}

	spec := &types.NodeSpec{
		RetryPolicy: &types.RetryPolicy{
			MaxRetries:  4,
			BackoffType: types.BackoffLinear,
			BackoffBase: 2 * time.Second,
			BackoffMax:  10 * time.Second,
		},
	}

	_, backoff0 := s.resolveRetryPolicy(spec, 0)
	if backoff0 != 2.0 { // 2 * 1 = 2
		t.Errorf("expected backoff=2.0 for attempt 0, got %f", backoff0)
	}

	_, backoff1 := s.resolveRetryPolicy(spec, 1)
	if backoff1 != 4.0 { // 2 * 2 = 4
		t.Errorf("expected backoff=4.0 for attempt 1, got %f", backoff1)
	}

	_, backoff4 := s.resolveRetryPolicy(spec, 4)
	if backoff4 != 10.0 { // 2 * 5 = 10, capped at 10
		t.Errorf("expected backoff=10.0 (capped) for attempt 4, got %f", backoff4)
	}
}

func TestResolveRetryPolicy_FallbackToLegacy(t *testing.T) {
	s := &Scheduler{defaultBackoffSecs: 2}

	spec := &types.NodeSpec{
		Retries: 2, // legacy field
	}

	maxR, backoff := s.resolveRetryPolicy(spec, 0)
	if maxR != 2 {
		t.Errorf("expected maxRetries=2, got %d", maxR)
	}
	if backoff != 2.0 { // 2 * 2^0 = 2
		t.Errorf("expected backoff=2.0, got %f", backoff)
	}
}

func TestResolveRetryPolicy_BackoffCap(t *testing.T) {
	s := &Scheduler{defaultBackoffSecs: 2}

	spec := &types.NodeSpec{
		RetryPolicy: &types.RetryPolicy{
			MaxRetries:  10,
			BackoffType: types.BackoffExponential,
			BackoffBase: 1 * time.Second,
			BackoffMax:  5 * time.Second,
		},
	}

	_, backoff := s.resolveRetryPolicy(spec, 10)
	if backoff != 5.0 {
		t.Errorf("expected backoff capped at 5.0, got %f", backoff)
	}
}

// --- M6.1: Gate node tests ---

func TestGateApprove(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	drv := &mockDriver{}
	s := New(store, drv, testCommandResolver, nil, slog.Default())

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "gate1",
				Type: types.NodeTypeGate,
				Gate: &types.GateConfig{
					Description: "Approve deployment?",
				},
			},
			{
				ID:     "deploy",
				Type:   "agent",
				Inputs: []string{"gate1"},
				Command: []string{"deploy"},
			},
		},
		Edges: []types.EdgeSpec{
			{From: "gate1", To: "deploy"},
		},
	}

	ctx := context.Background()
	runID, _ := store.CreateRun(ctx, "gate-test", plan, "")
	s.EnqueueRun(ctx, runID, "gate-test", plan)
	s.StartRun(ctx, runID)

	// Wait for the gate to enter waiting_approval
	time.Sleep(100 * time.Millisecond)

	state, err := store.GetNodeState(ctx, runID, "gate1")
	if err != nil {
		t.Fatalf("failed to get gate state: %v", err)
	}
	if state.Status != types.NodeStatusWaitingApproval {
		t.Errorf("expected waiting_approval, got %s", state.Status)
	}

	// Approve the gate
	if err := s.ApproveGate(runID, "gate1"); err != nil {
		t.Fatalf("failed to approve gate: %v", err)
	}

	// Wait for the gate to complete
	time.Sleep(200 * time.Millisecond)

	state, _ = store.GetNodeState(ctx, runID, "gate1")
	if state.Status != types.NodeStatusSucceeded {
		t.Errorf("expected gate succeeded after approve, got %s", state.Status)
	}
}

func TestGateReject(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	drv := &mockDriver{}
	s := New(store, drv, testCommandResolver, nil, slog.Default())

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "gate1",
				Type: types.NodeTypeGate,
				Gate: &types.GateConfig{
					Description: "Approve?",
				},
			},
		},
	}

	ctx := context.Background()
	runID, _ := store.CreateRun(ctx, "gate-reject", plan, "")
	s.EnqueueRun(ctx, runID, "gate-reject", plan)
	s.StartRun(ctx, runID)

	time.Sleep(100 * time.Millisecond)

	if err := s.RejectGate(runID, "gate1"); err != nil {
		t.Fatalf("failed to reject gate: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	state, _ := store.GetNodeState(ctx, runID, "gate1")
	if state.Status != types.NodeStatusFailed {
		t.Errorf("expected gate failed after reject, got %s", state.Status)
	}
}

func TestGateTimeout_AutoReject(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	drv := &mockDriver{}
	s := New(store, drv, testCommandResolver, nil, slog.Default())

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:   "gate1",
				Type: types.NodeTypeGate,
				Gate: &types.GateConfig{
					Description: "Will auto-reject",
					Timeout:     100 * time.Millisecond,
					AutoReject:  true,
				},
			},
		},
	}

	ctx := context.Background()
	runID, _ := store.CreateRun(ctx, "gate-timeout", plan, "")
	s.EnqueueRun(ctx, runID, "gate-timeout", plan)
	s.StartRun(ctx, runID)

	// Wait for the timeout
	time.Sleep(400 * time.Millisecond)

	state, _ := store.GetNodeState(ctx, runID, "gate1")
	if state.Status != types.NodeStatusFailed {
		t.Errorf("expected gate failed after auto-reject timeout, got %s", state.Status)
	}
}

func TestGateSignal_InvalidRun(t *testing.T) {
	s := New(runstore.NewMemoryStore(nil), &mockDriver{}, testCommandResolver, nil, slog.Default())

	err := s.ApproveGate("nonexistent", "gate1")
	if err == nil {
		t.Error("expected error for nonexistent run")
	}
}

// --- Cron tests ---

func TestCronMatches(t *testing.T) {
	tests := []struct {
		expr    string
		t       time.Time
		matches bool
	}{
		{"* * * * *", time.Date(2025, 1, 1, 12, 30, 0, 0, time.UTC), true},
		{"30 12 * * *", time.Date(2025, 1, 1, 12, 30, 0, 0, time.UTC), true},
		{"0 12 * * *", time.Date(2025, 1, 1, 12, 30, 0, 0, time.UTC), false},
		{"*/5 * * * *", time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC), true},
		{"*/5 * * * *", time.Date(2025, 1, 1, 12, 10, 0, 0, time.UTC), true},
		{"*/5 * * * *", time.Date(2025, 1, 1, 12, 3, 0, 0, time.UTC), false},
		{"0 9 * * 1", time.Date(2025, 1, 6, 9, 0, 0, 0, time.UTC), true},  // Monday
		{"0 9 * * 1", time.Date(2025, 1, 7, 9, 0, 0, 0, time.UTC), false}, // Tuesday
		{"0 0 1 * *", time.Date(2025, 3, 1, 0, 0, 0, 0, time.UTC), true},
		{"0 0 1 * *", time.Date(2025, 3, 2, 0, 0, 0, 0, time.UTC), false},
		{"0 0 * * 0,6", time.Date(2025, 1, 4, 0, 0, 0, 0, time.UTC), true}, // Saturday
	}

	for _, tt := range tests {
		result := cronMatches(tt.expr, tt.t)
		if result != tt.matches {
			t.Errorf("cronMatches(%q, %v) = %v, want %v", tt.expr, tt.t, result, tt.matches)
		}
	}
}

func TestParseCron_Valid(t *testing.T) {
	exprs := []string{
		"* * * * *",
		"0 12 * * *",
		"*/5 * * * *",
		"0 9 * * 1-5",
		"0,30 * * * *",
		"0 0 1,15 * *",
	}

	for _, expr := range exprs {
		_, err := parseCron(expr)
		if err != nil {
			t.Errorf("parseCron(%q) returned error: %v", expr, err)
		}
	}
}

func TestParseCron_Invalid(t *testing.T) {
	exprs := []string{
		"",
		"* * *",         // too few fields
		"* * * * * *",   // too many fields
		"60 * * * *",    // minute out of range
		"abc * * * *",   // not a number
	}

	for _, expr := range exprs {
		_, err := parseCron(expr)
		if err == nil {
			t.Errorf("parseCron(%q) should have returned error", expr)
		}
	}
}

func TestCronRunner_AddRemoveSchedule(t *testing.T) {
	cr := NewCronRunner(nil, nil, nil, slog.Default())

	sched := &Schedule{
		ID:      "test-1",
		FlowID:  "flow-1",
		Cron:    "* * * * *",
		Enabled: true,
	}

	if err := cr.AddSchedule(sched); err != nil {
		t.Fatalf("AddSchedule failed: %v", err)
	}

	list := cr.ListSchedules()
	if len(list) != 1 {
		t.Errorf("expected 1 schedule, got %d", len(list))
	}

	got, err := cr.GetSchedule("test-1")
	if err != nil {
		t.Fatalf("GetSchedule failed: %v", err)
	}
	if got.FlowID != "flow-1" {
		t.Errorf("expected flow-1, got %s", got.FlowID)
	}

	if err := cr.RemoveSchedule("test-1"); err != nil {
		t.Fatalf("RemoveSchedule failed: %v", err)
	}

	list = cr.ListSchedules()
	if len(list) != 0 {
		t.Errorf("expected 0 schedules after removal, got %d", len(list))
	}
}

func TestCronRunner_InvalidCron(t *testing.T) {
	cr := NewCronRunner(nil, nil, nil, slog.Default())

	sched := &Schedule{
		ID:      "bad-1",
		FlowID:  "flow-1",
		Cron:    "not valid",
		Enabled: true,
	}

	if err := cr.AddSchedule(sched); err == nil {
		t.Error("expected error for invalid cron expression")
	}
}
