package traces

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestNewHandler(t *testing.T) {
	h := NewHandler("http://tempo:3200", "http://orchestrator:7070", silentLogger())
	if h == nil {
		t.Fatal("expected non-nil handler")
	}
	if h.tempoURL != "http://tempo:3200" {
		t.Errorf("expected tempoURL 'http://tempo:3200', got %q", h.tempoURL)
	}
	if h.orchestratorURL != "http://orchestrator:7070" {
		t.Errorf("expected orchestratorURL 'http://orchestrator:7070', got %q", h.orchestratorURL)
	}
	if h.client == nil {
		t.Error("expected non-nil HTTP client")
	}
}

func TestRegisterRoutes(t *testing.T) {
	h := NewHandler("http://tempo:3200", "http://orchestrator:7070", silentLogger())
	r := mux.NewRouter()
	h.RegisterRoutes(r)

	tests := []struct {
		method string
		path   string
		match  bool
	}{
		{"GET", "/api/v1/traces/abc123", true},
		{"GET", "/api/v1/traces", true},
		{"POST", "/api/v1/traces", false},
	}

	for _, tt := range tests {
		req := httptest.NewRequest(tt.method, tt.path, nil)
		var match mux.RouteMatch
		matched := r.Match(req, &match)
		if matched != tt.match {
			t.Errorf("%s %s: expected match=%v, got %v", tt.method, tt.path, tt.match, matched)
		}
	}
}

func TestGetTrace(t *testing.T) {
	t.Run("successful proxy to Tempo", func(t *testing.T) {
		tempoServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/traces/abc123" {
				t.Errorf("unexpected Tempo path: %s", r.URL.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			if _, err := w.Write([]byte(`{"traceID":"abc123","spans":[]}`)); err != nil {
				t.Errorf("write error: %v", err)
			}
		}))
		defer tempoServer.Close()

		h := NewHandler(tempoServer.URL, "http://orchestrator:7070", silentLogger())

		r := mux.NewRouter()
		r.HandleFunc("/api/v1/traces/{traceID}", h.GetTrace).Methods("GET")

		req := httptest.NewRequest("GET", "/api/v1/traces/abc123", nil)
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
		if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected Content-Type application/json, got %q", ct)
		}

		body := rr.Body.String()
		if body != `{"traceID":"abc123","spans":[]}` {
			t.Errorf("unexpected body: %s", body)
		}
	})

	t.Run("Tempo unavailable returns 502", func(t *testing.T) {
		h := NewHandler("http://127.0.0.1:1", "http://orchestrator:7070", silentLogger())

		r := mux.NewRouter()
		r.HandleFunc("/api/v1/traces/{traceID}", h.GetTrace).Methods("GET")

		req := httptest.NewRequest("GET", "/api/v1/traces/abc123", nil)
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)

		if rr.Code != http.StatusBadGateway {
			t.Errorf("expected 502, got %d", rr.Code)
		}

		var errResp map[string]string
		if err := json.NewDecoder(rr.Body).Decode(&errResp); err != nil {
			t.Fatalf("failed to decode error response: %v", err)
		}
		if errResp["error"] != "trace backend unavailable" {
			t.Errorf("unexpected error message: %q", errResp["error"])
		}
	})

	t.Run("Tempo returns non-200", func(t *testing.T) {
		tempoServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
			if _, err := w.Write([]byte(`{"error":"trace not found"}`)); err != nil {
				t.Errorf("write error: %v", err)
			}
		}))
		defer tempoServer.Close()

		h := NewHandler(tempoServer.URL, "http://orchestrator:7070", silentLogger())

		r := mux.NewRouter()
		r.HandleFunc("/api/v1/traces/{traceID}", h.GetTrace).Methods("GET")

		req := httptest.NewRequest("GET", "/api/v1/traces/nonexistent", nil)
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Errorf("expected 404 (forwarded from Tempo), got %d", rr.Code)
		}
	})
}

func TestQueryTraces(t *testing.T) {
	t.Run("missing run_id returns 400", func(t *testing.T) {
		h := NewHandler("http://tempo:3200", "http://orchestrator:7070", silentLogger())

		r := mux.NewRouter()
		r.HandleFunc("/api/v1/traces", h.QueryTraces).Methods("GET")

		req := httptest.NewRequest("GET", "/api/v1/traces", nil)
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rr.Code)
		}

		var errResp map[string]string
		if err := json.NewDecoder(rr.Body).Decode(&errResp); err != nil {
			t.Fatalf("failed to decode error response: %v", err)
		}
		if errResp["error"] != "run_id query parameter is required" {
			t.Errorf("unexpected error: %q", errResp["error"])
		}
	})

	t.Run("orchestrator returns trace_id then fetches from Tempo", func(t *testing.T) {
		orchestratorServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/v1/runs/run-abc" {
				t.Errorf("unexpected orchestrator path: %s", r.URL.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"trace_id": "trace-xyz"})
		}))
		defer orchestratorServer.Close()

		tempoServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/traces/trace-xyz" {
				t.Errorf("unexpected Tempo path: %s", r.URL.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			if _, err := w.Write([]byte(`{"traceID":"trace-xyz","spans":[{"name":"root"}]}`)); err != nil {
				t.Errorf("write error: %v", err)
			}
		}))
		defer tempoServer.Close()

		h := NewHandler(tempoServer.URL, orchestratorServer.URL, silentLogger())

		r := mux.NewRouter()
		r.HandleFunc("/api/v1/traces", h.QueryTraces).Methods("GET")

		req := httptest.NewRequest("GET", "/api/v1/traces?run_id=run-abc", nil)
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
	})

	t.Run("orchestrator returns empty trace_id gives 404", func(t *testing.T) {
		orchestratorServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"trace_id": ""})
		}))
		defer orchestratorServer.Close()

		h := NewHandler("http://tempo:3200", orchestratorServer.URL, silentLogger())

		r := mux.NewRouter()
		r.HandleFunc("/api/v1/traces", h.QueryTraces).Methods("GET")

		req := httptest.NewRequest("GET", "/api/v1/traces?run_id=run-no-trace", nil)
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Errorf("expected 404, got %d", rr.Code)
		}
	})

	t.Run("orchestrator unreachable returns 502", func(t *testing.T) {
		h := NewHandler("http://tempo:3200", "http://127.0.0.1:1", silentLogger())

		r := mux.NewRouter()
		r.HandleFunc("/api/v1/traces", h.QueryTraces).Methods("GET")

		req := httptest.NewRequest("GET", "/api/v1/traces?run_id=run-abc", nil)
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)

		if rr.Code != http.StatusBadGateway {
			t.Errorf("expected 502, got %d", rr.Code)
		}
	})

	t.Run("orchestrator returns non-200 gives 502", func(t *testing.T) {
		orchestratorServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer orchestratorServer.Close()

		h := NewHandler("http://tempo:3200", orchestratorServer.URL, silentLogger())

		r := mux.NewRouter()
		r.HandleFunc("/api/v1/traces", h.QueryTraces).Methods("GET")

		req := httptest.NewRequest("GET", "/api/v1/traces?run_id=run-abc", nil)
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)

		if rr.Code != http.StatusBadGateway {
			t.Errorf("expected 502, got %d", rr.Code)
		}
	})
}

func TestLookupTraceIDForwardsHeaders(t *testing.T) {
	var capturedAuth, capturedEmail string

	orchestratorServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuth = r.Header.Get("Authorization")
		capturedEmail = r.Header.Get("X-User-Email")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"trace_id": "trace-abc"})
	}))
	defer orchestratorServer.Close()

	h := NewHandler("http://tempo:3200", orchestratorServer.URL, silentLogger())

	req := httptest.NewRequest("GET", "/api/v1/traces?run_id=run-1", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("X-User-Email", "user@example.com")

	traceID, err := h.lookupTraceID(req, "run-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if traceID != "trace-abc" {
		t.Errorf("expected trace_id 'trace-abc', got %q", traceID)
	}
	if capturedAuth != "Bearer test-token" {
		t.Errorf("expected forwarded Authorization header, got %q", capturedAuth)
	}
	if capturedEmail != "user@example.com" {
		t.Errorf("expected forwarded X-User-Email header, got %q", capturedEmail)
	}
}

func TestRespondError(t *testing.T) {
	rr := httptest.NewRecorder()
	respondError(rr, http.StatusBadRequest, "test error")

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected Content-Type application/json, got %q", ct)
	}

	var errResp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if errResp["error"] != "test error" {
		t.Errorf("expected error 'test error', got %q", errResp["error"])
	}
}
