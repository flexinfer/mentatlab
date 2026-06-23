package scheduler

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// Shutdown on an idle scheduler returns immediately and then rejects new runs.
func TestShutdown_IdleThenRejectsNewRuns(t *testing.T) {
	s, _ := newTestScheduler(t)

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := s.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown on idle scheduler: %v", err)
	}

	err := s.EnqueueRun(context.Background(), "r1", "r1", &types.Plan{
		Nodes: []types.NodeSpec{{ID: "n1"}},
	})
	if !errors.Is(err, ErrSchedulerDraining) {
		t.Fatalf("EnqueueRun after Shutdown = %v, want ErrSchedulerDraining", err)
	}
	if n := s.ActiveRuns(); n != 0 {
		t.Fatalf("ActiveRuns = %d, want 0", n)
	}
}

// Shutdown waits for in-flight runs and honors the context deadline: an
// enqueued run that never finishes makes Shutdown return the ctx error rather
// than abandoning it silently.
func TestShutdown_WaitsForInFlightRunsUntilDeadline(t *testing.T) {
	s, _ := newTestScheduler(t)

	if err := s.EnqueueRun(context.Background(), "r1", "r1", &types.Plan{
		Nodes: []types.NodeSpec{{ID: "n1"}},
	}); err != nil {
		t.Fatalf("EnqueueRun: %v", err)
	}
	if n := s.ActiveRuns(); n != 1 {
		t.Fatalf("ActiveRuns = %d, want 1", n)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	start := time.Now()
	err := s.Shutdown(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Shutdown = %v, want context.DeadlineExceeded (must wait for the in-flight run)", err)
	}
	if elapsed := time.Since(start); elapsed < 100*time.Millisecond {
		t.Fatalf("Shutdown returned after %v; expected it to block until the deadline", elapsed)
	}
}
