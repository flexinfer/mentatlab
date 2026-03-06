package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

type sessionUpdate struct {
	sessionID string
	runID     string
	status    string
	content   string
}

type mockRunSessionManager struct {
	mu      sync.Mutex
	started []string
	updates []sessionUpdate
	ended   []string
}

func (m *mockRunSessionManager) StartRunSession(_ context.Context, runID, _ string, _ string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	sessionID := "session-" + runID
	m.started = append(m.started, sessionID)
	return sessionID, nil
}

func (m *mockRunSessionManager) AddRunUpdate(_ context.Context, sessionID, runID, status, content string, _ map[string]interface{}) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.updates = append(m.updates, sessionUpdate{
		sessionID: sessionID,
		runID:     runID,
		status:    status,
		content:   content,
	})
	return nil
}

func (m *mockRunSessionManager) EndRunSession(_ context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ended = append(m.ended, sessionID)
	return nil
}

func TestRunSessionLifecycleOnSucceededRun(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			return 0, nil
		},
	}
	manager := &mockRunSessionManager{}
	s := NewScheduler(
		store,
		driver,
		testCommandResolver,
		WithLogger(slog.Default()),
		WithRunSessionManager(manager),
	)

	ctx := context.Background()
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "n1", Type: "agent", Command: []string{"echo", "ok"}},
		},
	}

	runID, err := store.CreateRun(ctx, "session-test", plan, "owner@example.com")
	if err != nil {
		t.Fatalf("create run: %v", err)
	}
	if err := s.EnqueueRun(ctx, runID, "session-test", plan); err != nil {
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
		manager.mu.Lock()
		endedCount := len(manager.ended)
		manager.mu.Unlock()

		if run.Status == types.RunStatusSucceeded && endedCount == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("run/session lifecycle did not complete in time, status=%s", run.Status)
		}
		time.Sleep(25 * time.Millisecond)
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()

	if len(manager.started) != 1 {
		t.Fatalf("expected 1 session start, got %d", len(manager.started))
	}
	if len(manager.ended) != 1 {
		t.Fatalf("expected 1 session end, got %d", len(manager.ended))
	}
	if manager.started[0] != manager.ended[0] {
		t.Fatalf("session start/end mismatch: started=%q ended=%q", manager.started[0], manager.ended[0])
	}
	// Expect at least 3 updates: run-running, node-succeeded, run-succeeded
	if len(manager.updates) < 3 {
		t.Fatalf("expected at least 3 session updates (run-running, node, run-final), got %d", len(manager.updates))
	}
	if manager.updates[0].status != string(types.RunStatusRunning) {
		t.Fatalf("expected first update status=%q, got %q", types.RunStatusRunning, manager.updates[0].status)
	}

	// Find node-level update
	var foundNodeUpdate bool
	for _, u := range manager.updates {
		if u.status == string(types.NodeStatusSucceeded) && u.runID == runID {
			foundNodeUpdate = true
			break
		}
	}
	if !foundNodeUpdate {
		t.Fatalf("expected a node-level succeeded update, updates: %+v", manager.updates)
	}

	last := manager.updates[len(manager.updates)-1]
	if last.status != string(types.RunStatusSucceeded) {
		t.Fatalf("expected final update status=%q, got %q", types.RunStatusSucceeded, last.status)
	}
	if last.runID != runID {
		t.Fatalf("expected final update runID=%q, got %q", runID, last.runID)
	}
	if last.content == "" {
		t.Fatal("expected final update to include summary content")
	}
}

func TestRunSessionLifecycleOnFailedRun(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			return 1, fmt.Errorf("node failed")
		},
	}
	manager := &mockRunSessionManager{}
	s := NewScheduler(
		store,
		driver,
		testCommandResolver,
		WithLogger(slog.Default()),
		WithRunSessionManager(manager),
	)

	ctx := context.Background()
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "n1", Type: "agent", Command: []string{"false"}},
		},
	}

	runID, err := store.CreateRun(ctx, "session-fail-test", plan, "owner@example.com")
	if err != nil {
		t.Fatalf("create run: %v", err)
	}
	if err := s.EnqueueRun(ctx, runID, "session-fail-test", plan); err != nil {
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
			t.Fatalf("failed run did not complete in time, status=%s", run.Status)
		}
		time.Sleep(25 * time.Millisecond)
	}

	manager.mu.Lock()
	defer manager.mu.Unlock()
	if len(manager.started) != 1 || len(manager.ended) != 1 {
		t.Fatalf("expected one started and one ended session, got started=%d ended=%d", len(manager.started), len(manager.ended))
	}
	// Expect at least 3 updates: run-running, node-failed, run-failed
	if len(manager.updates) < 3 {
		t.Fatalf("expected at least 3 session updates (run-running, node-failed, run-failed), got %d: %+v", len(manager.updates), manager.updates)
	}

	// Find node-level failure update
	var foundNodeFailure bool
	for _, u := range manager.updates {
		if u.status == string(types.NodeStatusFailed) {
			foundNodeFailure = true
			break
		}
	}
	if !foundNodeFailure {
		t.Fatalf("expected a node-level failed update, updates: %+v", manager.updates)
	}

	last := manager.updates[len(manager.updates)-1]
	if last.status != string(types.RunStatusFailed) {
		t.Fatalf("expected final status failed, got %q", last.status)
	}
}
