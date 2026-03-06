package api

import (
	"net/http"
	"testing"
	"time"
)

func TestShouldAudit(t *testing.T) {
	tests := []struct {
		method string
		path   string
		want   bool
	}{
		// Mutating operations always audited
		{"POST", "/api/v1/runs", true},
		{"PUT", "/api/v1/agents/abc", true},
		{"DELETE", "/api/v1/flows/xyz", true},

		// Sensitive GET endpoints audited
		{"GET", "/api/v1/apikeys", true},
		{"GET", "/api/v1/runstore/info", true},
		{"GET", "/api/v1/runs/abc/events", true},

		// Regular reads NOT audited
		{"GET", "/api/v1/runs", false},
		{"GET", "/api/v1/agents", false},
		{"GET", "/api/v1/flows/abc", false},
		{"GET", "/api/v1/mcp/tools", false},
	}

	for _, tt := range tests {
		got := shouldAudit(tt.method, tt.path)
		if got != tt.want {
			t.Errorf("shouldAudit(%q, %q) = %v, want %v", tt.method, tt.path, got, tt.want)
		}
	}
}

func TestDetectAuthMethod(t *testing.T) {
	tests := []struct {
		authHeader string
		want       string
	}{
		{"", "none"},
		{"Bearer eyJhbGciOiJSUzI1NiJ9...", "oidc"},
		{"mlk_abc123def456", "apikey"},
		{"Basic dXNlcjpwYXNz", "unknown"},
	}

	for _, tt := range tests {
		r, _ := http.NewRequest("GET", "/", nil)
		if tt.authHeader != "" {
			r.Header.Set("Authorization", tt.authHeader)
		}
		got := detectAuthMethod(r)
		if got != tt.want {
			t.Errorf("detectAuthMethod(auth=%q) = %q, want %q", tt.authHeader, got, tt.want)
		}
	}
}

func TestInferResourceType(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{"/api/v1/runs", "runs"},
		{"/api/v1/runs/abc/start", "runs"},
		{"/api/v1/agents/xyz", "agents"},
		{"/api/v1/flows/123/run", "flows"},
		{"/api/v1/apikeys", "apikeys"},
		{"/api/v1/webhooks/trigger/abc", "webhooks"},
		{"/api/v1/schedules/xyz", "schedules"},
		{"/api/v1/mcp/tools", "mcp"},
		{"/api/v1/runstore/info", "runstore"},
	}

	for _, tt := range tests {
		got := inferResourceType(tt.path)
		if got != tt.want {
			t.Errorf("inferResourceType(%q) = %q, want %q", tt.path, got, tt.want)
		}
	}
}

func TestDurationMs(t *testing.T) {
	tests := []struct {
		dur  time.Duration
		want string
	}{
		{0, "0.0"},
		{1 * time.Millisecond, "1.0"},
		{125 * time.Millisecond, "125.0"},
		{1500 * time.Microsecond, "1.5"},
	}

	for _, tt := range tests {
		got := durationMs(tt.dur)
		if got != tt.want {
			t.Errorf("durationMs(%v) = %q, want %q", tt.dur, got, tt.want)
		}
	}
}
