package flowstore

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

// MemoryStore implements FlowStore using in-memory storage.
// Suitable for testing and local development.
type MemoryStore struct {
	mu    sync.RWMutex
	flows map[string]*Flow
}

// NewMemoryStore creates a new in-memory flow store.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		flows: make(map[string]*Flow),
	}
}

// Create saves a new flow.
func (s *MemoryStore) Create(ctx context.Context, req *CreateFlowRequest) (*Flow, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	id := req.ID
	if id == "" {
		id = uuid.New().String()
	}

	if _, exists := s.flows[id]; exists {
		return nil, ErrFlowExists
	}

	now := time.Now().UTC()
	flow := &Flow{
		ID:          id,
		Name:        req.Name,
		Description: req.Description,
		Version:     "1",
		Graph:       req.Graph,
		Layout:      req.Layout,
		Metadata:    req.Metadata,
		CreatedAt:   now,
		UpdatedAt:   now,
		CreatedBy:   req.CreatedBy,
	}

	s.flows[id] = flow
	return flow, nil
}

// Get retrieves a flow by ID.
func (s *MemoryStore) Get(ctx context.Context, id string) (*Flow, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	flow, ok := s.flows[id]
	if !ok {
		return nil, ErrFlowNotFound
	}

	// Return a copy to prevent external mutation
	copy := *flow
	return &copy, nil
}

// Update modifies an existing flow.
func (s *MemoryStore) Update(ctx context.Context, id string, req *UpdateFlowRequest) (*Flow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	flow, ok := s.flows[id]
	if !ok {
		return nil, ErrFlowNotFound
	}

	// Apply updates
	if req.Name != nil {
		flow.Name = *req.Name
	}
	if req.Description != nil {
		flow.Description = *req.Description
	}
	if req.Version != nil {
		flow.Version = *req.Version
	}
	if req.Graph != nil {
		flow.Graph = req.Graph
	}
	if req.Layout != nil {
		flow.Layout = req.Layout
	}
	if req.Metadata != nil {
		flow.Metadata = req.Metadata
	}
	flow.UpdatedAt = time.Now().UTC()

	// Return a copy
	copy := *flow
	return &copy, nil
}

// Delete removes a flow.
func (s *MemoryStore) Delete(ctx context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.flows[id]; !ok {
		return ErrFlowNotFound
	}

	delete(s.flows, id)
	return nil
}

// List returns all flows matching the options.
func (s *MemoryStore) List(ctx context.Context, opts *ListOptions) ([]*Flow, error) {
	if opts == nil {
		opts = &ListOptions{}
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	var flows []*Flow
	for _, flow := range s.flows {
		// Filter by creator if specified
		if opts.CreatedBy != "" && flow.CreatedBy != opts.CreatedBy {
			continue
		}

		// Return a copy
		copy := *flow
		flows = append(flows, &copy)
	}

	// Apply offset and limit
	if opts.Offset > 0 {
		if opts.Offset >= len(flows) {
			return []*Flow{}, nil
		}
		flows = flows[opts.Offset:]
	}

	if opts.Limit > 0 && opts.Limit < len(flows) {
		flows = flows[:opts.Limit]
	}

	return flows, nil
}

// Close is a no-op for the memory store.
func (s *MemoryStore) Close() error {
	return nil
}
