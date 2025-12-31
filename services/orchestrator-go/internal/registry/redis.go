package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// Key patterns for Redis storage
	agentKeyPrefix = "agent:"
	agentIndexKey  = "agents:all"
)

// RedisRegistry implements AgentRegistry using Redis for persistence.
type RedisRegistry struct {
	client *redis.Client
}

// RedisConfig holds Redis connection configuration.
type RedisConfig struct {
	Addr     string
	Password string
	DB       int
}

// NewRedisRegistry creates a new Redis-backed agent registry.
func NewRedisRegistry(cfg *RedisConfig) (*RedisRegistry, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr,
		Password: cfg.Password,
		DB:       cfg.DB,
	})

	// Verify connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis connection failed: %w", err)
	}

	return &RedisRegistry{client: client}, nil
}

// NewRedisRegistryFromClient creates a registry from an existing Redis client.
func NewRedisRegistryFromClient(client *redis.Client) *RedisRegistry {
	return &RedisRegistry{client: client}
}

// agentKey returns the Redis key for an agent.
func agentKey(id string) string {
	return agentKeyPrefix + id
}

// Create registers a new agent.
func (r *RedisRegistry) Create(ctx context.Context, req *CreateAgentRequest) (*Agent, error) {
	if err := req.Validate(); err != nil {
		return nil, err
	}

	key := agentKey(req.ID)

	// Check if agent already exists
	exists, err := r.client.Exists(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("check exists: %w", err)
	}
	if exists > 0 {
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

	data, err := json.Marshal(agent)
	if err != nil {
		return nil, fmt.Errorf("marshal agent: %w", err)
	}

	// Use transaction to set agent and add to index atomically
	pipe := r.client.TxPipeline()
	pipe.Set(ctx, key, data, 0) // No expiration
	pipe.SAdd(ctx, agentIndexKey, req.ID)

	if _, err := pipe.Exec(ctx); err != nil {
		return nil, fmt.Errorf("create agent: %w", err)
	}

	return agent, nil
}

// Get retrieves an agent by ID.
func (r *RedisRegistry) Get(ctx context.Context, id string) (*Agent, error) {
	data, err := r.client.Get(ctx, agentKey(id)).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, ErrAgentNotFound
		}
		return nil, fmt.Errorf("get agent: %w", err)
	}

	var agent Agent
	if err := json.Unmarshal(data, &agent); err != nil {
		return nil, fmt.Errorf("unmarshal agent: %w", err)
	}

	return &agent, nil
}

// Update modifies an existing agent.
func (r *RedisRegistry) Update(ctx context.Context, id string, req *UpdateAgentRequest) (*Agent, error) {
	// Get existing agent
	agent, err := r.Get(ctx, id)
	if err != nil {
		return nil, err
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

	// Save updated agent
	data, err := json.Marshal(agent)
	if err != nil {
		return nil, fmt.Errorf("marshal agent: %w", err)
	}

	if err := r.client.Set(ctx, agentKey(id), data, 0).Err(); err != nil {
		return nil, fmt.Errorf("update agent: %w", err)
	}

	return agent, nil
}

// Delete removes an agent.
func (r *RedisRegistry) Delete(ctx context.Context, id string) error {
	key := agentKey(id)

	// Check if exists
	exists, err := r.client.Exists(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("check exists: %w", err)
	}
	if exists == 0 {
		return ErrAgentNotFound
	}

	// Delete agent and remove from index atomically
	pipe := r.client.TxPipeline()
	pipe.Del(ctx, key)
	pipe.SRem(ctx, agentIndexKey, id)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("delete agent: %w", err)
	}

	return nil
}

// List returns all agents matching the options.
func (r *RedisRegistry) List(ctx context.Context, opts *ListOptions) ([]*Agent, error) {
	if opts == nil {
		opts = &ListOptions{}
	}

	// Get all agent IDs from the index
	ids, err := r.client.SMembers(ctx, agentIndexKey).Result()
	if err != nil {
		return nil, fmt.Errorf("list agent ids: %w", err)
	}

	if len(ids) == 0 {
		return []*Agent{}, nil
	}

	// Fetch all agents
	var agents []*Agent
	for _, id := range ids {
		agent, err := r.Get(ctx, id)
		if err != nil {
			if err == ErrAgentNotFound {
				// Clean up stale index entry
				r.client.SRem(ctx, agentIndexKey, id)
				continue
			}
			return nil, err
		}

		// Filter by capabilities if specified
		if len(opts.Capabilities) > 0 {
			if !hasAllCapabilities(agent.Capabilities, opts.Capabilities) {
				continue
			}
		}

		agents = append(agents, agent)
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
func (r *RedisRegistry) Exists(ctx context.Context, id string) (bool, error) {
	exists, err := r.client.Exists(ctx, agentKey(id)).Result()
	if err != nil {
		return false, fmt.Errorf("check exists: %w", err)
	}
	return exists > 0, nil
}

// Close releases Redis connection resources.
func (r *RedisRegistry) Close() error {
	return r.client.Close()
}

// hasAllCapabilities checks if agent has all required capabilities.
func hasAllCapabilities(agentCaps, required []string) bool {
	capSet := make(map[string]bool, len(agentCaps))
	for _, cap := range agentCaps {
		capSet[cap] = true
	}
	for _, req := range required {
		if !capSet[req] {
			return false
		}
	}
	return true
}
