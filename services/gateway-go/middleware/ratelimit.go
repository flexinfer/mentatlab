package middleware

import (
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"
)

// RateLimitConfig holds rate limiting configuration.
type RateLimitConfig struct {
	// RequestsPerSecond is the rate limit (tokens added per second)
	RequestsPerSecond float64

	// BurstSize is the maximum number of requests allowed in a burst
	BurstSize int

	// CleanupInterval is how often to clean up expired buckets
	CleanupInterval time.Duration

	// BucketTTL is how long to keep idle buckets
	BucketTTL time.Duration

	// SkipPaths are paths exempt from rate limiting
	SkipPaths []string

	// KeyFunc extracts the rate limit key from a request (default: IP address)
	KeyFunc func(*http.Request) string
}

// DefaultRateLimitConfig returns sensible defaults.
func DefaultRateLimitConfig() *RateLimitConfig {
	return &RateLimitConfig{
		RequestsPerSecond: 100,
		BurstSize:         200,
		CleanupInterval:   time.Minute,
		BucketTTL:         5 * time.Minute,
		SkipPaths:         []string{"/health", "/healthz", "/ready"},
		KeyFunc:           defaultKeyFunc,
	}
}

// defaultKeyFunc extracts client IP for rate limiting.
func defaultKeyFunc(r *http.Request) string {
	// Check X-Forwarded-For first (for proxied requests)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first IP in the chain
		if idx := len(xff); idx > 0 {
			for i, c := range xff {
				if c == ',' {
					return xff[:i]
				}
			}
			return xff
		}
	}

	// Check X-Real-IP
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}

	// Fall back to RemoteAddr
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// tokenBucket implements the token bucket algorithm.
type tokenBucket struct {
	tokens     float64
	lastUpdate time.Time
	mu         sync.Mutex
}

// RateLimiter implements rate limiting using token buckets.
type RateLimiter struct {
	config  *RateLimitConfig
	buckets map[string]*tokenBucket
	mu      sync.RWMutex
	stopCh  chan struct{}
}

// NewRateLimiter creates a new rate limiter.
func NewRateLimiter(cfg *RateLimitConfig) *RateLimiter {
	if cfg == nil {
		cfg = DefaultRateLimitConfig()
	}
	if cfg.KeyFunc == nil {
		cfg.KeyFunc = defaultKeyFunc
	}

	rl := &RateLimiter{
		config:  cfg,
		buckets: make(map[string]*tokenBucket),
		stopCh:  make(chan struct{}),
	}

	// Start cleanup goroutine
	go rl.cleanup()

	return rl
}

// cleanup removes expired buckets periodically.
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(rl.config.CleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			rl.mu.Lock()
			now := time.Now()
			for key, bucket := range rl.buckets {
				bucket.mu.Lock()
				if now.Sub(bucket.lastUpdate) > rl.config.BucketTTL {
					delete(rl.buckets, key)
				}
				bucket.mu.Unlock()
			}
			rl.mu.Unlock()
		case <-rl.stopCh:
			return
		}
	}
}

// Stop stops the cleanup goroutine.
func (rl *RateLimiter) Stop() {
	close(rl.stopCh)
}

// Allow checks if a request should be allowed.
func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.RLock()
	bucket, exists := rl.buckets[key]
	rl.mu.RUnlock()

	if !exists {
		rl.mu.Lock()
		// Double-check after acquiring write lock
		bucket, exists = rl.buckets[key]
		if !exists {
			bucket = &tokenBucket{
				tokens:     float64(rl.config.BurstSize),
				lastUpdate: time.Now(),
			}
			rl.buckets[key] = bucket
		}
		rl.mu.Unlock()
	}

	bucket.mu.Lock()
	defer bucket.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(bucket.lastUpdate).Seconds()
	bucket.lastUpdate = now

	// Add tokens based on elapsed time
	bucket.tokens += elapsed * rl.config.RequestsPerSecond
	if bucket.tokens > float64(rl.config.BurstSize) {
		bucket.tokens = float64(rl.config.BurstSize)
	}

	// Check if we have tokens available
	if bucket.tokens >= 1 {
		bucket.tokens--
		return true
	}

	return false
}

// Middleware returns an HTTP middleware that enforces rate limiting.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check skip paths
		for _, path := range rl.config.SkipPaths {
			if r.URL.Path == path || (len(path) > 0 && path[len(path)-1] == '/' && len(r.URL.Path) >= len(path) && r.URL.Path[:len(path)] == path) {
				next.ServeHTTP(w, r)
				return
			}
		}

		key := rl.config.KeyFunc(r)

		if !rl.Allow(key) {
			w.Header().Set("Retry-After", "1")
			w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%.0f", rl.config.RequestsPerSecond))
			w.Header().Set("X-RateLimit-Remaining", "0")
			http.Error(w, `{"error": "rate limit exceeded"}`, http.StatusTooManyRequests)
			return
		}

		// Add rate limit headers
		w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%.0f", rl.config.RequestsPerSecond))

		next.ServeHTTP(w, r)
	})
}
