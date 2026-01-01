// Package middleware provides HTTP middleware for the gateway service.
package middleware

import (
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// base64URLDecode decodes a base64url-encoded string (used in JWK).
func base64URLDecode(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}

// AuthConfig holds Cloudflare Access authentication configuration.
type AuthConfig struct {
	// TeamDomain is the Cloudflare Access team domain (e.g., "myteam.cloudflareaccess.com")
	TeamDomain string

	// PolicyAUD is the Application Audience (AUD) tag from Cloudflare Access
	PolicyAUD string

	// ServiceClientID is the Service Token Client ID for outbound requests
	ServiceClientID string

	// ServiceClientSecret is the Service Token Client Secret for outbound requests
	ServiceClientSecret string

	// Enabled controls whether authentication is enforced
	Enabled bool

	// SkipPaths are paths that don't require authentication (e.g., /health)
	SkipPaths []string
}

// CFAccessClaims represents the claims in a Cloudflare Access JWT.
type CFAccessClaims struct {
	jwt.RegisteredClaims
	Email    string `json:"email,omitempty"`
	Type     string `json:"type,omitempty"`      // "app" for service tokens, "user" for user tokens
	Identity struct {
		Email  string   `json:"email,omitempty"`
		Groups []string `json:"groups,omitempty"`
	} `json:"identity,omitempty"`
}

// AuthMiddleware provides Cloudflare Access JWT validation.
type AuthMiddleware struct {
	config   *AuthConfig
	logger   *slog.Logger
	keyCache *keyCache
}

// keyCache caches Cloudflare's public keys.
type keyCache struct {
	mu      sync.RWMutex
	keys    map[string]*rsa.PublicKey
	certsURL string
	lastFetch time.Time
	ttl     time.Duration
}

// NewAuthMiddleware creates a new authentication middleware.
func NewAuthMiddleware(cfg *AuthConfig, logger *slog.Logger) *AuthMiddleware {
	if logger == nil {
		logger = slog.Default()
	}

	if cfg == nil {
		cfg = &AuthConfig{Enabled: false}
	}

	certsURL := ""
	if cfg.TeamDomain != "" {
		certsURL = fmt.Sprintf("https://%s/cdn-cgi/access/certs", cfg.TeamDomain)
	}

	return &AuthMiddleware{
		config: cfg,
		logger: logger,
		keyCache: &keyCache{
			keys:     make(map[string]*rsa.PublicKey),
			certsURL: certsURL,
			ttl:      15 * time.Minute,
		},
	}
}

// contextKey is a custom type for context keys.
type contextKey string

const (
	// UserContextKey is the context key for authenticated user info.
	UserContextKey contextKey = "user"
)

// UserInfo holds authenticated user information.
type UserInfo struct {
	Email  string
	Groups []string
	Type   string // "user" or "app" (service token)
}

// Middleware returns an HTTP middleware that validates Cloudflare Access JWTs.
func (m *AuthMiddleware) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip if auth is disabled
		if !m.config.Enabled {
			next.ServeHTTP(w, r)
			return
		}

		// Skip whitelisted paths
		for _, path := range m.config.SkipPaths {
			if strings.HasPrefix(r.URL.Path, path) {
				next.ServeHTTP(w, r)
				return
			}
		}

		// Extract JWT from header
		token := r.Header.Get("CF-Access-JWT-Assertion")
		if token == "" {
			// Also check Authorization header for Bearer token
			auth := r.Header.Get("Authorization")
			if strings.HasPrefix(auth, "Bearer ") {
				token = strings.TrimPrefix(auth, "Bearer ")
			}
		}

		if token == "" {
			m.logger.Warn("missing authentication token", slog.String("path", r.URL.Path))
			RespondError(w, r, http.StatusUnauthorized, ErrCodeAuthRequired, "Authentication token is required")
			return
		}

		// Validate JWT
		claims, err := m.validateToken(r.Context(), token)
		if err != nil {
			m.logger.Warn("invalid token", slog.String("error", err.Error()), slog.String("path", r.URL.Path))
			RespondErrorWithDetails(w, r, http.StatusUnauthorized, ErrCodeInvalidToken, "Authentication token is invalid or expired", map[string]interface{}{
				"reason": err.Error(),
			})
			return
		}

		// Add user info to context
		userInfo := &UserInfo{
			Email:  claims.Email,
			Type:   claims.Type,
			Groups: claims.Identity.Groups,
		}
		if userInfo.Email == "" {
			userInfo.Email = claims.Identity.Email
		}

		ctx := context.WithValue(r.Context(), UserContextKey, userInfo)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// validateToken validates a Cloudflare Access JWT.
func (m *AuthMiddleware) validateToken(ctx context.Context, tokenString string) (*CFAccessClaims, error) {
	if m.keyCache.certsURL == "" {
		return nil, errors.New("cloudflare access not configured")
	}

	// Parse token without verification first to get the key ID
	token, _, err := jwt.NewParser().ParseUnverified(tokenString, &CFAccessClaims{})
	if err != nil {
		return nil, fmt.Errorf("parse token: %w", err)
	}

	// Get the key ID from header
	kid, ok := token.Header["kid"].(string)
	if !ok {
		return nil, errors.New("missing key ID in token header")
	}

	// Get public key
	key, err := m.getPublicKey(ctx, kid)
	if err != nil {
		return nil, fmt.Errorf("get public key: %w", err)
	}

	// Parse and validate token with key
	claims := &CFAccessClaims{}
	parsedToken, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return key, nil
	}, jwt.WithAudience(m.config.PolicyAUD), jwt.WithIssuer(fmt.Sprintf("https://%s", m.config.TeamDomain)))

	if err != nil {
		return nil, fmt.Errorf("validate token: %w", err)
	}

	if !parsedToken.Valid {
		return nil, errors.New("invalid token")
	}

	return claims, nil
}

// getPublicKey retrieves a public key by ID, fetching from Cloudflare if needed.
func (m *AuthMiddleware) getPublicKey(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	m.keyCache.mu.RLock()
	key, ok := m.keyCache.keys[kid]
	needsRefresh := time.Since(m.keyCache.lastFetch) > m.keyCache.ttl
	m.keyCache.mu.RUnlock()

	if ok && !needsRefresh {
		return key, nil
	}

	// Fetch keys from Cloudflare
	if err := m.fetchKeys(ctx); err != nil {
		// If we have a cached key, use it even if stale
		if ok {
			return key, nil
		}
		return nil, err
	}

	m.keyCache.mu.RLock()
	key, ok = m.keyCache.keys[kid]
	m.keyCache.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("key not found: %s", kid)
	}

	return key, nil
}

// fetchKeys fetches public keys from Cloudflare Access.
func (m *AuthMiddleware) fetchKeys(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", m.keyCache.certsURL, nil)
	if err != nil {
		return err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to fetch keys: %d", resp.StatusCode)
	}

	var jwks struct {
		Keys []struct {
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
			Kty string `json:"kty"`
		} `json:"keys"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return err
	}

	m.keyCache.mu.Lock()
	defer m.keyCache.mu.Unlock()

	for _, k := range jwks.Keys {
		if k.Kty != "RSA" {
			continue
		}

		pubKey, err := parseRSAPublicKey(k.N, k.E)
		if err != nil {
			m.logger.Warn("failed to parse key", slog.String("kid", k.Kid), slog.String("error", err.Error()))
			continue
		}

		m.keyCache.keys[k.Kid] = pubKey
	}

	m.keyCache.lastFetch = time.Now()
	return nil
}

// parseRSAPublicKey parses RSA public key components from JWK format.
func parseRSAPublicKey(nStr, eStr string) (*rsa.PublicKey, error) {
	// Decode base64url-encoded values
	nBytes, err := base64URLDecode(nStr)
	if err != nil {
		return nil, fmt.Errorf("decode n: %w", err)
	}

	eBytes, err := base64URLDecode(eStr)
	if err != nil {
		return nil, fmt.Errorf("decode e: %w", err)
	}

	// Convert exponent bytes to int
	var e int
	for _, b := range eBytes {
		e = e<<8 + int(b)
	}

	// Use math/big for the modulus
	n := new(big.Int).SetBytes(nBytes)

	return &rsa.PublicKey{
		N: n,
		E: e,
	}, nil
}

// InjectServiceToken adds Cloudflare Access service token headers to outbound requests.
func (m *AuthMiddleware) InjectServiceToken(req *http.Request) {
	if m.config.ServiceClientID != "" && m.config.ServiceClientSecret != "" {
		req.Header.Set("CF-Access-Client-Id", m.config.ServiceClientID)
		req.Header.Set("CF-Access-Client-Secret", m.config.ServiceClientSecret)
	}
}

// GetUserFromContext retrieves user info from request context.
func GetUserFromContext(ctx context.Context) *UserInfo {
	user, _ := ctx.Value(UserContextKey).(*UserInfo)
	return user
}

// ValidateWebSocketToken validates a token from a WebSocket connection.
// This is used for WebSocket auth since headers can't be set after upgrade.
// Token can come from query string (?token=xxx) or CF-Access-JWT-Assertion header.
func (m *AuthMiddleware) ValidateWebSocketToken(r *http.Request) (*UserInfo, error) {
	if !m.config.Enabled {
		// Auth disabled - return anonymous user
		return &UserInfo{Email: "anonymous", Type: "anonymous"}, nil
	}

	// Try query string first (for browser WebSocket connections)
	token := r.URL.Query().Get("token")
	if token == "" {
		token = r.URL.Query().Get("cf_token")
	}

	// Fall back to header (for programmatic WebSocket connections)
	if token == "" {
		token = r.Header.Get("CF-Access-JWT-Assertion")
	}
	if token == "" {
		auth := r.Header.Get("Authorization")
		if strings.HasPrefix(auth, "Bearer ") {
			token = strings.TrimPrefix(auth, "Bearer ")
		}
	}

	if token == "" {
		return nil, errors.New("authentication required: provide token via query param or CF-Access-JWT-Assertion header")
	}

	claims, err := m.validateToken(r.Context(), token)
	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	userInfo := &UserInfo{
		Email:  claims.Email,
		Type:   claims.Type,
		Groups: claims.Identity.Groups,
	}
	if userInfo.Email == "" {
		userInfo.Email = claims.Identity.Email
	}

	return userInfo, nil
}

// IsEnabled returns whether authentication is enabled.
func (m *AuthMiddleware) IsEnabled() bool {
	return m.config.Enabled
}
