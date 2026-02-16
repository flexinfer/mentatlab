// Package runstore provides run state persistence and event streaming.
package runstore

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// Common errors returned by RunStore implementations.
var (
	ErrRunNotFound = errors.New("run not found")
	ErrCancelled   = errors.New("run cancelled")
)

// ListRunsOptions configures filtering for ListRuns.
type ListRunsOptions struct {
	Owner string // Filter by owner email (empty = no filter)
}

// PagedResult holds a page of run metadata with a cursor for the next page.
type PagedResult struct {
	Runs       []*types.RunMeta `json:"runs"`
	NextCursor string           `json:"next_cursor,omitempty"` // Empty = no more pages
	Total      int              `json:"total"`
}

// PageOptions configures cursor-based pagination.
type PageOptions struct {
	Cursor string // Opaque cursor from previous response (empty = first page)
	Limit  int    // Max items per page (default 50, max 500)
	Owner  string // Filter by owner (empty = no filter)
}

// RunStore defines the interface for run state persistence and event streaming.
// Implementations must be safe for concurrent use.
type RunStore interface {
	// Run lifecycle
	CreateRun(ctx context.Context, name string, plan *types.Plan, owner string) (string, error)
	GetRunMeta(ctx context.Context, runID string) (*types.RunMeta, error)
	GetRun(ctx context.Context, runID string) (*types.Run, error)
	ListRuns(ctx context.Context) ([]string, error)
	ListRunsWithOptions(ctx context.Context, opts *ListRunsOptions) ([]string, error)
	ListRunsPaged(ctx context.Context, opts *PageOptions) (*PagedResult, error)
	SetRunWebhook(ctx context.Context, runID, webhookURL, webhookSecret string) error
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

// encodeCursor encodes a timestamp and ID into a base64 cursor string.
func encodeCursor(t time.Time, id string) string {
	raw := fmt.Sprintf("%d:%s", t.UnixNano(), id)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// decodeCursor decodes a cursor string into a timestamp and ID.
func decodeCursor(cursor string) (time.Time, string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", fmt.Errorf("invalid cursor: %w", err)
	}
	parts := strings.SplitN(string(raw), ":", 2)
	if len(parts) != 2 {
		return time.Time{}, "", fmt.Errorf("invalid cursor format")
	}
	var nanos int64
	if _, err := fmt.Sscanf(parts[0], "%d", &nanos); err != nil {
		return time.Time{}, "", fmt.Errorf("invalid cursor timestamp: %w", err)
	}
	return time.Unix(0, nanos), parts[1], nil
}

// DefaultConfig returns sensible defaults for RunStore configuration.
func DefaultConfig() *Config {
	return &Config{
		EventMaxLen: 5000,
		TTLSeconds:  7 * 24 * 60 * 60, // 7 days
	}
}
