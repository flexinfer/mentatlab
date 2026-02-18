// Package traces provides HTTP handlers for querying distributed traces via Tempo.
package traces

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/mux"
)

// Handler proxies trace queries to Grafana Tempo's HTTP API.
type Handler struct {
	tempoURL       string
	orchestratorURL string
	client         *http.Client
	logger         *slog.Logger
}

// NewHandler creates a new trace query handler.
// tempoURL is the base URL of the Tempo HTTP API (e.g. "http://tempo:3200").
// orchestratorURL is the base URL of the orchestrator (e.g. "http://orchestrator:7070").
func NewHandler(tempoURL, orchestratorURL string, logger *slog.Logger) *Handler {
	return &Handler{
		tempoURL:       tempoURL,
		orchestratorURL: orchestratorURL,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		logger: logger,
	}
}

// RegisterRoutes registers trace query routes on the given router.
// Routes are only registered if a Tempo URL is configured.
func (h *Handler) RegisterRoutes(r *mux.Router) {
	r.HandleFunc("/api/v1/traces/{traceID}", h.GetTrace).Methods("GET")
	r.HandleFunc("/api/v1/traces", h.QueryTraces).Methods("GET")
}

// GetTrace handles GET /api/v1/traces/{traceID}
// Proxies the request to Tempo's trace API.
func (h *Handler) GetTrace(w http.ResponseWriter, r *http.Request) {
	traceID := mux.Vars(r)["traceID"]
	if traceID == "" {
		respondError(w, http.StatusBadRequest, "traceID is required")
		return
	}

	tempoReq, err := http.NewRequestWithContext(r.Context(), "GET",
		fmt.Sprintf("%s/api/traces/%s", h.tempoURL, traceID), nil)
	if err != nil {
		h.logger.Error("failed to create tempo request", slog.Any("error", err))
		respondError(w, http.StatusInternalServerError, "internal error")
		return
	}

	resp, err := h.client.Do(tempoReq)
	if err != nil {
		h.logger.Error("tempo request failed",
			slog.String("trace_id", traceID),
			slog.Any("error", err),
		)
		respondError(w, http.StatusBadGateway, "trace backend unavailable")
		return
	}
	defer resp.Body.Close()

	// Forward status code and body from Tempo
	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// QueryTraces handles GET /api/v1/traces?run_id={runID}
// Looks up the trace_id from the run's metadata, then fetches the trace from Tempo.
func (h *Handler) QueryTraces(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("run_id")
	if runID == "" {
		respondError(w, http.StatusBadRequest, "run_id query parameter is required")
		return
	}

	// Look up trace_id from orchestrator
	traceID, err := h.lookupTraceID(r, runID)
	if err != nil {
		h.logger.Error("failed to look up trace_id",
			slog.String("run_id", runID),
			slog.Any("error", err),
		)
		respondError(w, http.StatusBadGateway, "failed to look up run")
		return
	}

	if traceID == "" {
		respondError(w, http.StatusNotFound, "no trace_id found for run")
		return
	}

	// Fetch trace from Tempo
	tempoReq, err := http.NewRequestWithContext(r.Context(), "GET",
		fmt.Sprintf("%s/api/traces/%s", h.tempoURL, traceID), nil)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "internal error")
		return
	}

	resp, err := h.client.Do(tempoReq)
	if err != nil {
		h.logger.Error("tempo request failed",
			slog.String("trace_id", traceID),
			slog.Any("error", err),
		)
		respondError(w, http.StatusBadGateway, "trace backend unavailable")
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// lookupTraceID fetches the run from the orchestrator and extracts its trace_id.
func (h *Handler) lookupTraceID(r *http.Request, runID string) (string, error) {
	req, err := http.NewRequestWithContext(r.Context(), "GET",
		fmt.Sprintf("%s/api/v1/runs/%s", h.orchestratorURL, runID), nil)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}

	// Forward auth headers from the original request
	if auth := r.Header.Get("Authorization"); auth != "" {
		req.Header.Set("Authorization", auth)
	}
	if email := r.Header.Get("X-User-Email"); email != "" {
		req.Header.Set("X-User-Email", email)
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("orchestrator request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("orchestrator returned %d", resp.StatusCode)
	}

	var run struct {
		TraceID string `json:"trace_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&run); err != nil {
		return "", fmt.Errorf("decode response: %w", err)
	}

	return run.TraceID, nil
}

func respondError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
