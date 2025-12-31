// Package flowstore provides flow definition persistence.
package flowstore

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// Common errors returned by FlowStore implementations.
var (
	ErrFlowNotFound = errors.New("flow not found")
	ErrFlowExists   = errors.New("flow already exists")
)

// Flow represents a saved workflow definition.
type Flow struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Version     string          `json:"version,omitempty"`
	Graph       json.RawMessage `json:"graph"` // nodes + edges
	Layout      json.RawMessage `json:"layout,omitempty"`
	Metadata    map[string]any  `json:"metadata,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
	CreatedBy   string          `json:"created_by,omitempty"`
}

// CreateFlowRequest is the input for creating a new flow.
type CreateFlowRequest struct {
	ID          string          `json:"id,omitempty"` // Optional, auto-generated if empty
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Graph       json.RawMessage `json:"graph"`
	Layout      json.RawMessage `json:"layout,omitempty"`
	Metadata    map[string]any  `json:"metadata,omitempty"`
	CreatedBy   string          `json:"created_by,omitempty"`
}

// UpdateFlowRequest is the input for updating an existing flow.
type UpdateFlowRequest struct {
	Name        *string         `json:"name,omitempty"`
	Description *string         `json:"description,omitempty"`
	Version     *string         `json:"version,omitempty"`
	Graph       json.RawMessage `json:"graph,omitempty"`
	Layout      json.RawMessage `json:"layout,omitempty"`
	Metadata    map[string]any  `json:"metadata,omitempty"`
}

// ListOptions configures list queries.
type ListOptions struct {
	Limit     int
	Offset    int
	CreatedBy string // Filter by creator
}

// FlowStore defines the interface for flow persistence.
// Implementations must be safe for concurrent use.
type FlowStore interface {
	// Create saves a new flow. Returns ErrFlowExists if ID is taken.
	Create(ctx context.Context, req *CreateFlowRequest) (*Flow, error)

	// Get retrieves a flow by ID. Returns ErrFlowNotFound if not found.
	Get(ctx context.Context, id string) (*Flow, error)

	// Update modifies an existing flow. Returns ErrFlowNotFound if not found.
	Update(ctx context.Context, id string, req *UpdateFlowRequest) (*Flow, error)

	// Delete removes a flow. Returns ErrFlowNotFound if not found.
	Delete(ctx context.Context, id string) error

	// List returns all flows matching the options.
	List(ctx context.Context, opts *ListOptions) ([]*Flow, error)

	// Close releases any resources.
	Close() error
}

// Validate checks if a CreateFlowRequest is valid.
func (r *CreateFlowRequest) Validate() error {
	if r.Name == "" {
		return errors.New("flow name is required")
	}
	if len(r.Graph) == 0 {
		return errors.New("flow graph is required")
	}
	return nil
}
