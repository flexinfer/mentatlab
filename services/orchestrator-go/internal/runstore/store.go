// Package runstore provides run state persistence and event streaming.
package runstore

import (
	"context"
	"errors"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// Common errors returned by RunStore implementations.
var (
	ErrRunNotFound = errors.New("run not found")
	ErrCancelled   = errors.New("run cancelled")
)

// RunStore defines the interface for run state persistence and event streaming.
// Implementations must be safe for concurrent use.
type RunStore interface {
	// Run lifecycle
	CreateRun(ctx context.Context, name string, plan *types.Plan) (string, error)
	GetRunMeta(ctx context.Context, runID string) (*types.RunMeta, error)
	GetRun(ctx context.Context, runID string) (*types.Run, error)
	ListRuns(ctx context.Context) ([]string, error)
	UpdateRunStatus(ctx context.Context, runID string, status types.RunStatus, startedAt, finishedAt *string) error
	CancelRun(ctx context.Context, runID string) error

	// Node state tracking
	UpdateNodeState(ctx context.Context, runID, nodeID string, state *types.NodeState) error
	GetNodeState(ctx context.Context, runID, nodeID string) (*types.NodeState, error)

	// Node outputs for expression evaluation in control flow
	SetNodeOutputs(ctx context.Context, runID, nodeID string, outputs map[string]interface{}) error
	GetNodeOutputs(ctx context.Context, runID, nodeID string) (map[string]interface{}, error)

	// Event streaming
	// AppendEvent adds an event to the run's event stream and returns the created event.
	AppendEvent(ctx context.Context, runID string, input *types.EventInput) (*types.Event, error)

	// GetEventsSince returns events after the given event ID (exclusive).
	// If lastEventID is empty, returns all events from the beginning.
	GetEventsSince(ctx context.Context, runID string, lastEventID string) ([]*types.Event, error)

	// Subscribe returns a channel that receives new events for the run.
	// The cleanup function must be called when done to release resources.
	// The channel is closed when the run completes or is cancelled.
	Subscribe(ctx context.Context, runID string) (<-chan *types.Event, func(), error)

	// IsCancelled checks if a run has been cancelled.
	IsCancelled(ctx context.Context, runID string) (bool, error)

	// Diagnostics
	AdapterInfo(ctx context.Context) (map[string]interface{}, error)

	// Cleanup
	Close() error
}

// Config holds configuration for RunStore implementations.
type Config struct {
	// Maximum number of events to keep per run (ring buffer)
	EventMaxLen int64

	// TTL for runs in seconds (0 = no expiry)
	TTLSeconds int64
}

// DefaultConfig returns sensible defaults for RunStore configuration.
func DefaultConfig() *Config {
	return &Config{
		EventMaxLen: 5000,
		TTLSeconds:  7 * 24 * 60 * 60, // 7 days
	}
}
