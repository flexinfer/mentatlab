package scheduler

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func TestSchedulerHonorsAgentMaxConcurrent(t *testing.T) {
	store := runstore.NewMemoryStore(nil)

	var running int32
	var maxRunning int32
	driver := &mockDriver{
		runNodeFunc: func(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
			curr := atomic.AddInt32(&running, 1)
			for {
				max := atomic.LoadInt32(&maxRunning)
				if curr <= max || atomic.CompareAndSwapInt32(&maxRunning, max, curr) {
					break
				}
			}
			time.Sleep(80 * time.Millisecond)
			atomic.AddInt32(&running, -1)
			return 0, nil
		},
	}

	s := New(store, driver, testCommandResolver, &Config{MaxParallelism: 4}, nil)

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "n1", Type: "agent", AgentID: "loom-mcp-executor", Command: []string{"echo"}, Resources: &types.ResourceRequirements{MaxConcurrent: 1}},
			{ID: "n2", Type: "agent", AgentID: "loom-mcp-executor", Command: []string{"echo"}, Resources: &types.ResourceRequirements{MaxConcurrent: 1}},
		},
	}

	ctx := context.Background()
	runID, err := store.CreateRun(ctx, "agent-max-concurrent", plan, "")
	if err != nil {
		t.Fatalf("create run: %v", err)
	}
	if err := s.EnqueueRun(ctx, runID, "agent-max-concurrent", plan); err != nil {
		t.Fatalf("enqueue run: %v", err)
	}
	if err := s.StartRun(ctx, runID); err != nil {
		t.Fatalf("start run: %v", err)
	}

	deadline := time.Now().Add(3 * time.Second)
	for {
		run, err := store.GetRun(ctx, runID)
		if err != nil {
			t.Fatalf("get run: %v", err)
		}
		if run.Status == types.RunStatusSucceeded {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("run did not finish, current status=%s", run.Status)
		}
		time.Sleep(20 * time.Millisecond)
	}

	if got := atomic.LoadInt32(&maxRunning); got != 1 {
		t.Fatalf("expected max concurrent agent executions to be 1, got %d", got)
	}
}
