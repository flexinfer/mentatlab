package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/validator"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// --- Run Management ---

// CreateRunRequest is the request body for creating a run.
type CreateRunRequest struct {
	Name          string      `json:"name"`
	Plan          *types.Plan `json:"plan"`
	AutoStart     bool        `json:"auto_start,omitempty"`      // Start execution immediately
	WebhookURL    string      `json:"webhook_url,omitempty"`     // URL to POST on completion
	WebhookSecret string      `json:"webhook_secret,omitempty"`  // HMAC-SHA256 signing secret
}

// CreateRunResponse is the response body after creating a run.
type CreateRunResponse struct {
	RunID  string `json:"runId"`
	Status string `json:"status"`
	SSEURL string `json:"sse_url,omitempty"`
}

// CreateRun handles POST /api/v1/runs
func (h *Handlers) CreateRun(w http.ResponseWriter, r *http.Request) {
	ctx, span := apiTracer.Start(r.Context(), "api.CreateRun")
	defer span.End()

	var req CreateRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, r,http.StatusBadRequest, "invalid request body", err)
		return
	}

	// Validate plan graph structure (cycles, dangling edges, duplicate IDs)
	if req.Plan != nil {
		if result := validator.ValidatePlanGraph(req.Plan); !result.Valid {
			msgs := make([]string, len(result.Errors))
			for i, e := range result.Errors {
				msgs[i] = e.Message
			}
			h.respondError(w, r, http.StatusBadRequest, strings.Join(msgs, "; "), nil)
			return
		}
	}

	owner := getOwnerFromRequest(r)
	runID, err := h.store.CreateRun(ctx, req.Name, req.Plan, owner)
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to create run", err)
		return
	}

	// Store webhook callback if provided
	if req.WebhookURL != "" {
		if err := h.store.SetRunWebhook(ctx, runID, req.WebhookURL, req.WebhookSecret); err != nil {
			h.logger.Warn("failed to set webhook", "error", err, "runId", runID)
		}
	}

	resp := CreateRunResponse{
		RunID:  runID,
		Status: "created",
	}

	// If auto_start requested and scheduler available, enqueue and start
	if req.AutoStart && h.scheduler != nil && req.Plan != nil {
		if err := h.scheduler.EnqueueRun(ctx, runID, req.Name, req.Plan); err != nil {
			h.logger.Error("failed to enqueue run", "error", err, "runId", runID)
		} else if err := h.scheduler.StartRun(ctx, runID); err != nil {
			h.logger.Error("failed to start run", "error", err, "runId", runID)
		} else {
			resp.Status = "running"
			resp.SSEURL = "/api/v1/runs/" + runID + "/events"
		}
	}

	h.respondJSON(w, http.StatusCreated, resp)
}

// StartRun handles POST /api/v1/runs/{id}/start
func (h *Handlers) StartRun(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	runID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.StartRun",
		trace.WithAttributes(attribute.String("run_id", runID)),
	)
	defer span.End()

	if h.scheduler == nil {
		h.respondError(w, r,http.StatusServiceUnavailable, "scheduler not available", errors.New("scheduler not configured"))
		return
	}

	// Get the run to access its plan
	run, err := h.store.GetRun(ctx, runID)
	if err != nil {
		if errors.Is(err, runstore.ErrRunNotFound) {
			h.respondError(w, r,http.StatusNotFound, "run not found", err)
			return
		}
		h.respondError(w, r,http.StatusInternalServerError, "failed to get run", err)
		return
	}

	// Enqueue and start via scheduler
	if err := h.scheduler.EnqueueRun(ctx, runID, run.Name, run.Plan); err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "failed to enqueue run", err)
		return
	}

	if err := h.scheduler.StartRun(ctx, runID); err != nil {
		h.respondError(w, r,http.StatusInternalServerError, "failed to start run", err)
		return
	}

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"runId":   runID,
		"status":  "running",
		"sse_url": "/api/v1/runs/" + runID + "/events",
	})
}

// ListRuns handles GET /api/v1/runs
// Supports cursor-based pagination (?cursor=&limit=) and legacy offset pagination (?offset=&limit=).
func (h *Handlers) ListRuns(w http.ResponseWriter, r *http.Request) {
	ctx, span := apiTracer.Start(r.Context(), "api.ListRuns")
	defer span.End()

	// Parse pagination parameters
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
			if limit > 500 {
				limit = 500
			}
		}
	}

	cursor := r.URL.Query().Get("cursor")
	ownerFilter := r.URL.Query().Get("owner")

	// If cursor is provided (or no offset), use cursor-based pagination
	if cursor != "" || r.URL.Query().Get("offset") == "" {
		result, err := h.store.ListRunsPaged(ctx, &runstore.PageOptions{
			Cursor: cursor,
			Limit:  limit,
			Owner:  ownerFilter,
		})
		if err != nil {
			h.respondError(w, r, http.StatusInternalServerError, "failed to list runs", err)
			return
		}
		h.respondJSON(w, http.StatusOK, map[string]interface{}{
			"runs":        result.Runs,
			"total":       result.Total,
			"limit":       limit,
			"next_cursor": result.NextCursor,
		})
		return
	}

	// Legacy offset-based pagination
	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	var runIDs []string
	var err error
	if ownerFilter != "" {
		runIDs, err = h.store.ListRunsWithOptions(ctx, &runstore.ListRunsOptions{Owner: ownerFilter})
	} else {
		runIDs, err = h.store.ListRuns(ctx)
	}
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to list runs", err)
		return
	}

	total := len(runIDs)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	paginatedIDs := runIDs[offset:end]

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"runs":   paginatedIDs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// GetRun handles GET /api/v1/runs/{id}
func (h *Handlers) GetRun(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	runID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.GetRun",
		trace.WithAttributes(attribute.String("run_id", runID)),
	)
	defer span.End()

	run, err := h.store.GetRun(ctx, runID)
	if err != nil {
		if errors.Is(err, runstore.ErrRunNotFound) {
			h.respondError(w, r,http.StatusNotFound, "run not found", err)
			return
		}
		h.respondError(w, r,http.StatusInternalServerError, "failed to get run", err)
		return
	}

	h.respondJSON(w, http.StatusOK, run)
}

// DeleteRun handles DELETE /api/v1/runs/{id}
func (h *Handlers) DeleteRun(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	runID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.DeleteRun",
		trace.WithAttributes(attribute.String("run_id", runID)),
	)
	defer span.End()

	if err := h.store.CancelRun(ctx, runID); err != nil {
		if errors.Is(err, runstore.ErrRunNotFound) {
			h.respondError(w, r,http.StatusNotFound, "run not found", err)
			return
		}
		h.respondError(w, r,http.StatusInternalServerError, "failed to delete run", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// CancelRun handles POST /api/v1/runs/{id}/cancel
func (h *Handlers) CancelRun(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	runID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.CancelRun",
		trace.WithAttributes(attribute.String("run_id", runID)),
	)
	defer span.End()

	// Use scheduler if available (it handles both scheduler state and store state)
	if h.scheduler != nil {
		if err := h.scheduler.CancelRun(ctx, runID); err != nil {
			h.logger.Error("scheduler cancel error", "error", err, "runId", runID)
		}
	} else {
		if err := h.store.CancelRun(ctx, runID); err != nil {
			if errors.Is(err, runstore.ErrRunNotFound) {
				h.respondError(w, r,http.StatusNotFound, "run not found", err)
				return
			}
			h.respondError(w, r,http.StatusInternalServerError, "failed to cancel run", err)
			return
		}
	}

	h.respondJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}
