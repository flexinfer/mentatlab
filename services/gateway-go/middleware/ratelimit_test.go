package middleware

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestRateLimiterAllow(t *testing.T) {
	rl := NewRateLimiter(&RateLimitConfig{
		RequestsPerSecond: 10,
		BurstSize:         5,
		CleanupInterval:   time.Minute,
		BucketTTL:         5 * time.Minute,
	})
	defer rl.Stop()

	t.Run("allows burst requests", func(t *testing.T) {
		key := "test-client-burst"
		// Should allow up to BurstSize requests immediately
		for i := 0; i < 5; i++ {
			if !rl.Allow(key) {
				t.Errorf("request %d should be allowed within burst", i+1)
			}
		}
	})

	t.Run("blocks after burst exhausted", func(t *testing.T) {
		key := "test-client-block"
		// Exhaust burst
		for i := 0; i < 5; i++ {
			rl.Allow(key)
		}
		// Next request should be blocked
		if rl.Allow(key) {
			t.Error("request should be blocked after burst exhausted")
		}
	})

	t.Run("refills tokens over time", func(t *testing.T) {
		key := "test-client-refill"
		// Exhaust burst
		for i := 0; i < 5; i++ {
			rl.Allow(key)
		}

		// Wait for tokens to refill (100ms = 1 token at 10 RPS)
		time.Sleep(150 * time.Millisecond)

		if !rl.Allow(key) {
			t.Error("should have refilled at least 1 token")
		}
	})

	t.Run("independent keys", func(t *testing.T) {
		key1 := "client-1"
		key2 := "client-2"

		// Exhaust key1
		for i := 0; i < 5; i++ {
			rl.Allow(key1)
		}

		// key2 should still have full burst
		if !rl.Allow(key2) {
			t.Error("key2 should be independent of key1")
		}
	})
}

func TestRateLimiterMiddleware(t *testing.T) {
	rl := NewRateLimiter(&RateLimitConfig{
		RequestsPerSecond: 10,
		BurstSize:         2,
		CleanupInterval:   time.Minute,
		BucketTTL:         5 * time.Minute,
		SkipPaths:         []string{"/health", "/healthz"},
	})
	defer rl.Stop()

	handler := rl.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))

	t.Run("allows requests within limit", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		req.RemoteAddr = "192.168.1.1:12345"

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
	})

	t.Run("blocks requests over limit", func(t *testing.T) {
		// Use a unique IP for this test
		for i := 0; i < 3; i++ {
			req := httptest.NewRequest("GET", "/api/test", nil)
			req.RemoteAddr = "192.168.1.100:12345"

			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			if i < 2 && rr.Code != http.StatusOK {
				t.Errorf("request %d should succeed, got %d", i+1, rr.Code)
			}
			if i >= 2 && rr.Code != http.StatusTooManyRequests {
				t.Errorf("request %d should be rate limited, got %d", i+1, rr.Code)
			}
		}
	})

	t.Run("skips health paths", func(t *testing.T) {
		// Exhaust rate limit for this IP
		for i := 0; i < 10; i++ {
			req := httptest.NewRequest("GET", "/api/test", nil)
			req.RemoteAddr = "192.168.1.200:12345"
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
		}

		// Health endpoint should still work
		req := httptest.NewRequest("GET", "/health", nil)
		req.RemoteAddr = "192.168.1.200:12345"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("health endpoint should bypass rate limit, got %d", rr.Code)
		}
	})

	t.Run("sets rate limit headers", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/api/test", nil)
		req.RemoteAddr = "192.168.1.201:12345"

		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if rr.Header().Get("X-RateLimit-Limit") != "10" {
			t.Errorf("expected X-RateLimit-Limit header, got %q", rr.Header().Get("X-RateLimit-Limit"))
		}
	})
}

func TestRateLimiterConcurrency(t *testing.T) {
	rl := NewRateLimiter(&RateLimitConfig{
		RequestsPerSecond: 1000,
		BurstSize:         100,
		CleanupInterval:   time.Minute,
		BucketTTL:         5 * time.Minute,
	})
	defer rl.Stop()

	var wg sync.WaitGroup
	allowed := make(chan bool, 200)

	// Concurrent requests from same key
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			allowed <- rl.Allow("concurrent-key")
		}()
	}

	wg.Wait()
	close(allowed)

	allowedCount := 0
	for a := range allowed {
		if a {
			allowedCount++
		}
	}

	// Should allow around burst size (100) initially
	if allowedCount < 90 || allowedCount > 150 {
		t.Errorf("expected ~100 allowed requests, got %d", allowedCount)
	}
}

func TestDefaultKeyFunc(t *testing.T) {
	tests := []struct {
		name        string
		remoteAddr  string
		xForwarded  string
		xRealIP     string
		expectedKey string
	}{
		{
			name:        "uses RemoteAddr when no headers",
			remoteAddr:  "192.168.1.1:12345",
			expectedKey: "192.168.1.1",
		},
		{
			name:        "uses X-Forwarded-For first IP",
			remoteAddr:  "10.0.0.1:12345",
			xForwarded:  "203.0.113.1, 10.0.0.1",
			expectedKey: "203.0.113.1",
		},
		{
			name:        "uses X-Real-IP when present",
			remoteAddr:  "10.0.0.1:12345",
			xRealIP:     "203.0.113.2",
			expectedKey: "203.0.113.2",
		},
		{
			name:        "prefers X-Forwarded-For over X-Real-IP",
			remoteAddr:  "10.0.0.1:12345",
			xForwarded:  "203.0.113.1",
			xRealIP:     "203.0.113.2",
			expectedKey: "203.0.113.1",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/", nil)
			req.RemoteAddr = tt.remoteAddr
			if tt.xForwarded != "" {
				req.Header.Set("X-Forwarded-For", tt.xForwarded)
			}
			if tt.xRealIP != "" {
				req.Header.Set("X-Real-IP", tt.xRealIP)
			}

			key := defaultKeyFunc(req)
			if key != tt.expectedKey {
				t.Errorf("expected key %q, got %q", tt.expectedKey, key)
			}
		})
	}
}

func TestRateLimiterCleanup(t *testing.T) {
	rl := NewRateLimiter(&RateLimitConfig{
		RequestsPerSecond: 10,
		BurstSize:         5,
		CleanupInterval:   50 * time.Millisecond,
		BucketTTL:         100 * time.Millisecond,
	})
	defer rl.Stop()

	// Create a bucket
	rl.Allow("cleanup-test")

	rl.mu.RLock()
	if _, ok := rl.buckets["cleanup-test"]; !ok {
		t.Fatal("bucket should exist")
	}
	rl.mu.RUnlock()

	// Wait for cleanup to run
	time.Sleep(200 * time.Millisecond)

	rl.mu.RLock()
	if _, ok := rl.buckets["cleanup-test"]; ok {
		t.Error("bucket should have been cleaned up")
	}
	rl.mu.RUnlock()
}
