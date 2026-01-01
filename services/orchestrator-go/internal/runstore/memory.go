package runstore

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// memoryRun holds all state for a single run in memory.
type memoryRun struct {
	mu          sync.RWMutex
	id          string
	name        string
	plan        *types.Plan
	status      types.RunStatus
	startedAt   *time.Time
	finishedAt  *time.Time
	error       string
	nodes       map[string]*types.NodeState
	outputs     map[string]map[string]interface{} // nodeID -> outputs
	events      []*types.Event
	nextSeq     int64
	maxEvents   int64
	cancelled   bool
	subscribers map[chan *types.Event]struct{}
	createdAt   time.Time
	updatedAt   time.Time
}

// MemoryStore is an in-memory implementation of RunStore.
// Suitable for development and testing. Data is lost on restart.
type MemoryStore struct {
	mu     sync.RWMutex
	runs   map[string]*memoryRun
	config *Config
}

// NewMemoryStore creates a new in-memory RunStore.
func NewMemoryStore(cfg *Config) *MemoryStore {
	if cfg == nil {
		cfg = DefaultConfig()
	}
	return &MemoryStore{
		runs:   make(map[string]*memoryRun),
		config: cfg,
	}
}

func generateRunID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *MemoryStore) CreateRun(ctx context.Context, name string, plan *types.Plan) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	runID := generateRunID()
	now := time.Now().UTC()

	// Initialize node states from plan
	nodes := make(map[string]*types.NodeState)
	if plan != nil {
		for _, node := range plan.Nodes {
			nodes[node.ID] = &types.NodeState{
				NodeID: node.ID,
				Status: types.NodeStatusPending,
			}
		}
	}

	s.runs[runID] = &memoryRun{
		id:          runID,
		name:        name,
		plan:        plan,
		status:      types.RunStatusQueued,
		nodes:       nodes,
		outputs:     make(map[string]map[string]interface{}),
		events:      make([]*types.Event, 0),
		nextSeq:     1,
		maxEvents:   s.config.EventMaxLen,
		subscribers: make(map[chan *types.Event]struct{}),
		createdAt:   now,
		updatedAt:   now,
	}

	return runID, nil
}

func (s *MemoryStore) GetRunMeta(ctx context.Context, runID string) (*types.RunMeta, error) {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return nil, ErrRunNotFound
	}

	run.mu.RLock()
	defer run.mu.RUnlock()

	return &types.RunMeta{
		ID:         run.id,
		Name:       run.name,
		Status:     run.status,
		StartedAt:  run.startedAt,
		FinishedAt: run.finishedAt,
		Error:      run.error,
		CreatedAt:  run.createdAt,
		UpdatedAt:  run.updatedAt,
	}, nil
}

func (s *MemoryStore) GetRun(ctx context.Context, runID string) (*types.Run, error) {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return nil, ErrRunNotFound
	}

	run.mu.RLock()
	defer run.mu.RUnlock()

	return &types.Run{
		ID:         run.id,
		Name:       run.name,
		Status:     run.status,
		Plan:       run.plan,
		StartedAt:  run.startedAt,
		FinishedAt: run.finishedAt,
		Error:      run.error,
		CreatedAt:  run.createdAt,
		UpdatedAt:  run.updatedAt,
	}, nil
}

func (s *MemoryStore) ListRuns(ctx context.Context) ([]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ids := make([]string, 0, len(s.runs))
	for id := range s.runs {
		ids = append(ids, id)
	}
	return ids, nil
}

func (s *MemoryStore) UpdateRunStatus(ctx context.Context, runID string, status types.RunStatus, startedAt, finishedAt *string) error {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return ErrRunNotFound
	}

	run.mu.Lock()
	defer run.mu.Unlock()

	run.status = status
	run.updatedAt = time.Now().UTC()

	if startedAt != nil {
		t, err := time.Parse(time.RFC3339, *startedAt)
		if err == nil {
			run.startedAt = &t
		}
	}
	if finishedAt != nil {
		t, err := time.Parse(time.RFC3339, *finishedAt)
		if err == nil {
			run.finishedAt = &t
		}
	}

	return nil
}

func (s *MemoryStore) CancelRun(ctx context.Context, runID string) error {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return ErrRunNotFound
	}

	run.mu.Lock()
	run.cancelled = true
	run.status = types.RunStatusCancelled
	run.updatedAt = time.Now().UTC()
	now := time.Now().UTC()
	run.finishedAt = &now
	run.mu.Unlock()

	// Close all subscriber channels
	run.mu.RLock()
	for ch := range run.subscribers {
		close(ch)
	}
	run.subscribers = make(map[chan *types.Event]struct{})
	run.mu.RUnlock()

	return nil
}

func (s *MemoryStore) UpdateNodeState(ctx context.Context, runID, nodeID string, state *types.NodeState) error {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return ErrRunNotFound
	}

	run.mu.Lock()
	defer run.mu.Unlock()

	run.nodes[nodeID] = state
	run.updatedAt = time.Now().UTC()

	return nil
}

func (s *MemoryStore) GetNodeState(ctx context.Context, runID, nodeID string) (*types.NodeState, error) {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return nil, ErrRunNotFound
	}

	run.mu.RLock()
	defer run.mu.RUnlock()

	state, ok := run.nodes[nodeID]
	if !ok {
		return nil, fmt.Errorf("node %s not found in run %s", nodeID, runID)
	}

	return state, nil
}

func (s *MemoryStore) SetNodeOutputs(ctx context.Context, runID, nodeID string, outputs map[string]interface{}) error {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return ErrRunNotFound
	}

	run.mu.Lock()
	defer run.mu.Unlock()

	run.outputs[nodeID] = outputs
	run.updatedAt = time.Now().UTC()

	return nil
}

func (s *MemoryStore) GetNodeOutputs(ctx context.Context, runID, nodeID string) (map[string]interface{}, error) {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return nil, ErrRunNotFound
	}

	run.mu.RLock()
	defer run.mu.RUnlock()

	outputs, ok := run.outputs[nodeID]
	if !ok {
		return nil, nil // No outputs yet, not an error
	}

	return outputs, nil
}

func (s *MemoryStore) AppendEvent(ctx context.Context, runID string, input *types.EventInput) (*types.Event, error) {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return nil, ErrRunNotFound
	}

	run.mu.Lock()

	// Create the event
	eventID := fmt.Sprintf("%d", run.nextSeq)
	run.nextSeq++

	dataJSON, err := json.Marshal(input.Data)
	if err != nil {
		run.mu.Unlock()
		return nil, fmt.Errorf("failed to marshal event data: %w", err)
	}

	event := &types.Event{
		ID:        eventID,
		RunID:     runID,
		Type:      input.Type,
		NodeID:    input.NodeID,
		Timestamp: time.Now().UTC(),
		Data:      dataJSON,
	}

	// Append to ring buffer
	if int64(len(run.events)) >= run.maxEvents {
		// Remove oldest event
		run.events = run.events[1:]
	}
	run.events = append(run.events, event)
	run.updatedAt = time.Now().UTC()

	// Copy subscribers to notify outside lock
	subs := make([]chan *types.Event, 0, len(run.subscribers))
	for ch := range run.subscribers {
		subs = append(subs, ch)
	}
	run.mu.Unlock()

	// Notify subscribers (non-blocking)
	for _, ch := range subs {
		select {
		case ch <- event:
		default:
			// Subscriber too slow, skip
		}
	}

	return event, nil
}

func (s *MemoryStore) GetEventsSince(ctx context.Context, runID string, lastEventID string) ([]*types.Event, error) {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return nil, ErrRunNotFound
	}

	run.mu.RLock()
	defer run.mu.RUnlock()

	if lastEventID == "" {
		// Return all events
		result := make([]*types.Event, len(run.events))
		copy(result, run.events)
		return result, nil
	}

	// Find events after lastEventID
	var result []*types.Event
	found := false
	for _, evt := range run.events {
		if found {
			result = append(result, evt)
		}
		if evt.ID == lastEventID {
			found = true
		}
	}

	return result, nil
}

func (s *MemoryStore) Subscribe(ctx context.Context, runID string) (<-chan *types.Event, func(), error) {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return nil, nil, ErrRunNotFound
	}

	// Create buffered channel for subscriber
	ch := make(chan *types.Event, 100)

	run.mu.Lock()
	run.subscribers[ch] = struct{}{}
	run.mu.Unlock()

	// Cleanup function
	cleanup := func() {
		run.mu.Lock()
		delete(run.subscribers, ch)
		run.mu.Unlock()
		// Don't close the channel here - let the sender handle that
	}

	return ch, cleanup, nil
}

func (s *MemoryStore) IsCancelled(ctx context.Context, runID string) (bool, error) {
	s.mu.RLock()
	run, ok := s.runs[runID]
	s.mu.RUnlock()

	if !ok {
		return false, ErrRunNotFound
	}

	run.mu.RLock()
	defer run.mu.RUnlock()

	return run.cancelled, nil
}

func (s *MemoryStore) AdapterInfo(ctx context.Context) (map[string]interface{}, error) {
	s.mu.RLock()
	runCount := len(s.runs)
	s.mu.RUnlock()

	return map[string]interface{}{
		"adapter":    "memory",
		"run_count":  runCount,
		"max_events": s.config.EventMaxLen,
	}, nil
}

func (s *MemoryStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Close all subscriber channels
	for _, run := range s.runs {
		run.mu.Lock()
		for ch := range run.subscribers {
			close(ch)
		}
		run.subscribers = nil
		run.mu.Unlock()
	}

	return nil
}

// Verify interface compliance
var _ RunStore = (*MemoryStore)(nil)
