package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"golang.org/x/time/rate"
)

func newTestRedis(t *testing.T) (*redis.Client, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return client, mr
}

func TestAPIKeyStore_GenerateKey(t *testing.T) {
	client, _ := newTestRedis(t)
	store := NewAPIKeyStore(client)
	ctx := context.Background()

	plaintext, key, err := store.GenerateKey(ctx, "test-key", "user@example.com", []string{"read", "write"})
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}

	// Check plaintext format
	if !strings.HasPrefix(plaintext, "mlk_") {
		t.Errorf("plaintext prefix: got %q, want mlk_ prefix", plaintext[:10])
	}
	// mlk_ + 64 hex chars = 68 total
	if len(plaintext) != 68 {
		t.Errorf("plaintext length: got %d, want 68", len(plaintext))
	}

	// Check key metadata
	if key.Name != "test-key" {
		t.Errorf("Name: got %q, want %q", key.Name, "test-key")
	}
	if key.Owner != "user@example.com" {
		t.Errorf("Owner: got %q, want %q", key.Owner, "user@example.com")
	}
	if len(key.Scopes) != 2 || key.Scopes[0] != "read" {
		t.Errorf("Scopes: got %v, want [read write]", key.Scopes)
	}
	if key.ID == "" {
		t.Error("ID: expected non-empty")
	}
	if len(key.ID) != 12 {
		t.Errorf("ID length: got %d, want 12", len(key.ID))
	}
	if key.KeyHash == "" {
		t.Error("KeyHash: expected non-empty")
	}
	if key.CreatedAt.IsZero() {
		t.Error("CreatedAt: expected non-zero")
	}
}

func TestAPIKeyStore_ValidateKey(t *testing.T) {
	client, _ := newTestRedis(t)
	store := NewAPIKeyStore(client)
	ctx := context.Background()

	plaintext, _, err := store.GenerateKey(ctx, "validate-test", "owner@test.com", nil)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}

	// Valid key
	key, err := store.ValidateKey(ctx, plaintext)
	if err != nil {
		t.Fatalf("ValidateKey: %v", err)
	}
	if key.Name != "validate-test" {
		t.Errorf("Name: got %q, want %q", key.Name, "validate-test")
	}
	if key.Owner != "owner@test.com" {
		t.Errorf("Owner: got %q, want %q", key.Owner, "owner@test.com")
	}
}

func TestAPIKeyStore_ValidateKey_Invalid(t *testing.T) {
	client, _ := newTestRedis(t)
	store := NewAPIKeyStore(client)
	ctx := context.Background()

	_, err := store.ValidateKey(ctx, "mlk_invalid_key_that_does_not_exist_in_store_aaaa")
	if err == nil {
		t.Fatal("expected error for invalid key")
	}
	if !strings.Contains(err.Error(), "invalid api key") {
		t.Errorf("error: got %q, want to contain 'invalid api key'", err.Error())
	}
}

func TestAPIKeyStore_RevokeKey(t *testing.T) {
	client, _ := newTestRedis(t)
	store := NewAPIKeyStore(client)
	ctx := context.Background()

	plaintext, key, err := store.GenerateKey(ctx, "revoke-test", "owner@test.com", nil)
	if err != nil {
		t.Fatalf("GenerateKey: %v", err)
	}

	// Revoke
	if err := store.RevokeKey(ctx, key.KeyHash); err != nil {
		t.Fatalf("RevokeKey: %v", err)
	}

	// Should no longer validate
	_, err = store.ValidateKey(ctx, plaintext)
	if err == nil {
		t.Error("expected error after revocation")
	}
}

func TestAPIKeyStore_ListKeys(t *testing.T) {
	client, _ := newTestRedis(t)
	store := NewAPIKeyStore(client)
	ctx := context.Background()

	// Create keys for different owners
	_, _, _ = store.GenerateKey(ctx, "key-a", "alice@test.com", nil)
	_, _, _ = store.GenerateKey(ctx, "key-b", "alice@test.com", nil)
	_, _, _ = store.GenerateKey(ctx, "key-c", "bob@test.com", nil)

	// List all
	all, err := store.ListKeys(ctx, "")
	if err != nil {
		t.Fatalf("ListKeys all: %v", err)
	}
	if len(all) != 3 {
		t.Errorf("all keys: got %d, want 3", len(all))
	}

	// Filter by owner
	aliceKeys, err := store.ListKeys(ctx, "alice@test.com")
	if err != nil {
		t.Fatalf("ListKeys alice: %v", err)
	}
	if len(aliceKeys) != 2 {
		t.Errorf("alice keys: got %d, want 2", len(aliceKeys))
	}

	bobKeys, err := store.ListKeys(ctx, "bob@test.com")
	if err != nil {
		t.Fatalf("ListKeys bob: %v", err)
	}
	if len(bobKeys) != 1 {
		t.Errorf("bob keys: got %d, want 1", len(bobKeys))
	}
}

func TestAPIKeyStore_ListKeys_Empty(t *testing.T) {
	client, _ := newTestRedis(t)
	store := NewAPIKeyStore(client)
	ctx := context.Background()

	keys, err := store.ListKeys(ctx, "")
	if err != nil {
		t.Fatalf("ListKeys: %v", err)
	}
	if len(keys) != 0 {
		t.Errorf("count: got %d, want 0", len(keys))
	}
}

func TestAPIKeyStore_ListKeys_OwnerCaseInsensitive(t *testing.T) {
	client, _ := newTestRedis(t)
	store := NewAPIKeyStore(client)
	ctx := context.Background()

	store.GenerateKey(ctx, "key-1", "Alice@Test.Com", nil)

	keys, err := store.ListKeys(ctx, "alice@test.com")
	if err != nil {
		t.Fatalf("ListKeys: %v", err)
	}
	if len(keys) != 1 {
		t.Errorf("count: got %d, want 1", len(keys))
	}
}

// --- PerIPRateLimiter tests ---

func TestPerIPRateLimiter_AllowsWithinLimit(t *testing.T) {
	rl := &PerIPRateLimiter{
		limiters: make(map[string]*rate.Limiter),
		rps:      100,
		burst:    10,
		cleanup:  time.Hour,
	}

	handler := rl.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/v1/runs", nil)
	req.RemoteAddr = "10.0.0.1:12345"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("within limit: got %d, want 200", rr.Code)
	}
}

func TestPerIPRateLimiter_IsolatesIPs(t *testing.T) {
	rl := &PerIPRateLimiter{
		limiters: make(map[string]*rate.Limiter),
		rps:      0.001,
		burst:    1,
		cleanup:  time.Hour,
	}

	handler := rl.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Exhaust IP 1's burst
	req1 := httptest.NewRequest("GET", "/api/v1/runs", nil)
	req1.RemoteAddr = "10.0.0.1:12345"
	rr1 := httptest.NewRecorder()
	handler.ServeHTTP(rr1, req1)
	if rr1.Code != http.StatusOK {
		t.Errorf("IP1 first: got %d, want 200", rr1.Code)
	}

	// IP 1 should be rate limited
	rr1b := httptest.NewRecorder()
	handler.ServeHTTP(rr1b, req1)
	if rr1b.Code != http.StatusTooManyRequests {
		t.Errorf("IP1 second: got %d, want 429", rr1b.Code)
	}

	// IP 2 should still work (separate limiter)
	req2 := httptest.NewRequest("GET", "/api/v1/runs", nil)
	req2.RemoteAddr = "10.0.0.2:12345"
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Errorf("IP2 first: got %d, want 200", rr2.Code)
	}
}

func TestPerIPRateLimiter_RejectsRetryAfter(t *testing.T) {
	rl := &PerIPRateLimiter{
		limiters: make(map[string]*rate.Limiter),
		rps:      0.001,
		burst:    1,
		cleanup:  time.Hour,
	}

	handler := rl.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.1:12345"

	// Use burst token
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	// Exceed limit
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req)
	if rr2.Code != http.StatusTooManyRequests {
		t.Errorf("code: got %d, want 429", rr2.Code)
	}
	if rr2.Header().Get("Retry-After") != "1" {
		t.Errorf("Retry-After: got %q, want %q", rr2.Header().Get("Retry-After"), "1")
	}
}
