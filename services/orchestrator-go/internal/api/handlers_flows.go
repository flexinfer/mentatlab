package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
)

// --- Flow Management ---

// CreateFlow handles POST /api/v1/flows
func (h *Handlers) CreateFlow(w http.ResponseWriter, r *http.Request) {
	ctx, span := apiTracer.Start(r.Context(), "api.CreateFlow")
	defer span.End()

	if h.flowStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "flow store not available", errors.New("flow store not configured"))
		return
	}

	var req flowstore.CreateFlowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}
	if err := validateFlowGraph(req.Graph); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid flow graph", err)
		return
	}

	// Set CreatedBy from authenticated user if not already provided
	if req.CreatedBy == "" {
		req.CreatedBy = getOwnerFromRequest(r)
	}

	flow, err := h.flowStore.Create(ctx, &req)
	if err != nil {
		if errors.Is(err, flowstore.ErrFlowExists) {
			h.respondError(w, r, http.StatusConflict, "flow already exists", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to create flow", err)
		return
	}

	h.logger.Info("flow created", slog.String("id", flow.ID), slog.String("name", flow.Name))
	h.respondJSON(w, http.StatusCreated, flow)
}

// GetFlow handles GET /api/v1/flows/{id}
func (h *Handlers) GetFlow(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	flowID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.GetFlow",
		trace.WithAttributes(attribute.String("flow_id", flowID)),
	)
	defer span.End()

	if h.flowStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "flow store not available", errors.New("flow store not configured"))
		return
	}

	flow, err := h.flowStore.Get(ctx, flowID)
	if err != nil {
		if errors.Is(err, flowstore.ErrFlowNotFound) {
			h.respondError(w, r, http.StatusNotFound, "flow not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to get flow", err)
		return
	}

	h.respondJSON(w, http.StatusOK, flow)
}

// UpdateFlow handles PUT /api/v1/flows/{id}
func (h *Handlers) UpdateFlow(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	flowID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.UpdateFlow",
		trace.WithAttributes(attribute.String("flow_id", flowID)),
	)
	defer span.End()

	if h.flowStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "flow store not available", errors.New("flow store not configured"))
		return
	}

	var req flowstore.UpdateFlowRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}
	if len(req.Graph) > 0 {
		if err := validateFlowGraph(req.Graph); err != nil {
			h.respondError(w, r, http.StatusBadRequest, "invalid flow graph", err)
			return
		}
	}

	flow, err := h.flowStore.Update(ctx, flowID, &req)
	if err != nil {
		if errors.Is(err, flowstore.ErrFlowNotFound) {
			h.respondError(w, r, http.StatusNotFound, "flow not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to update flow", err)
		return
	}

	h.logger.Info("flow updated", slog.String("id", flow.ID))
	h.respondJSON(w, http.StatusOK, flow)
}

// DeleteFlow handles DELETE /api/v1/flows/{id}
func (h *Handlers) DeleteFlow(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	flowID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.DeleteFlow",
		trace.WithAttributes(attribute.String("flow_id", flowID)),
	)
	defer span.End()

	if h.flowStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "flow store not available", errors.New("flow store not configured"))
		return
	}

	if err := h.flowStore.Delete(ctx, flowID); err != nil {
		if errors.Is(err, flowstore.ErrFlowNotFound) {
			h.respondError(w, r, http.StatusNotFound, "flow not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to delete flow", err)
		return
	}

	h.logger.Info("flow deleted", slog.String("id", flowID))
	w.WriteHeader(http.StatusNoContent)
}

// ListFlows handles GET /api/v1/flows
func (h *Handlers) ListFlows(w http.ResponseWriter, r *http.Request) {
	ctx, span := apiTracer.Start(r.Context(), "api.ListFlows")
	defer span.End()

	if h.flowStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "flow store not available", errors.New("flow store not configured"))
		return
	}

	// Parse query parameters
	opts := &flowstore.ListOptions{}

	if limit := r.URL.Query().Get("limit"); limit != "" {
		if l, err := strconv.Atoi(limit); err == nil && l > 0 {
			opts.Limit = l
			if opts.Limit > 500 {
				opts.Limit = 500
			}
		}
	}
	if offset := r.URL.Query().Get("offset"); offset != "" {
		if o, err := strconv.Atoi(offset); err == nil && o >= 0 {
			opts.Offset = o
		}
	}
	if createdBy := r.URL.Query().Get("created_by"); createdBy != "" {
		opts.CreatedBy = createdBy
	}
	if cursor := r.URL.Query().Get("cursor"); cursor != "" {
		opts.Cursor = cursor
	}

	flows, err := h.flowStore.List(ctx, opts)
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to list flows", err)
		return
	}

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"flows": flows,
		"count": len(flows),
	})
}
