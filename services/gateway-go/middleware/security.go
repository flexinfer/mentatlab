package middleware

import (
	"fmt"
	"net/http"
	"strings"
)

// SecurityConfig holds security middleware configuration.
type SecurityConfig struct {
	// AllowedOrigins for CORS (empty means allow all - not recommended for production)
	AllowedOrigins []string

	// AllowedMethods for CORS
	AllowedMethods []string

	// AllowedHeaders for CORS
	AllowedHeaders []string

	// ContentSecurityPolicy header value
	ContentSecurityPolicy string

	// FrameOptions controls X-Frame-Options (DENY, SAMEORIGIN, or empty to skip)
	FrameOptions string

	// HSTSMaxAge sets Strict-Transport-Security max-age (0 to disable)
	HSTSMaxAge int

	// ReferrerPolicy header value
	ReferrerPolicy string
}

// DefaultSecurityConfig returns production-safe defaults.
func DefaultSecurityConfig() *SecurityConfig {
	return &SecurityConfig{
		AllowedOrigins:        []string{}, // Must be configured
		AllowedMethods:        []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders:        []string{"Content-Type", "Authorization", "X-Request-ID", "CF-Access-JWT-Assertion"},
		ContentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' wss: ws:",
		FrameOptions:          "DENY",
		HSTSMaxAge:            31536000, // 1 year
		ReferrerPolicy:        "strict-origin-when-cross-origin",
	}
}

// SecurityMiddleware adds security headers to responses.
type SecurityMiddleware struct {
	config *SecurityConfig
}

// NewSecurityMiddleware creates a new security middleware.
func NewSecurityMiddleware(cfg *SecurityConfig) *SecurityMiddleware {
	if cfg == nil {
		cfg = DefaultSecurityConfig()
	}
	return &SecurityMiddleware{config: cfg}
}

// Middleware returns the HTTP middleware handler.
func (m *SecurityMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Security headers
		if m.config.FrameOptions != "" {
			w.Header().Set("X-Frame-Options", m.config.FrameOptions)
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-XSS-Protection", "1; mode=block")

		if m.config.ContentSecurityPolicy != "" {
			w.Header().Set("Content-Security-Policy", m.config.ContentSecurityPolicy)
		}

		if m.config.ReferrerPolicy != "" {
			w.Header().Set("Referrer-Policy", m.config.ReferrerPolicy)
		}

		// HSTS - set regardless of TLS (assumes TLS termination at ingress/proxy)
		if m.config.HSTSMaxAge > 0 {
			w.Header().Set("Strict-Transport-Security",
				fmt.Sprintf("max-age=%d; includeSubDomains", m.config.HSTSMaxAge))
		}

		// Permissions-Policy (formerly Feature-Policy)
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")

		next.ServeHTTP(w, r)
	})
}

// CORSMiddleware handles CORS preflight and response headers.
func (m *SecurityMiddleware) CORSMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		// Check if origin is allowed
		allowed := false
		if len(m.config.AllowedOrigins) == 0 {
			// No origins configured - allow all (not recommended for production)
			allowed = true
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else {
			for _, o := range m.config.AllowedOrigins {
				if o == "*" || o == origin {
					allowed = true
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
					break
				}
			}
		}

		if !allowed && origin != "" {
			// Origin not allowed - proceed without CORS headers
			next.ServeHTTP(w, r)
			return
		}

		// Set CORS headers
		w.Header().Set("Access-Control-Allow-Methods", strings.Join(m.config.AllowedMethods, ", "))
		w.Header().Set("Access-Control-Allow-Headers", strings.Join(m.config.AllowedHeaders, ", "))
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "86400") // 24 hours

		// Handle preflight
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
