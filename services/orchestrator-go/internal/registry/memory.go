package registry

import (
	"context"
	"sync"
	"time"
)

// MemoryRegistry implements AgentRegistry using in-memory storage.
// Suitable for testing and local development.
type MemoryRegistry struct {
	mu     sync.RWMutex
	agents map[string]*Agent
}

// NewMemoryRegistry creates a new in-memory agent registry.
func NewMemoryRegistry() *MemoryRegistry {
	return &MemoryRegistry{
		agents: make(map[string]*Agent),
	}
}

// NewMemoryRegistryWithDefaults creates a registry pre-populated with default agents.
func NewMemoryRegistryWithDefaults() *MemoryRegistry {
	r := NewMemoryRegistry()
	now := time.Now().UTC()

	// Add default agents (the previously hardcoded ones)
	defaults := []*Agent{
		{
			ID:          "mentatlab.echo",
			Name:        "Echo Agent",
			Version:     "1.0.0",
			Description: "Simple echo agent for testing",
			Capabilities: []string{"echo", "test"},
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			ID:          "mentatlab.psyche-sim",
			Name:        "Psyche Simulation",
			Version:     "1.0.0",
			Description: "Psychological simulation agent",
			Capabilities: []string{"simulation", "psychology"},
			CreatedAt:   now,
			UpdatedAt:   now,
		},
		{
			ID:          "mentatlab.ctm-cogpack",
			Name:        "CTM CogPack",
			Version:     "1.0.0",
			Description: "Cognitive task modeling package",
			Capabilities: []string{"cognitive", "modeling"},
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	}

	for _, agent := range defaults {
		r.agents[agent.ID] = agent
	}

	return r
}

// Create registers a new agent.
func (r *MemoryRegistry) Create(ctx context.Context, req *CreateAgentRequest) (*Agent, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.agents[req.ID]; exists {
		return nil, ErrAgentExists
	}

	now := time.Now().UTC()
	agent := &Agent{
		ID:           req.ID,
		Name:         req.Name,
		Version:      req.Version,
		Image:        req.Image,
		Command:      req.Command,
		Capabilities: req.Capabilities,
		Schema:       req.Schema,
		Description:  req.Description,
		Author:       req.Author,
		Metadata:     req.Metadata,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	r.agents[req.ID] = agent
	return agent, nil
}

// Get retrieves an agent by ID.
func (r *MemoryRegistry) Get(ctx context.Context, id string) (*Agent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	agent, ok := r.agents[id]
	if !ok {
		return nil, ErrAgentNotFound
	}

	// Return a copy to prevent external mutation
	copy := *agent
	return &copy, nil
}

// Update modifies an existing agent.
func (r *MemoryRegistry) Update(ctx context.Context, id string, req *UpdateAgentRequest) (*Agent, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	agent, ok := r.agents[id]
	if !ok {
		return nil, ErrAgentNotFound
	}

	// Apply updates
	if req.Name != nil {
		agent.Name = *req.Name
	}
	if req.Version != nil {
		agent.Version = *req.Version
	}
	if req.Image != nil {
		agent.Image = *req.Image
	}
	if req.Command != nil {
		agent.Command = req.Command
	}
	if req.Capabilities != nil {
		agent.Capabilities = req.Capabilities
	}
	if req.Schema != nil {
		agent.Schema = req.Schema
	}
	if req.Description != nil {
		agent.Description = *req.Description
	}
	if req.Author != nil {
		agent.Author = *req.Author
	}
	if req.Metadata != nil {
		agent.Metadata = req.Metadata
	}
	agent.UpdatedAt = time.Now().UTC()

	// Return a copy
	copy := *agent
	return &copy, nil
}

// Delete removes an agent.
func (r *MemoryRegistry) Delete(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.agents[id]; !ok {
		return ErrAgentNotFound
	}

	delete(r.agents, id)
	return nil
}

// List returns all agents matching the options.
func (r *MemoryRegistry) List(ctx context.Context, opts *ListOptions) ([]*Agent, error) {
	if opts == nil {
		opts = &ListOptions{}
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	var agents []*Agent
	for _, agent := range r.agents {
		// Filter by capabilities if specified
		if len(opts.Capabilities) > 0 {
			if !hasAllCapabilities(agent.Capabilities, opts.Capabilities) {
				continue
			}
		}

		// Return a copy
		copy := *agent
		agents = append(agents, &copy)
	}

	// Apply offset and limit
	if opts.Offset > 0 {
		if opts.Offset >= len(agents) {
			return []*Agent{}, nil
		}
		agents = agents[opts.Offset:]
	}

	if opts.Limit > 0 && opts.Limit < len(agents) {
		agents = agents[:opts.Limit]
	}

	return agents, nil
}

// Exists checks if an agent with the given ID exists.
func (r *MemoryRegistry) Exists(ctx context.Context, id string) (bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	_, ok := r.agents[id]
	return ok, nil
}

// Close is a no-op for the memory registry.
func (r *MemoryRegistry) Close() error {
	return nil
}
