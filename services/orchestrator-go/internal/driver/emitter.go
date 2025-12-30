package driver

import (
	"context"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// RunStoreEmitter adapts a RunStore to the EventEmitter interface.
type RunStoreEmitter struct {
	store runstore.RunStore
}

// NewRunStoreEmitter creates a new emitter backed by a RunStore.
func NewRunStoreEmitter(store runstore.RunStore) *RunStoreEmitter {
	return &RunStoreEmitter{store: store}
}

// EmitEvent sends an event to the RunStore.
func (e *RunStoreEmitter) EmitEvent(ctx context.Context, runID, eventType string, data map[string]interface{}, nodeID, level string) error {
	// Include level in data if provided
	if level != "" {
		data["level"] = level
	}

	input := &types.EventInput{
		Type:   types.EventType(eventType),
		NodeID: nodeID,
		Data:   data,
	}

	_, err := e.store.AppendEvent(ctx, runID, input)
	return err
}

// Ensure RunStoreEmitter implements EventEmitter
var _ EventEmitter = (*RunStoreEmitter)(nil)
