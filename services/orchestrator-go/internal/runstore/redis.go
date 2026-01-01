package runstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// RedisStore implements RunStore backed by Redis.
// Uses Redis Streams for event streaming and hashes for run metadata.
type RedisStore struct {
	client *redis.Client
	prefix string
	ttl    time.Duration
	mu     sync.Mutex
	closed bool

	// Subscriber management
	subsMu sync.RWMutex
	subs   map[string]map[chan *types.Event]struct{} // runID -> set of channels
}

// RedisConfig holds Redis connection configuration.
type RedisConfig struct {
	// URL is the Redis connection URL (redis://host:port/db)
	URL string

	// Password for Redis authentication
	Password string

	// DB is the database number
	DB int

	// Prefix for all keys (default: "runs")
	Prefix string

	// TTL for run data (default: 7 days)
	TTL time.Duration

	// Connection pool settings
	PoolSize     int
	MinIdleConns int

	// Timeouts
	DialTimeout  time.Duration
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
}

// DefaultRedisConfig returns sensible defaults.
func DefaultRedisConfig() *RedisConfig {
	return &RedisConfig{
		URL:          "redis://localhost:6379/0",
		Prefix:       "runs",
		TTL:          7 * 24 * time.Hour,
		PoolSize:     10,
		MinIdleConns: 2,
		DialTimeout:  5 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	}
}

// NewRedisStore creates a new Redis-backed RunStore.
func NewRedisStore(cfg *RedisConfig) (*RedisStore, error) {
	if cfg == nil {
		cfg = DefaultRedisConfig()
	}

	// Parse URL or use direct options
	opts := &redis.Options{
		PoolSize:     cfg.PoolSize,
		MinIdleConns: cfg.MinIdleConns,
		DialTimeout:  cfg.DialTimeout,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		Password:     cfg.Password,
		DB:           cfg.DB,
	}

	// Parse URL if provided
	if cfg.URL != "" {
		parsed, err := redis.ParseURL(cfg.URL)
		if err != nil {
			return nil, fmt.Errorf("parse redis url: %w", err)
		}
		opts.Addr = parsed.Addr
		if parsed.Password != "" && cfg.Password == "" {
			opts.Password = parsed.Password
		}
		if parsed.DB != 0 && cfg.DB == 0 {
			opts.DB = parsed.DB
		}
	}

	client := redis.NewClient(opts)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}

	prefix := cfg.Prefix
	if prefix == "" {
		prefix = "runs"
	}

	return &RedisStore{
		client: client,
		prefix: prefix,
		ttl:    cfg.TTL,
		subs:   make(map[string]map[chan *types.Event]struct{}),
	}, nil
}

// Key helpers
func (s *RedisStore) keyMeta(runID string) string   { return fmt.Sprintf("%s:%s:meta", s.prefix, runID) }
func (s *RedisStore) keyNodes(runID string) string  { return fmt.Sprintf("%s:%s:nodes", s.prefix, runID) }
func (s *RedisStore) keyEvents(runID string) string { return fmt.Sprintf("%s:%s:events", s.prefix, runID) }
func (s *RedisStore) keySeq(runID string) string    { return fmt.Sprintf("%s:%s:seq", s.prefix, runID) }
func (s *RedisStore) keyPlan(runID string) string   { return fmt.Sprintf("%s:%s:plan", s.prefix, runID) }

// setTTL refreshes TTL on all keys for a run.
func (s *RedisStore) setTTL(ctx context.Context, runID string) error {
	if s.ttl <= 0 {
		return nil
	}
	pipe := s.client.Pipeline()
	pipe.Expire(ctx, s.keyMeta(runID), s.ttl)
	pipe.Expire(ctx, s.keyNodes(runID), s.ttl)
	pipe.Expire(ctx, s.keyEvents(runID), s.ttl)
	pipe.Expire(ctx, s.keySeq(runID), s.ttl)
	pipe.Expire(ctx, s.keyPlan(runID), s.ttl)
	_, err := pipe.Exec(ctx)
	return err
}

// CreateRun creates a new run record.
func (s *RedisStore) CreateRun(ctx context.Context, name string, plan *types.Plan) (string, error) {
	runID := generateRunID()
	now := time.Now().UTC()

	// Initialize nodes state from plan
	nodesState := make(map[string]*types.NodeState)
	if plan != nil {
		for _, node := range plan.Nodes {
			nodesState[node.ID] = &types.NodeState{
				NodeID:  node.ID,
				Status:  types.NodeStatusPending,
				Retries: 0,
			}
		}
	}
	nodesJSON, _ := json.Marshal(nodesState)

	// Serialize plan
	planJSON := []byte("{}")
	if plan != nil {
		planJSON, _ = json.Marshal(plan)
	}

	// Create run in pipeline
	pipe := s.client.Pipeline()

	// Meta hash
	pipe.HSet(ctx, s.keyMeta(runID), map[string]interface{}{
		"runId":      runID,
		"name":       name,
		"status":     string(types.RunStatusQueued),
		"startedAt":  "",
		"finishedAt": "",
		"createdAt":  now.Format(time.RFC3339),
		"updatedAt":  now.Format(time.RFC3339),
		"cancelled":  "false",
	})

	// Nodes state
	pipe.HSet(ctx, s.keyNodes(runID), "json", string(nodesJSON))

	// Plan
	pipe.Set(ctx, s.keyPlan(runID), string(planJSON), 0)

	// Sequence counter
	pipe.Set(ctx, s.keySeq(runID), "0", 0)

	if _, err := pipe.Exec(ctx); err != nil {
		return "", fmt.Errorf("create run: %w", err)
	}

	// Set TTL
	if err := s.setTTL(ctx, runID); err != nil {
		slog.Warn("failed to set TTL for run", slog.String("run_id", runID), slog.Any("error", err))
	}

	return runID, nil
}

// GetRunMeta returns lightweight run metadata.
func (s *RedisStore) GetRunMeta(ctx context.Context, runID string) (*types.RunMeta, error) {
	meta, err := s.client.HGetAll(ctx, s.keyMeta(runID)).Result()
	if err != nil {
		return nil, fmt.Errorf("get run meta: %w", err)
	}
	if len(meta) == 0 {
		return nil, ErrRunNotFound
	}

	result := &types.RunMeta{
		ID:     runID,
		Name:   meta["name"],
		Status: types.RunStatus(meta["status"]),
	}

	if meta["startedAt"] != "" {
		if t, err := time.Parse(time.RFC3339, meta["startedAt"]); err == nil {
			result.StartedAt = &t
		}
	}
	if meta["finishedAt"] != "" {
		if t, err := time.Parse(time.RFC3339, meta["finishedAt"]); err == nil {
			result.FinishedAt = &t
		}
	}
	if meta["createdAt"] != "" {
		if t, err := time.Parse(time.RFC3339, meta["createdAt"]); err == nil {
			result.CreatedAt = t
		}
	}
	if meta["updatedAt"] != "" {
		if t, err := time.Parse(time.RFC3339, meta["updatedAt"]); err == nil {
			result.UpdatedAt = t
		}
	}

	return result, nil
}

// GetRun returns the full run including plan.
func (s *RedisStore) GetRun(ctx context.Context, runID string) (*types.Run, error) {
	// Get meta and plan in parallel
	pipe := s.client.Pipeline()
	metaCmd := pipe.HGetAll(ctx, s.keyMeta(runID))
	planCmd := pipe.Get(ctx, s.keyPlan(runID))
	_, err := pipe.Exec(ctx)
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, fmt.Errorf("get run: %w", err)
	}

	meta, err := metaCmd.Result()
	if err != nil || len(meta) == 0 {
		return nil, ErrRunNotFound
	}

	run := &types.Run{
		ID:     runID,
		Name:   meta["name"],
		Status: types.RunStatus(meta["status"]),
		Error:  meta["error"],
	}

	if meta["startedAt"] != "" {
		if t, err := time.Parse(time.RFC3339, meta["startedAt"]); err == nil {
			run.StartedAt = &t
		}
	}
	if meta["finishedAt"] != "" {
		if t, err := time.Parse(time.RFC3339, meta["finishedAt"]); err == nil {
			run.FinishedAt = &t
		}
	}
	if meta["createdAt"] != "" {
		if t, err := time.Parse(time.RFC3339, meta["createdAt"]); err == nil {
			run.CreatedAt = t
		}
	}
	if meta["updatedAt"] != "" {
		if t, err := time.Parse(time.RFC3339, meta["updatedAt"]); err == nil {
			run.UpdatedAt = t
		}
	}

	// Parse plan
	if planJSON, err := planCmd.Result(); err == nil && planJSON != "" {
		var plan types.Plan
		if json.Unmarshal([]byte(planJSON), &plan) == nil {
			run.Plan = &plan
		}
	}

	return run, nil
}

// ListRuns returns all run IDs.
func (s *RedisStore) ListRuns(ctx context.Context) ([]string, error) {
	pattern := fmt.Sprintf("%s:*:meta", s.prefix)
	var runIDs []string
	var cursor uint64

	for {
		keys, nextCursor, err := s.client.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return nil, fmt.Errorf("scan runs: %w", err)
		}

		for _, key := range keys {
			// Extract run ID from key pattern: prefix:runID:meta
			parts := strings.Split(key, ":")
			if len(parts) >= 3 {
				runIDs = append(runIDs, parts[1])
			}
		}

		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	return runIDs, nil
}

// UpdateRunStatus updates the run's status and optional timestamps.
func (s *RedisStore) UpdateRunStatus(ctx context.Context, runID string, status types.RunStatus, startedAt, finishedAt *string) error {
	fields := map[string]interface{}{
		"status":    string(status),
		"updatedAt": time.Now().UTC().Format(time.RFC3339),
	}
	if startedAt != nil {
		fields["startedAt"] = *startedAt
	}
	if finishedAt != nil {
		fields["finishedAt"] = *finishedAt
	}

	if err := s.client.HSet(ctx, s.keyMeta(runID), fields).Err(); err != nil {
		return fmt.Errorf("update run status: %w", err)
	}

	// Refresh TTL
	s.setTTL(ctx, runID)

	return nil
}

// CancelRun marks the run as cancelled.
func (s *RedisStore) CancelRun(ctx context.Context, runID string) error {
	// Check if run exists
	exists, err := s.client.Exists(ctx, s.keyMeta(runID)).Result()
	if err != nil {
		return fmt.Errorf("check run exists: %w", err)
	}
	if exists == 0 {
		return ErrRunNotFound
	}

	fields := map[string]interface{}{
		"status":    string(types.RunStatusCancelled),
		"cancelled": "true",
		"updatedAt": time.Now().UTC().Format(time.RFC3339),
	}

	if err := s.client.HSet(ctx, s.keyMeta(runID), fields).Err(); err != nil {
		return fmt.Errorf("cancel run: %w", err)
	}

	return nil
}

// UpdateNodeState updates a node's state.
func (s *RedisStore) UpdateNodeState(ctx context.Context, runID, nodeID string, state *types.NodeState) error {
	// Get current nodes state
	nodesJSON, err := s.client.HGet(ctx, s.keyNodes(runID), "json").Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("get nodes: %w", err)
	}

	nodes := make(map[string]*types.NodeState)
	if nodesJSON != "" {
		json.Unmarshal([]byte(nodesJSON), &nodes)
	}

	nodes[nodeID] = state

	updatedJSON, _ := json.Marshal(nodes)
	if err := s.client.HSet(ctx, s.keyNodes(runID), "json", string(updatedJSON)).Err(); err != nil {
		return fmt.Errorf("update node state: %w", err)
	}

	// Refresh TTL
	s.setTTL(ctx, runID)

	return nil
}

// GetNodeState retrieves a node's state.
func (s *RedisStore) GetNodeState(ctx context.Context, runID, nodeID string) (*types.NodeState, error) {
	nodesJSON, err := s.client.HGet(ctx, s.keyNodes(runID), "json").Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, ErrRunNotFound
		}
		return nil, fmt.Errorf("get nodes: %w", err)
	}

	nodes := make(map[string]*types.NodeState)
	if err := json.Unmarshal([]byte(nodesJSON), &nodes); err != nil {
		return nil, fmt.Errorf("unmarshal nodes: %w", err)
	}

	state, ok := nodes[nodeID]
	if !ok {
		return nil, fmt.Errorf("node %s not found", nodeID)
	}

	return state, nil
}

// AppendEvent adds an event to the run's stream.
func (s *RedisStore) AppendEvent(ctx context.Context, runID string, input *types.EventInput) (*types.Event, error) {
	// Increment sequence atomically
	seq, err := s.client.Incr(ctx, s.keySeq(runID)).Result()
	if err != nil {
		return nil, fmt.Errorf("incr seq: %w", err)
	}

	now := time.Now().UTC()
	eventID := strconv.FormatInt(seq, 10)

	// Serialize data
	dataBytes, _ := json.Marshal(input.Data)

	event := &types.Event{
		ID:        eventID,
		RunID:     runID,
		Type:      input.Type,
		NodeID:    input.NodeID,
		Timestamp: now,
		Data:      dataBytes,
	}

	// Add to Redis Stream with MAXLEN
	streamFields := map[string]interface{}{
		"seq":    eventID,
		"ts":     now.Format(time.RFC3339),
		"type":   string(input.Type),
		"data":   string(dataBytes),
		"nodeId": input.NodeID,
	}

	if err := s.client.XAdd(ctx, &redis.XAddArgs{
		Stream: s.keyEvents(runID),
		MaxLen: 5000,
		Approx: true,
		Values: streamFields,
	}).Err(); err != nil {
		return nil, fmt.Errorf("xadd: %w", err)
	}

	// Refresh TTL
	s.setTTL(ctx, runID)

	// Notify subscribers
	s.notifySubscribers(runID, event)

	return event, nil
}

// GetEventsSince returns events after the given event ID.
func (s *RedisStore) GetEventsSince(ctx context.Context, runID string, lastEventID string) ([]*types.Event, error) {
	// Use XRANGE to get all events
	entries, err := s.client.XRange(ctx, s.keyEvents(runID), "-", "+").Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return []*types.Event{}, nil
		}
		return nil, fmt.Errorf("xrange: %w", err)
	}

	var lastSeq int64
	if lastEventID != "" {
		lastSeq, _ = strconv.ParseInt(lastEventID, 10, 64)
	}

	var events []*types.Event
	for _, entry := range entries {
		seqStr, _ := entry.Values["seq"].(string)
		seq, _ := strconv.ParseInt(seqStr, 10, 64)

		if lastSeq > 0 && seq <= lastSeq {
			continue
		}

		ts, _ := entry.Values["ts"].(string)
		timestamp, _ := time.Parse(time.RFC3339, ts)

		eventType, _ := entry.Values["type"].(string)
		data, _ := entry.Values["data"].(string)
		nodeID, _ := entry.Values["nodeId"].(string)

		events = append(events, &types.Event{
			ID:        seqStr,
			RunID:     runID,
			Type:      types.EventType(eventType),
			NodeID:    nodeID,
			Timestamp: timestamp,
			Data:      json.RawMessage(data),
		})
	}

	return events, nil
}

// Subscribe returns a channel that receives new events.
func (s *RedisStore) Subscribe(ctx context.Context, runID string) (<-chan *types.Event, func(), error) {
	// Check if run exists
	exists, err := s.client.Exists(ctx, s.keyMeta(runID)).Result()
	if err != nil {
		return nil, nil, fmt.Errorf("check run exists: %w", err)
	}
	if exists == 0 {
		return nil, nil, ErrRunNotFound
	}

	ch := make(chan *types.Event, 100)

	// Register subscriber
	s.subsMu.Lock()
	if s.subs[runID] == nil {
		s.subs[runID] = make(map[chan *types.Event]struct{})
	}
	s.subs[runID][ch] = struct{}{}
	s.subsMu.Unlock()

	// Start background reader from Redis Stream
	go s.streamReader(ctx, runID, ch)

	cleanup := func() {
		s.subsMu.Lock()
		delete(s.subs[runID], ch)
		if len(s.subs[runID]) == 0 {
			delete(s.subs, runID)
		}
		s.subsMu.Unlock()
		close(ch)
	}

	return ch, cleanup, nil
}

// streamReader reads from Redis Stream and pushes to channel.
func (s *RedisStore) streamReader(ctx context.Context, runID string, ch chan *types.Event) {
	lastID := "$" // Start from latest

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		// XREAD with block timeout
		streams, err := s.client.XRead(ctx, &redis.XReadArgs{
			Streams: []string{s.keyEvents(runID), lastID},
			Count:   10,
			Block:   time.Second,
		}).Result()

		if err != nil {
			if errors.Is(err, redis.Nil) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				continue
			}
			// On error, wait briefly then retry
			time.Sleep(100 * time.Millisecond)
			continue
		}

		for _, stream := range streams {
			for _, entry := range stream.Messages {
				lastID = entry.ID

				seqStr, _ := entry.Values["seq"].(string)
				ts, _ := entry.Values["ts"].(string)
				timestamp, _ := time.Parse(time.RFC3339, ts)
				eventType, _ := entry.Values["type"].(string)
				data, _ := entry.Values["data"].(string)
				nodeID, _ := entry.Values["nodeId"].(string)

				event := &types.Event{
					ID:        seqStr,
					RunID:     runID,
					Type:      types.EventType(eventType),
					NodeID:    nodeID,
					Timestamp: timestamp,
					Data:      json.RawMessage(data),
				}

				select {
				case ch <- event:
				case <-ctx.Done():
					return
				default:
					// Channel full, skip event
				}
			}
		}
	}
}

// notifySubscribers sends an event to all subscribers for a run.
func (s *RedisStore) notifySubscribers(runID string, event *types.Event) {
	s.subsMu.RLock()
	defer s.subsMu.RUnlock()

	for ch := range s.subs[runID] {
		select {
		case ch <- event:
		default:
			// Channel full, skip
		}
	}
}

// IsCancelled checks if the run has been cancelled.
func (s *RedisStore) IsCancelled(ctx context.Context, runID string) (bool, error) {
	val, err := s.client.HGet(ctx, s.keyMeta(runID), "cancelled").Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return false, nil
		}
		return false, fmt.Errorf("get cancelled: %w", err)
	}
	return val == "true", nil
}

// AdapterInfo returns diagnostic information.
func (s *RedisStore) AdapterInfo(ctx context.Context) (map[string]interface{}, error) {
	// Ping test
	pingStart := time.Now()
	if err := s.client.Ping(ctx).Err(); err != nil {
		return map[string]interface{}{
			"adapter": "redis",
			"healthy": false,
			"error":   err.Error(),
		}, nil
	}
	pingLatency := time.Since(pingStart)

	// Get pool stats
	poolStats := s.client.PoolStats()

	return map[string]interface{}{
		"adapter": "redis",
		"healthy": true,
		"details": map[string]interface{}{
			"prefix":       s.prefix,
			"ttl_hours":    s.ttl.Hours(),
			"ping_latency": pingLatency.String(),
			"pool": map[string]interface{}{
				"hits":       poolStats.Hits,
				"misses":     poolStats.Misses,
				"timeouts":   poolStats.Timeouts,
				"total_conn": poolStats.TotalConns,
				"idle_conn":  poolStats.IdleConns,
				"stale_conn": poolStats.StaleConns,
			},
		},
	}, nil
}

// Close closes the Redis connection.
func (s *RedisStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return nil
	}
	s.closed = true

	return s.client.Close()
}

// Ensure RedisStore implements RunStore
var _ RunStore = (*RedisStore)(nil)
