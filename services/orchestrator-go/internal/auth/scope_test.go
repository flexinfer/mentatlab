package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClaims_HasScope(t *testing.T) {
	cases := []struct {
		name   string
		scopes []string
		want   string
		ok     bool
	}{
		{"exact write", []string{"write"}, ScopeWrite, true},
		{"write implies read", []string{"write"}, ScopeRead, true},
		{"read does not imply write", []string{"read"}, ScopeWrite, false},
		{"wildcard grants write", []string{"*"}, ScopeWrite, true},
		{"admin grants write", []string{"admin"}, ScopeWrite, true},
		{"missing scope", []string{"read"}, ScopeWrite, false},
		{"empty", nil, ScopeRead, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := &Claims{Scopes: tc.scopes}
			if got := c.HasScope(tc.want); got != tc.ok {
				t.Errorf("HasScope(%q) with %v = %v, want %v", tc.want, tc.scopes, got, tc.ok)
			}
		})
	}
}

// helper: run a request with given claims through ScopeEnforcementMiddleware.
func runWithClaims(method string, claims *Claims) int {
	reached := false
	h := ScopeEnforcementMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(method, "/api/v1/runs", nil)
	if claims != nil {
		req = req.WithContext(context.WithValue(req.Context(), claimsContextKey, claims))
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	_ = reached
	return rec.Code
}

func TestScopeEnforcement_WriteRequiresWriteScope(t *testing.T) {
	readOnly := &Claims{AuthMethod: AuthMethodAPIKey, Scopes: []string{ScopeRead}}
	if code := runWithClaims(http.MethodPost, readOnly); code != http.StatusForbidden {
		t.Errorf("read-only key POST = %d, want 403", code)
	}
	if code := runWithClaims(http.MethodDelete, readOnly); code != http.StatusForbidden {
		t.Errorf("read-only key DELETE = %d, want 403", code)
	}
	// read-only key may still GET
	if code := runWithClaims(http.MethodGet, readOnly); code != http.StatusOK {
		t.Errorf("read-only key GET = %d, want 200", code)
	}
}

func TestScopeEnforcement_WriteScopeAllowed(t *testing.T) {
	writer := &Claims{AuthMethod: AuthMethodAPIKey, Scopes: []string{ScopeWrite}}
	if code := runWithClaims(http.MethodPost, writer); code != http.StatusOK {
		t.Errorf("write key POST = %d, want 200", code)
	}
}

func TestScopeEnforcement_LegacyUnscopedKeyUnrestricted(t *testing.T) {
	legacy := &Claims{AuthMethod: AuthMethodAPIKey} // no scopes declared
	if code := runWithClaims(http.MethodPost, legacy); code != http.StatusOK {
		t.Errorf("legacy unscoped key POST = %d, want 200 (backward compat)", code)
	}
}

func TestScopeEnforcement_OIDCAndAnonymousBypass(t *testing.T) {
	oidc := &Claims{AuthMethod: AuthMethodOIDC, Scopes: []string{ScopeRead}}
	if code := runWithClaims(http.MethodPost, oidc); code != http.StatusOK {
		t.Errorf("OIDC user POST = %d, want 200 (scopes are an API-key concept)", code)
	}
	if code := runWithClaims(http.MethodPost, nil); code != http.StatusOK {
		t.Errorf("no-claims (auth disabled) POST = %d, want 200", code)
	}
}
