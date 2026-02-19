package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// --- Claims tests ---

func TestClaims_HasRole(t *testing.T) {
	claims := &Claims{
		Roles: []string{"admin", "viewer"},
	}
	if !claims.HasRole("admin") {
		t.Error("HasRole: expected true for 'admin'")
	}
	if claims.HasRole("editor") {
		t.Error("HasRole: expected false for 'editor'")
	}
}

func TestClaims_HasGroup(t *testing.T) {
	claims := &Claims{
		Groups: []string{"team-a", "team-b"},
	}
	if !claims.HasGroup("team-a") {
		t.Error("HasGroup: expected true for 'team-a'")
	}
	if claims.HasGroup("team-c") {
		t.Error("HasGroup: expected false for 'team-c'")
	}
}

func TestClaims_IsExpired(t *testing.T) {
	past := &Claims{Expiry: time.Now().Add(-1 * time.Hour)}
	if !past.IsExpired() {
		t.Error("IsExpired: expected true for past expiry")
	}

	future := &Claims{Expiry: time.Now().Add(1 * time.Hour)}
	if future.IsExpired() {
		t.Error("IsExpired: expected false for future expiry")
	}

	zero := &Claims{}
	if zero.IsExpired() {
		t.Error("IsExpired: expected false for zero expiry")
	}
}

// --- IsAPIKey tests ---

func TestIsAPIKey(t *testing.T) {
	if !IsAPIKey("mlk_abc123") {
		t.Error("IsAPIKey: expected true for mlk_ prefix")
	}
	if IsAPIKey("Bearer eyJhbGci...") {
		t.Error("IsAPIKey: expected false for Bearer token")
	}
	if IsAPIKey("") {
		t.Error("IsAPIKey: expected false for empty string")
	}
}

// --- GetClaims tests ---

func TestGetClaims_Present(t *testing.T) {
	claims := &Claims{Email: "test@example.com"}
	ctx := context.WithValue(context.Background(), claimsContextKey, claims)
	got := GetClaims(ctx)
	if got == nil || got.Email != "test@example.com" {
		t.Errorf("GetClaims: got %v, want claims with test@example.com", got)
	}
}

func TestGetClaims_Missing(t *testing.T) {
	got := GetClaims(context.Background())
	if got != nil {
		t.Errorf("GetClaims: got %v, want nil", got)
	}
}

// --- Middleware tests ---

func TestMiddleware_PublicPaths(t *testing.T) {
	mw := NewMiddleware(nil, &MiddlewareConfig{
		Enabled:     true,
		PublicPaths: []string{"/metrics"},
	})

	handler := mw.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	for _, path := range []string{"/health", "/healthz", "/ready", "/metrics"} {
		req := httptest.NewRequest("GET", path, nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Errorf("public path %s: got %d, want 200", path, rr.Code)
		}
	}
}

func TestMiddleware_DisabledPassesThrough(t *testing.T) {
	mw := NewMiddleware(nil, &MiddlewareConfig{
		Enabled: false,
	})

	handler := mw.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/v1/runs", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("disabled middleware: got %d, want 200", rr.Code)
	}
}

func TestMiddleware_MissingAuthHeader(t *testing.T) {
	mw := NewMiddleware(&Provider{}, &MiddlewareConfig{
		Enabled: true,
	})

	handler := mw.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/v1/runs", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("missing auth: got %d, want 401", rr.Code)
	}

	var body map[string]string
	json.NewDecoder(rr.Body).Decode(&body)
	if body["error"] != "missing authorization header" {
		t.Errorf("error message: got %q", body["error"])
	}
}

func TestMiddleware_InvalidAuthFormat(t *testing.T) {
	mw := NewMiddleware(&Provider{}, &MiddlewareConfig{
		Enabled: true,
	})

	handler := mw.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/v1/runs", nil)
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("bad auth format: got %d, want 401", rr.Code)
	}
}

// --- RateLimiter tests ---

func TestRateLimiter_AllowsWithinLimit(t *testing.T) {
	rl := NewRateLimiter(100, 10)

	handler := rl.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/v1/runs", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("rate limiter allow: got %d, want 200", rr.Code)
	}
}

func TestRateLimiter_RejectsBeyondBurst(t *testing.T) {
	// Very low rate: 0.001 rps, burst 1
	rl := NewRateLimiter(0.001, 1)

	handler := rl.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// First request uses the single burst token
	req := httptest.NewRequest("GET", "/api/v1/runs", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("first request: got %d, want 200", rr.Code)
	}

	// Second request should be rate limited (no tokens left)
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req)
	if rr2.Code != http.StatusTooManyRequests {
		t.Errorf("second request: got %d, want 429", rr2.Code)
	}
	if rr2.Header().Get("Retry-After") != "1" {
		t.Errorf("Retry-After header: got %q, want %q", rr2.Header().Get("Retry-After"), "1")
	}
}

// --- RequireRole tests ---

func TestRequireRole_WithRole(t *testing.T) {
	claims := &Claims{Roles: []string{"admin"}}
	ctx := context.WithValue(context.Background(), claimsContextKey, claims)

	handler := RequireRole("admin")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/admin", nil).WithContext(ctx)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("with role: got %d, want 200", rr.Code)
	}
}

func TestRequireRole_WithoutRole(t *testing.T) {
	claims := &Claims{Roles: []string{"viewer"}}
	ctx := context.WithValue(context.Background(), claimsContextKey, claims)

	handler := RequireRole("admin")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/admin", nil).WithContext(ctx)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("without role: got %d, want 403", rr.Code)
	}
}

func TestRequireRole_NoClaims(t *testing.T) {
	handler := RequireRole("admin")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/admin", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("no claims: got %d, want 403", rr.Code)
	}
}

// --- RequireGroup tests ---

func TestRequireGroup_WithGroup(t *testing.T) {
	claims := &Claims{Groups: []string{"engineers"}}
	ctx := context.WithValue(context.Background(), claimsContextKey, claims)

	handler := RequireGroup("engineers")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil).WithContext(ctx)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("with group: got %d, want 200", rr.Code)
	}
}

func TestRequireGroup_WithoutGroup(t *testing.T) {
	claims := &Claims{Groups: []string{"marketing"}}
	ctx := context.WithValue(context.Background(), claimsContextKey, claims)

	handler := RequireGroup("engineers")(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil).WithContext(ctx)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("without group: got %d, want 403", rr.Code)
	}
}

// --- getClientIP tests ---

func TestGetClientIP_XForwardedFor(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 5.6.7.8")
	ip := getClientIP(req)
	if ip != "1.2.3.4" {
		t.Errorf("X-Forwarded-For: got %q, want %q", ip, "1.2.3.4")
	}
}

func TestGetClientIP_XRealIP(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Real-IP", "10.0.0.1")
	ip := getClientIP(req)
	if ip != "10.0.0.1" {
		t.Errorf("X-Real-IP: got %q, want %q", ip, "10.0.0.1")
	}
}

func TestGetClientIP_RemoteAddr(t *testing.T) {
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "192.168.1.1:54321"
	ip := getClientIP(req)
	if ip != "192.168.1.1" {
		t.Errorf("RemoteAddr: got %q, want %q", ip, "192.168.1.1")
	}
}

// --- NewProvider validation tests ---

func TestNewProvider_NilConfig(t *testing.T) {
	_, err := NewProvider(context.Background(), nil)
	if err == nil || err.Error() != "config is required" {
		t.Errorf("nil config: got %v, want 'config is required'", err)
	}
}

func TestNewProvider_MissingIssuer(t *testing.T) {
	_, err := NewProvider(context.Background(), &Config{})
	if err == nil || err.Error() != "issuer is required" {
		t.Errorf("missing issuer: got %v, want 'issuer is required'", err)
	}
}

func TestNewProvider_MissingClientID(t *testing.T) {
	_, err := NewProvider(context.Background(), &Config{Issuer: "https://auth.example.com"})
	if err == nil || err.Error() != "client_id is required" {
		t.Errorf("missing client_id: got %v, want 'client_id is required'", err)
	}
}

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
	if len(cfg.Scopes) != 3 {
		t.Errorf("DefaultConfig scopes: got %d, want 3", len(cfg.Scopes))
	}
}
