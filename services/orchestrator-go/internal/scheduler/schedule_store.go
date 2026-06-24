package scheduler

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// ScheduleStore persists cron schedules so they survive an orchestrator
// restart. A nil store means schedules are kept in memory only (legacy
// behavior) and are lost on restart.
type ScheduleStore interface {
	Save(ctx context.Context, sched *Schedule) error
	Delete(ctx context.Context, id string) error
	List(ctx context.Context) ([]*Schedule, error)
}

// RedisScheduleStore persists schedules in a single Redis hash keyed by
// schedule ID (field) -> JSON (value).
type RedisScheduleStore struct {
	client *redis.Client
	key    string
}

// NewRedisScheduleStore creates a Redis-backed schedule store.
func NewRedisScheduleStore(client *redis.Client) *RedisScheduleStore {
	return &RedisScheduleStore{client: client, key: "schedules"}
}

func (s *RedisScheduleStore) Save(ctx context.Context, sched *Schedule) error {
	b, err := json.Marshal(sched)
	if err != nil {
		return fmt.Errorf("marshal schedule: %w", err)
	}
	if err := s.client.HSet(ctx, s.key, sched.ID, b).Err(); err != nil {
		return fmt.Errorf("persist schedule: %w", err)
	}
	return nil
}

func (s *RedisScheduleStore) Delete(ctx context.Context, id string) error {
	if err := s.client.HDel(ctx, s.key, id).Err(); err != nil {
		return fmt.Errorf("delete schedule: %w", err)
	}
	return nil
}

func (s *RedisScheduleStore) List(ctx context.Context) ([]*Schedule, error) {
	m, err := s.client.HGetAll(ctx, s.key).Result()
	if err != nil {
		return nil, fmt.Errorf("list schedules: %w", err)
	}
	out := make([]*Schedule, 0, len(m))
	for _, v := range m {
		var sc Schedule
		if err := json.Unmarshal([]byte(v), &sc); err != nil {
			// Skip corrupt entries rather than failing the whole load.
			continue
		}
		out = append(out, &sc)
	}
	return out, nil
}
