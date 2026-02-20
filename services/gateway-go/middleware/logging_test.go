package middleware

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// bufferedLogger returns a logger that writes to the provided buffer for assertion.
func bufferedLogger(buf *bytes.Buffer) *slog.Logger {
	return slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug}))
}

func TestNewLoggingMiddleware(t *testing.T) {
	t.Run("nil config", func(t *testing.T) {
		lm := NewLoggingMiddleware(nil, testLogger())
		if lm == nil {
			t.Fatal("expected non-nil middleware")
		}
		if len(lm.skipPaths) != 0 {
			t.Errorf("expected empty skipPaths, got %d", len(lm.skipPaths))
		}
	})

	t.Run("nil logger uses default", func(t *testing.T) {
		lm := NewLoggingMiddleware(nil, nil)
		if lm == nil {
			t.Fatal("expected non-nil middleware")
		}
	})

	t.Run("skip paths stored", func(t *testing.T) {
		lm := NewLoggingMiddleware(&LoggingConfig{
			SkipPaths: []string{"/health", "/healthz"},
		}, testLogger())
		if len(lm.skipPaths) != 2 {
			t.Errorf("expected 2 skip paths, got %d", len(lm.skipPaths))
		}
		if !lm.skipPaths["/health"] {
			t.Error("/health should be in skipPaths")
		}
	})
}

func TestLoggingMiddlewareRequestID(t *testing.T) {
	t.Run("generates request ID when absent", func(t *testing.T) {
		lm := NewLoggingMiddleware(nil, testLogger())

		var capturedReqID string
		handler := lm.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			capturedReqID = r.Header.Get("X-Request-ID")
			w.WriteHeader(http.StatusOK)
		}))

		req := httptest.NewRequest("GET", "/api/test", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		// Should have generated a UUID request ID
		if capturedReqID == "" {
			t.Error("expected request ID to be generated")
		}
		// UUID format: 8-4-4-4-12 = 36 chars
		if len(capturedReqID) != 36 {
			t.Errorf("expected UUID format (36 chars), got %d chars: %q", len(capturedReqID), capturedReqID)
		}

		// Response header should also have it
		responseID := rr.Header().Get("X-Request-ID")
		if responseID != capturedReqID {
			t.Errorf("response X-Request-ID %q doesn't match request %q", responseID, capturedReqID)
		}
	})

	t.Run("preserves existing request ID", func(t *testing.T) {
		lm := NewLoggingMiddleware(nil, testLogger())

		var capturedReqID string
		handler := lm.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			capturedReqID = r.Header.Get("X-Request-ID")
			w.WriteHeader(http.StatusOK)
		}))

		req := httptest.NewRequest("GET", "/api/test", nil)
		req.Header.Set("X-Request-ID", "existing-id-789")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if capturedReqID != "existing-id-789" {
			t.Errorf("expected preserved request ID 'existing-id-789', got %q", capturedReqID)
		}
		if rr.Header().Get("X-Request-ID") != "existing-id-789" {
			t.Errorf("response header should have preserved ID")
		}
	})
}

func TestLoggingMiddlewareStatusCapture(t *testing.T) {
	lm := NewLoggingMiddleware(nil, testLogger())

	handler := lm.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("created"))
	}))

	req := httptest.NewRequest("POST", "/api/v1/runs", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d", rr.Code)
	}
}

func TestLoggingMiddlewareSkipPaths(t *testing.T) {
	t.Run("exact path match", func(t *testing.T) {
		var buf bytes.Buffer
		lm := NewLoggingMiddleware(&LoggingConfig{
			SkipPaths: []string{"/health"},
		}, bufferedLogger(&buf))

		handler := lm.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))

		req := httptest.NewRequest("GET", "/health", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if strings.Contains(buf.String(), "request") {
			t.Error("skipped path should not be logged")
		}
	})

	t.Run("prefix match", func(t *testing.T) {
		var buf bytes.Buffer
		lm := NewLoggingMiddleware(&LoggingConfig{
			SkipPaths: []string{"/health"},
		}, bufferedLogger(&buf))

		handler := lm.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))

		req := httptest.NewRequest("GET", "/healthz", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if strings.Contains(buf.String(), "request") {
			t.Error("prefix-matched path should not be logged")
		}
	})

	t.Run("non-skipped path is logged", func(t *testing.T) {
		var buf bytes.Buffer
		lm := NewLoggingMiddleware(&LoggingConfig{
			SkipPaths: []string{"/health"},
		}, bufferedLogger(&buf))

		handler := lm.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))

		req := httptest.NewRequest("GET", "/api/v1/runs", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)

		if !strings.Contains(buf.String(), "request") {
			t.Error("non-skipped path should be logged")
		}
		if !strings.Contains(buf.String(), "/api/v1/runs") {
			t.Error("log should contain request path")
		}
	})
}

func TestLoggingMiddlewareLogContent(t *testing.T) {
	var buf bytes.Buffer
	lm := NewLoggingMiddleware(nil, bufferedLogger(&buf))

	handler := lm.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("POST", "/api/v1/flows", nil)
	req.Header.Set("X-Request-ID", "log-test-id")
	req.Header.Set("User-Agent", "test-agent/1.0")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	logOutput := buf.String()

	checks := []string{
		"request_id=log-test-id",
		"method=POST",
		"path=/api/v1/flows",
		"status=200",
	}
	for _, check := range checks {
		if !strings.Contains(logOutput, check) {
			t.Errorf("log output should contain %q, got: %s", check, logOutput)
		}
	}
}

func TestNormalizePath(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"/api/v1/runs", "/api/v1/runs"},
		{"/api/v1/runs/550e8400-e29b-41d4-a716-446655440000", "/api/v1/runs/{id}"},
		{"/api/v1/runs/12345", "/api/v1/runs/{id}"},
		{"/api/v1/agents/abc-not-uuid/status", "/api/v1/agents/abc-not-uuid/status"},
		{"/health", "/health"},
		{"/api/v1/runs/550e8400-e29b-41d4-a716-446655440000/nodes/42", "/api/v1/runs/{id}/nodes/{id}"},
	}

	for _, tt := range tests {
		got := normalizePath(tt.input)
		if got != tt.expected {
			t.Errorf("normalizePath(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestResponseWriter(t *testing.T) {
	t.Run("captures status code", func(t *testing.T) {
		inner := httptest.NewRecorder()
		rw := &responseWriter{ResponseWriter: inner, statusCode: http.StatusOK}

		rw.WriteHeader(http.StatusNotFound)

		if rw.statusCode != http.StatusNotFound {
			t.Errorf("expected captured status 404, got %d", rw.statusCode)
		}
		if inner.Code != http.StatusNotFound {
			t.Errorf("expected inner status 404, got %d", inner.Code)
		}
	})

	t.Run("defaults to 200", func(t *testing.T) {
		inner := httptest.NewRecorder()
		rw := &responseWriter{ResponseWriter: inner, statusCode: http.StatusOK}

		if rw.statusCode != http.StatusOK {
			t.Errorf("expected default status 200, got %d", rw.statusCode)
		}
	})
}
