package runstore

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func TestMemoryStorePersistsLatestCheckpointState(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore(nil)
	runID, err := store.CreateRun(ctx, "checkpoint-test", &types.Plan{
		Nodes: []types.NodeSpec{{ID: "node-1"}},
	}, "")
	if err != nil {
		t.Fatalf("CreateRun failed: %v", err)
	}

	if _, err := store.AppendEvent(ctx, runID, &types.EventInput{
		Type:   types.EventTypeCheckpoint,
		NodeID: "node-1",
		Data: map[string]interface{}{
			"type": "checkpoint",
			"data": map[string]interface{}{
				"stage": "batch",
				"state": map[string]interface{}{"offset": float64(42)},
			},
		},
	}); err != nil {
		t.Fatalf("AppendEvent failed: %v", err)
	}

	checkpoint, err := store.GetLatestNodeCheckpointState(ctx, runID, "node-1")
	if err != nil {
		t.Fatalf("GetLatestNodeCheckpointState failed: %v", err)
	}
	if checkpoint == nil {
		t.Fatal("expected checkpoint state")
	}
	if got, want := string(checkpoint.State), `{"offset":42}`; got != want {
		t.Fatalf("checkpoint state = %s, want %s", got, want)
	}
}

func TestMemoryStoreRejectsOversizedCheckpointState(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore(nil)
	runID, err := store.CreateRun(ctx, "checkpoint-test", &types.Plan{
		Nodes: []types.NodeSpec{{ID: "node-1"}},
	}, "")
	if err != nil {
		t.Fatalf("CreateRun failed: %v", err)
	}

	_, err = store.AppendEvent(ctx, runID, &types.EventInput{
		Type:   types.EventTypeCheckpoint,
		NodeID: "node-1",
		Data: map[string]interface{}{
			"type": "checkpoint",
			"data": map[string]interface{}{
				"state": strings.Repeat("x", MaxCheckpointStateBytes+1),
			},
		},
	})
	if !errors.Is(err, ErrCheckpointStateTooLarge) {
		t.Fatalf("AppendEvent error = %v, want ErrCheckpointStateTooLarge", err)
	}
}
