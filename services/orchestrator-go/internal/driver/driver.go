// Package driver provides abstractions for executing agent nodes.
package driver

import (
	"context"
)

// Driver defines the interface for executing agent nodes.
// Implementations may use subprocesses, Kubernetes Jobs, or other executors.
type Driver interface {
	// RunNode executes a node and returns the exit code.
	// The driver is responsible for:
	// - Spawning the execution context (subprocess, container, etc.)
	// - Streaming stdout/stderr to the RunStore as events
	// - Parsing NDJSON from stdout for structured events
	// - Handling timeout and cancellation
	//
	// Parameters:
	// - ctx: Context for cancellation
	// - runID: The run this node belongs to
	// - nodeID: The node identifier
	// - cmd: Command and arguments to execute
	// - env: Additional environment variables
	// - timeout: Optional timeout in seconds (0 = no timeout)
	//
	// Returns the exit code (0 = success, non-zero = failure)
	RunNode(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error)
}

// EventEmitter is called by drivers to emit events to the RunStore.
// This is passed to drivers at construction time.
type EventEmitter interface {
	// EmitEvent sends an event for a run.
	EmitEvent(ctx context.Context, runID, eventType string, data map[string]interface{}, nodeID, level string) error
}
