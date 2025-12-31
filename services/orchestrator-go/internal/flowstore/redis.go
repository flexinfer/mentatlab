package flowstore

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const (
	flowKeyPrefix = "flow:"
	flowListKey   = "flows"
)

// RedisStore implements FlowStore using Redis.
type RedisStore struct {
	client *redis.Client
}

// NewRedisStore creates a new Redis-backed flow store.
func NewRedisStore(addr string) (*RedisStore, error) {
	client := redis.NewClient(&redis.Options{
		Addr: addr,
	})

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis connection failed: %w", err)
	}

	return &RedisStore{client: client}, nil
}

// NewRedisStoreWithClient creates a store using an existing Redis client.
func NewRedisStoreWithClient(client *redis.Client) *RedisStore {
	return &RedisStore{client: client}
}

func (s *RedisStore) flowKey(id string) string {
	return flowKeyPrefix + id
}

// Create saves a new flow.
func (s *RedisStore) Create(ctx context.Context, req *CreateFlowRequest) (*Flow, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}

	id := req.ID
	if id == "" {
		id = uuid.New().String()
	}

	// Check if exists
	exists, err := s.client.Exists(ctx, s.flowKey(id)).Result()
	if err != nil {
		return nil, fmt.Errorf("check exists: %w", err)
	}
	if exists > 0 {
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

	data, err := json.Marshal(flow)
	if err != nil {
		return nil, fmt.Errorf("marshal flow: %w", err)
	}

	// Use transaction to set flow and add to list
	pipe := s.client.TxPipeline()
	pipe.Set(ctx, s.flowKey(id), data, 0)
	pipe.SAdd(ctx, flowListKey, id)
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, fmt.Errorf("save flow: %w", err)
	}

	return flow, nil
}

// Get retrieves a flow by ID.
func (s *RedisStore) Get(ctx context.Context, id string) (*Flow, error) {
	data, err := s.client.Get(ctx, s.flowKey(id)).Bytes()
	if err == redis.Nil {
		return nil, ErrFlowNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get flow: %w", err)
	}

	var flow Flow
	if err := json.Unmarshal(data, &flow); err != nil {
		return nil, fmt.Errorf("unmarshal flow: %w", err)
	}

	return &flow, nil
}

// Update modifies an existing flow.
func (s *RedisStore) Update(ctx context.Context, id string, req *UpdateFlowRequest) (*Flow, error) {
	flow, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
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

	data, err := json.Marshal(flow)
	if err != nil {
		return nil, fmt.Errorf("marshal flow: %w", err)
	}

	if err := s.client.Set(ctx, s.flowKey(id), data, 0).Err(); err != nil {
		return nil, fmt.Errorf("save flow: %w", err)
	}

	return flow, nil
}

// Delete removes a flow.
func (s *RedisStore) Delete(ctx context.Context, id string) error {
	// Check if exists
	exists, err := s.client.Exists(ctx, s.flowKey(id)).Result()
	if err != nil {
		return fmt.Errorf("check exists: %w", err)
	}
	if exists == 0 {
		return ErrFlowNotFound
	}

	// Use transaction to delete flow and remove from list
	pipe := s.client.TxPipeline()
	pipe.Del(ctx, s.flowKey(id))
	pipe.SRem(ctx, flowListKey, id)
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("delete flow: %w", err)
	}

	return nil
}

// List returns all flows matching the options.
func (s *RedisStore) List(ctx context.Context, opts *ListOptions) ([]*Flow, error) {
	if opts == nil {
		opts = &ListOptions{}
	}

	// Get all flow IDs
	ids, err := s.client.SMembers(ctx, flowListKey).Result()
	if err != nil {
		return nil, fmt.Errorf("list flow ids: %w", err)
	}

	var flows []*Flow
	for _, id := range ids {
		flow, err := s.Get(ctx, id)
		if err == ErrFlowNotFound {
			// Stale reference, clean up
			s.client.SRem(ctx, flowListKey, id)
			continue
		}
		if err != nil {
			continue // Skip on error
		}

		// Filter by creator if specified
		if opts.CreatedBy != "" && flow.CreatedBy != opts.CreatedBy {
			continue
		}

		flows = append(flows, flow)
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

// Close releases the Redis connection.
func (s *RedisStore) Close() error {
	return s.client.Close()
}
