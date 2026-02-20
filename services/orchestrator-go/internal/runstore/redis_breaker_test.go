package runstore

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/sony/gobreaker"
)

func newTestRedisStore(t *testing.T) (*RedisStore, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)

	store, err := NewRedisStore(&RedisConfig{
		URL: "redis://" + mr.Addr(),
	})
	if err != nil {
		t.Fatalf("NewRedisStore: %v", err)
	}
	return store, mr
}

func TestRedisStore_BreakerInitialized(t *testing.T) {
	store, _ := newTestRedisStore(t)
	if store.breaker == nil {
		t.Fatal("expected breaker to be initialized")
	}
}

func TestRedisStore_BreakerOpensAfterConsecutiveFailures(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}

	store, err := NewRedisStore(&RedisConfig{
		URL: "redis://" + mr.Addr(),
	})
	if err != nil {
		t.Fatalf("NewRedisStore: %v", err)
	}

	// Stop miniredis to simulate Redis being down
	mr.Close()

	ctx := context.Background()

	// Make 5 consecutive failing calls (breaker threshold)
	for i := 0; i < 5; i++ {
		_, callErr := store.GetRunMeta(ctx, "nonexistent")
		if callErr == nil {
			t.Fatalf("call %d: expected error with Redis down", i)
		}
		// These should be Redis connection errors, not circuit breaker errors
		if strings.Contains(callErr.Error(), "circuit breaker") {
			t.Fatalf("call %d: got circuit breaker error too early: %v", i, callErr)
		}
	}

	// 6th call should get a circuit breaker open error
	_, err = store.GetRunMeta(ctx, "nonexistent")
	if err == nil {
		t.Fatal("expected circuit breaker error")
	}
	if !strings.Contains(err.Error(), "circuit breaker open") {
		t.Errorf("expected circuit breaker open error, got: %v", err)
	}
}

func TestRedisStore_BreakerAllowsAfterTimeout(t *testing.T) {
	// Use a custom breaker with short timeout for testing
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}

	store, err := NewRedisStore(&RedisConfig{
		URL: "redis://" + mr.Addr(),
	})
	if err != nil {
		t.Fatalf("NewRedisStore: %v", err)
	}

	// Replace breaker with short timeout
	store.breaker = gobreaker.NewTwoStepCircuitBreaker(gobreaker.Settings{
		Name:        "redis-test",
		MaxRequests: 1,
		Timeout:     100 * time.Millisecond,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= 5
		},
	})

	// Stop Redis and trigger breaker
	mr.Close()

	ctx := context.Background()
	for i := 0; i < 5; i++ {
		_, _ = store.GetRunMeta(ctx, "nonexistent")
	}

	// Verify breaker is open
	_, err = store.GetRunMeta(ctx, "nonexistent")
	if err == nil || !strings.Contains(err.Error(), "circuit breaker open") {
		t.Fatalf("expected circuit breaker open error, got: %v", err)
	}

	// Wait for timeout to expire (half-open state)
	time.Sleep(150 * time.Millisecond)

	// Next call should be allowed through (half-open), but will fail since Redis is still down
	_, err = store.GetRunMeta(ctx, "nonexistent")
	if err == nil {
		t.Fatal("expected error with Redis still down")
	}
	// The error should be a Redis error, not a circuit breaker error,
	// because the breaker allowed the probe request in half-open state
	if strings.Contains(err.Error(), "circuit breaker open") {
		t.Errorf("expected Redis error in half-open state, got circuit breaker error: %v", err)
	}
}

func TestRedisStore_BreakerSuccessResetsCount(t *testing.T) {
	store, mr := newTestRedisStore(t)
	ctx := context.Background()

	// Stop Redis and cause some failures (but not enough to trip)
	mr.Close()
	for i := 0; i < 3; i++ {
		_, _ = store.GetRunMeta(ctx, "nonexistent")
	}

	// Restart Redis
	if err := mr.Start(); err != nil {
		t.Fatalf("restart miniredis: %v", err)
	}

	// Successful call should reset consecutive failure count
	_, err := store.CreateRun(ctx, "test-run", nil, "owner")
	if err != nil {
		t.Fatalf("CreateRun after restart: %v", err)
	}

	// Stop Redis again
	mr.Close()

	// Need 5 more consecutive failures to trip (not 2)
	for i := 0; i < 4; i++ {
		_, callErr := store.GetRunMeta(ctx, "nonexistent")
		if callErr == nil {
			t.Fatalf("call %d: expected error with Redis down", i)
		}
		if strings.Contains(callErr.Error(), "circuit breaker") {
			t.Fatalf("call %d: breaker tripped too early after reset", i)
		}
	}
}

func TestRedisStore_BreakerProtectsMultipleMethods(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}

	store, err := NewRedisStore(&RedisConfig{
		URL: "redis://" + mr.Addr(),
	})
	if err != nil {
		t.Fatalf("NewRedisStore: %v", err)
	}

	mr.Close()
	ctx := context.Background()

	// Trip the breaker using different methods
	_, _ = store.GetRun(ctx, "r1")
	_, _ = store.ListRuns(ctx)
	_ = store.UpdateRunStatus(ctx, "r1", "failed", nil, nil)
	_ = store.CancelRun(ctx, "r1")
	_, _ = store.IsCancelled(ctx, "r1")

	// All methods should now get circuit breaker errors
	_, err = store.CreateRun(ctx, "test", nil, "owner")
	if !strings.Contains(err.Error(), "circuit breaker open") {
		t.Errorf("CreateRun: expected circuit breaker open, got: %v", err)
	}

	_, err = store.GetRunMeta(ctx, "r1")
	if !strings.Contains(err.Error(), "circuit breaker open") {
		t.Errorf("GetRunMeta: expected circuit breaker open, got: %v", err)
	}

	err = store.SetRunWebhook(ctx, "r1", "http://example.com", "secret")
	if !strings.Contains(err.Error(), "circuit breaker open") {
		t.Errorf("SetRunWebhook: expected circuit breaker open, got: %v", err)
	}
}

func TestRedisStore_NilBreakerIsNoOp(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)

	store, err := NewRedisStore(&RedisConfig{
		URL: "redis://" + mr.Addr(),
	})
	if err != nil {
		t.Fatalf("NewRedisStore: %v", err)
	}

	// Clear breaker to simulate nil
	store.breaker = nil

	ctx := context.Background()
	_, err = store.CreateRun(ctx, "test", nil, "owner")
	if err != nil {
		t.Fatalf("CreateRun with nil breaker: %v", err)
	}
}
