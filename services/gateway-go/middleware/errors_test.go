package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetRequestID(t *testing.T) {
	t.Run("from context", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), RequestIDKey, "ctx-id-123")
		w := httptest.NewRecorder()

		got := GetRequestID(ctx, w)
		if got != "ctx-id-123" {
			t.Errorf("expected 'ctx-id-123', got %q", got)
		}
	})

	t.Run("from response header", func(t *testing.T) {
		ctx := context.Background()
		w := httptest.NewRecorder()
		w.Header().Set("X-Request-ID", "header-id-456")

		got := GetRequestID(ctx, w)
		if got != "header-id-456" {
			t.Errorf("expected 'header-id-456', got %q", got)
		}
	})

	t.Run("context takes precedence over header", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), RequestIDKey, "from-ctx")
		w := httptest.NewRecorder()
		w.Header().Set("X-Request-ID", "from-header")

		got := GetRequestID(ctx, w)
		if got != "from-ctx" {
			t.Errorf("expected context value 'from-ctx', got %q", got)
		}
	})

	t.Run("empty context falls back to header", func(t *testing.T) {
		ctx := context.WithValue(context.Background(), RequestIDKey, "")
		w := httptest.NewRecorder()
		w.Header().Set("X-Request-ID", "fallback")

		got := GetRequestID(ctx, w)
		if got != "fallback" {
			t.Errorf("expected 'fallback', got %q", got)
		}
	})

	t.Run("no request ID anywhere", func(t *testing.T) {
		ctx := context.Background()
		w := httptest.NewRecorder()

		got := GetRequestID(ctx, w)
		if got != "" {
			t.Errorf("expected empty string, got %q", got)
		}
	})
}

func TestRespondError(t *testing.T) {
	t.Run("writes JSON error response", func(t *testing.T) {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", "/test", nil)

		RespondError(w, r, http.StatusNotFound, ErrCodeNotFound, "resource not found")

		if w.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", w.Code)
		}
		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected Content-Type application/json, got %q", ct)
		}

		var resp ErrorResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp.Error != ErrCodeNotFound {
			t.Errorf("expected error code %q, got %q", ErrCodeNotFound, resp.Error)
		}
		if resp.Message != "resource not found" {
			t.Errorf("expected message 'resource not found', got %q", resp.Message)
		}
		if resp.Details != nil {
			t.Error("expected nil details")
		}
	})

	t.Run("includes request ID from header", func(t *testing.T) {
		w := httptest.NewRecorder()
		w.Header().Set("X-Request-ID", "req-abc")
		r := httptest.NewRequest("GET", "/test", nil)

		RespondError(w, r, http.StatusBadRequest, ErrCodeBadRequest, "bad input")

		var resp ErrorResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if resp.RequestID != "req-abc" {
			t.Errorf("expected request_id 'req-abc', got %q", resp.RequestID)
		}
	})
}

func TestRespondErrorWithDetails(t *testing.T) {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/v1/runs", nil)

	details := map[string]interface{}{
		"field":  "name",
		"reason": "required",
	}

	RespondErrorWithDetails(w, r, http.StatusBadRequest, ErrCodeBadRequest, "validation failed", details)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	var resp ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Error != ErrCodeBadRequest {
		t.Errorf("expected error code %q, got %q", ErrCodeBadRequest, resp.Error)
	}
	if resp.Details["field"] != "name" {
		t.Errorf("expected details field 'name', got %v", resp.Details["field"])
	}
	if resp.Details["reason"] != "required" {
		t.Errorf("expected details reason 'required', got %v", resp.Details["reason"])
	}
}

func TestHTTPStatusToErrorCode(t *testing.T) {
	tests := []struct {
		status   int
		expected string
	}{
		{http.StatusUnauthorized, ErrCodeAuthRequired},
		{http.StatusForbidden, ErrCodeForbidden},
		{http.StatusNotFound, ErrCodeNotFound},
		{http.StatusTooManyRequests, ErrCodeRateLimited},
		{http.StatusBadRequest, ErrCodeBadRequest},
		{http.StatusServiceUnavailable, ErrCodeServiceUnavail},
		{http.StatusInternalServerError, ErrCodeInternalError},
		{http.StatusConflict, ErrCodeInternalError},          // unmapped → default
		{http.StatusGatewayTimeout, ErrCodeInternalError},    // unmapped → default
	}

	for _, tt := range tests {
		got := HTTPStatusToErrorCode(tt.status)
		if got != tt.expected {
			t.Errorf("HTTPStatusToErrorCode(%d) = %q, want %q", tt.status, got, tt.expected)
		}
	}
}
