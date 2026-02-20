package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewTracingMiddleware(t *testing.T) {
	t.Run("nil config defaults to disabled", func(t *testing.T) {
		tm := NewTracingMiddleware(nil)
		if tm == nil {
			t.Fatal("expected non-nil middleware")
		}
		if tm.enabled {
			t.Error("expected disabled by default")
		}
	})

	t.Run("enabled config", func(t *testing.T) {
		tm := NewTracingMiddleware(&TracingConfig{Enabled: true})
		if !tm.enabled {
			t.Error("expected enabled")
		}
	})

	t.Run("disabled config", func(t *testing.T) {
		tm := NewTracingMiddleware(&TracingConfig{Enabled: false})
		if tm.enabled {
			t.Error("expected disabled")
		}
	})
}

func TestTracingMiddlewareDisabled(t *testing.T) {
	tm := NewTracingMiddleware(&TracingConfig{Enabled: false})

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	handler := tm.Middleware(inner)

	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	if rr.Body.String() != "ok" {
		t.Errorf("expected 'ok', got %q", rr.Body.String())
	}
}

func TestTracingMiddlewareEnabled(t *testing.T) {
	tm := NewTracingMiddleware(&TracingConfig{Enabled: true})

	called := false
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	handler := tm.Middleware(inner)

	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if !called {
		t.Error("inner handler should have been called")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}
