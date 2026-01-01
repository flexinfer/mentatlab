package auth

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"golang.org/x/time/rate"
)

// contextKey is used for storing claims in context.
type contextKey string

const claimsContextKey contextKey = "claims"

// Middleware provides HTTP middleware for authentication and authorization.
type Middleware struct {
	provider      *Provider
	enabled       bool
	publicPaths   map[string]bool
	requiredRoles []string
}

// MiddlewareConfig holds middleware configuration.
type MiddlewareConfig struct {
	// Enabled controls whether auth is enforced
	Enabled bool

	// PublicPaths are paths that don't require authentication
	PublicPaths []string

	// RequiredRoles are roles required for all protected endpoints
	RequiredRoles []string
}

// NewMiddleware creates a new auth middleware.
func NewMiddleware(provider *Provider, cfg *MiddlewareConfig) *Middleware {
	if cfg == nil {
		cfg = &MiddlewareConfig{}
	}

	publicPaths := make(map[string]bool)
	// Default public paths
	publicPaths["/health"] = true
	publicPaths["/healthz"] = true
	publicPaths["/ready"] = true

	for _, p := range cfg.PublicPaths {
		publicPaths[p] = true
	}

	return &Middleware{
		provider:      provider,
		enabled:       cfg.Enabled,
		publicPaths:   publicPaths,
		requiredRoles: cfg.RequiredRoles,
	}
}

// Handler returns the auth middleware handler.
func (m *Middleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for public paths
		if m.publicPaths[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}

		// Skip auth if disabled
		if !m.enabled || m.provider == nil {
			next.ServeHTTP(w, r)
			return
		}

		// Extract token from Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			m.unauthorized(w, "missing authorization header")
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == authHeader {
			m.unauthorized(w, "invalid authorization header format")
			return
		}

		// Verify token
		claims, err := m.provider.VerifyToken(r.Context(), token)
		if err != nil {
			// Try as access token via userinfo
			claims, err = m.provider.VerifyAccessToken(r.Context(), token)
			if err != nil {
				m.unauthorized(w, "invalid token")
				return
			}
		}

		// Check expiry
		if claims.IsExpired() {
			m.unauthorized(w, "token expired")
			return
		}

		// Check required roles
		if len(m.requiredRoles) > 0 {
			hasRole := false
			for _, role := range m.requiredRoles {
				if claims.HasRole(role) {
					hasRole = true
					break
				}
			}
			if !hasRole {
				m.forbidden(w, "insufficient permissions")
				return
			}
		}

		// Add claims to context
		ctx := context.WithValue(r.Context(), claimsContextKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetClaims extracts claims from the request context.
func GetClaims(ctx context.Context) *Claims {
	claims, _ := ctx.Value(claimsContextKey).(*Claims)
	return claims
}

// RequireRole middleware checks for a specific role.
func RequireRole(role string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := GetClaims(r.Context())
			if claims == nil || !claims.HasRole(role) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "insufficient permissions",
				})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireGroup middleware checks for a specific group.
func RequireGroup(group string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims := GetClaims(r.Context())
			if claims == nil || !claims.HasGroup(group) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "insufficient permissions",
				})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (m *Middleware) unauthorized(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("WWW-Authenticate", `Bearer realm="mentatlab"`)
	w.WriteHeader(http.StatusUnauthorized)
	json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}

func (m *Middleware) forbidden(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}

// RateLimiter provides rate limiting middleware.
type RateLimiter struct {
	limiter *rate.Limiter
}

// NewRateLimiter creates a new rate limiter.
// rps is requests per second, burst is the maximum burst size.
func NewRateLimiter(rps float64, burst int) *RateLimiter {
	return &RateLimiter{
		limiter: rate.NewLimiter(rate.Limit(rps), burst),
	}
}

// Handler returns the rate limiting middleware handler.
func (rl *RateLimiter) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !rl.limiter.Allow() {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "rate limit exceeded",
			})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// PerIPRateLimiter provides per-IP rate limiting.
type PerIPRateLimiter struct {
	limiters map[string]*rate.Limiter
	rps      float64
	burst    int
	cleanup  time.Duration
}

// NewPerIPRateLimiter creates a new per-IP rate limiter.
func NewPerIPRateLimiter(rps float64, burst int) *PerIPRateLimiter {
	rl := &PerIPRateLimiter{
		limiters: make(map[string]*rate.Limiter),
		rps:      rps,
		burst:    burst,
		cleanup:  time.Hour,
	}

	// Start cleanup goroutine
	go rl.cleanupLoop()

	return rl
}

func (rl *PerIPRateLimiter) getLimiter(ip string) *rate.Limiter {
	limiter, ok := rl.limiters[ip]
	if !ok {
		limiter = rate.NewLimiter(rate.Limit(rl.rps), rl.burst)
		rl.limiters[ip] = limiter
	}
	return limiter
}

func (rl *PerIPRateLimiter) cleanupLoop() {
	ticker := time.NewTicker(rl.cleanup)
	for range ticker.C {
		// Simple cleanup: just clear old entries periodically
		// In production, track last access time
		if len(rl.limiters) > 10000 {
			rl.limiters = make(map[string]*rate.Limiter)
		}
	}
}

// Handler returns the per-IP rate limiting middleware handler.
func (rl *PerIPRateLimiter) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := getClientIP(r)
		limiter := rl.getLimiter(ip)

		if !limiter.Allow() {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "rate limit exceeded",
			})
			slog.Warn("rate limit exceeded", slog.String("ip", ip))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For header (from load balancer/proxy)
	xff := r.Header.Get("X-Forwarded-For")
	if xff != "" {
		// Take the first IP (original client)
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}

	// Check X-Real-IP header
	xri := r.Header.Get("X-Real-IP")
	if xri != "" {
		return xri
	}

	// Fall back to RemoteAddr
	ip := r.RemoteAddr
	// Remove port
	if idx := strings.LastIndex(ip, ":"); idx != -1 {
		ip = ip[:idx]
	}
	return ip
}
