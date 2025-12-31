// Package registry provides agent registration and discovery.
package registry

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// Common errors returned by AgentRegistry implementations.
var (
	ErrAgentNotFound = errors.New("agent not found")
	ErrAgentExists   = errors.New("agent already exists")
)

// Agent represents a registered agent in the system.
type Agent struct {
	// ID is the unique identifier (e.g., "mentatlab.echo")
	ID string `json:"id"`

	// Name is the human-readable name
	Name string `json:"name"`

	// Version is the agent version (semver recommended)
	Version string `json:"version"`

	// Image is the container image for K8s execution
	Image string `json:"image,omitempty"`

	// Command is the default command to run
	Command []string `json:"command,omitempty"`

	// Capabilities are tags describing what the agent can do
	Capabilities []string `json:"capabilities,omitempty"`

	// Schema is the JSON Schema for input/output validation
	Schema json.RawMessage `json:"schema,omitempty"`

	// Description provides details about the agent
	Description string `json:"description,omitempty"`

	// Author is the agent creator
	Author string `json:"author,omitempty"`

	// Metadata holds additional key-value pairs
	Metadata map[string]string `json:"metadata,omitempty"`

	// CreatedAt is when the agent was first registered
	CreatedAt time.Time `json:"created_at"`

	// UpdatedAt is when the agent was last modified
	UpdatedAt time.Time `json:"updated_at"`
}

// CreateAgentRequest is the input for registering a new agent.
type CreateAgentRequest struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Version      string            `json:"version"`
	Image        string            `json:"image,omitempty"`
	Command      []string          `json:"command,omitempty"`
	Capabilities []string          `json:"capabilities,omitempty"`
	Schema       json.RawMessage   `json:"schema,omitempty"`
	Description  string            `json:"description,omitempty"`
	Author       string            `json:"author,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// UpdateAgentRequest is the input for updating an existing agent.
type UpdateAgentRequest struct {
	Name         *string           `json:"name,omitempty"`
	Version      *string           `json:"version,omitempty"`
	Image        *string           `json:"image,omitempty"`
	Command      []string          `json:"command,omitempty"`
	Capabilities []string          `json:"capabilities,omitempty"`
	Schema       json.RawMessage   `json:"schema,omitempty"`
	Description  *string           `json:"description,omitempty"`
	Author       *string           `json:"author,omitempty"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// ListOptions configures list queries.
type ListOptions struct {
	// Capabilities filters agents that have ALL specified capabilities
	Capabilities []string

	// Limit is the maximum number of agents to return (0 = no limit)
	Limit int

	// Offset is the number of agents to skip (for pagination)
	Offset int
}

// AgentRegistry defines the interface for agent registration and discovery.
// Implementations must be safe for concurrent use.
type AgentRegistry interface {
	// Create registers a new agent. Returns ErrAgentExists if ID is taken.
	Create(ctx context.Context, req *CreateAgentRequest) (*Agent, error)

	// Get retrieves an agent by ID. Returns ErrAgentNotFound if not found.
	Get(ctx context.Context, id string) (*Agent, error)

	// Update modifies an existing agent. Returns ErrAgentNotFound if not found.
	Update(ctx context.Context, id string, req *UpdateAgentRequest) (*Agent, error)

	// Delete removes an agent. Returns ErrAgentNotFound if not found.
	Delete(ctx context.Context, id string) error

	// List returns all agents matching the options.
	List(ctx context.Context, opts *ListOptions) ([]*Agent, error)

	// Exists checks if an agent with the given ID exists.
	Exists(ctx context.Context, id string) (bool, error)

	// Close releases any resources.
	Close() error
}

// Validate checks if a CreateAgentRequest is valid.
func (r *CreateAgentRequest) Validate() error {
	if r.ID == "" {
		return errors.New("agent ID is required")
	}
	if r.Name == "" {
		return errors.New("agent name is required")
	}
	if r.Version == "" {
		return errors.New("agent version is required")
	}
	return nil
}
