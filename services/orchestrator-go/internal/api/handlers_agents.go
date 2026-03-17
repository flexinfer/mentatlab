package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// --- Agent Scheduling ---

// ScheduleAgent handles POST /api/v1/agents/schedule
func (h *Handlers) ScheduleAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req types.AgentScheduleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}

	// Extract agent ID and image from manifest
	agentID := "unknown"
	if id, ok := req.AgentManifest["id"].(string); ok {
		agentID = id
	}
	image := ""
	if img, ok := req.AgentManifest["image"].(string); ok {
		image = img
	}

	// Build command from manifest
	var command []string
	if cmd, ok := req.AgentManifest["command"].([]interface{}); ok {
		for _, c := range cmd {
			if s, ok := c.(string); ok {
				command = append(command, s)
			}
		}
	}

	// Build environment from manifest
	env := make(map[string]string)
	if envList, ok := req.AgentManifest["env"].([]interface{}); ok {
		for _, e := range envList {
			if eMap, ok := e.(map[string]interface{}); ok {
				if name, ok := eMap["name"].(string); ok {
					if val, ok := eMap["value"].(string); ok {
						env[name] = val
					}
				}
			}
		}
	}

	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:           "main",
				Type:         "agent",
				AgentID:      agentID,
				Image:        image,
				Command:      command,
				Env:          env,
				Capabilities: parseManifestCapabilities(req.AgentManifest),
				Resources:    parseManifestResources(req.AgentManifest),
			},
		},
	}
	if plan.Nodes[0].Resources != nil && plan.Nodes[0].Resources.TimeoutSeconds > 0 {
		plan.Nodes[0].Timeout = time.Duration(plan.Nodes[0].Resources.TimeoutSeconds) * time.Second
	}

	runID, err := h.store.CreateRun(ctx, agentID, plan, getOwnerFromRequest(r))
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to schedule agent", err)
		return
	}

	resp := types.AgentScheduleResponse{
		ResourceID: runID,
		Status:     "scheduled",
		StreamID:   runID,
		SSEURL:     "/api/v1/runs/" + runID + "/events",
	}

	// If scheduler is available, start the run immediately
	if h.scheduler != nil {
		if err := h.scheduler.EnqueueRun(ctx, runID, agentID, plan); err != nil {
			h.logger.Error("failed to enqueue agent run", "error", err, "runId", runID)
		} else if err := h.scheduler.StartRun(ctx, runID); err != nil {
			h.logger.Error("failed to start agent run", "error", err, "runId", runID)
		} else {
			resp.Status = "running"
		}
	}

	h.respondJSON(w, http.StatusAccepted, resp)
}

// ValidateManifest handles POST /api/v1/agents/validate
func (h *Handlers) ValidateManifest(w http.ResponseWriter, r *http.Request) {
	var manifest map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&manifest); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}

	// Use validator if available
	if h.validator != nil {
		result := h.validator.ValidateManifest(manifest)
		h.respondJSON(w, http.StatusOK, result)
		return
	}

	// Fallback: basic validation
	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"valid":  true,
		"errors": []string{},
	})
}

// ListAgents handles GET /api/v1/agents
func (h *Handlers) ListAgents(w http.ResponseWriter, r *http.Request) {
	ctx, span := apiTracer.Start(r.Context(), "api.ListAgents")
	defer span.End()

	// Parse query parameters for filtering
	opts := &registry.ListOptions{}

	if caps := r.URL.Query().Get("capabilities"); caps != "" {
		opts.Capabilities = strings.Split(caps, ",")
	}
	if limit := r.URL.Query().Get("limit"); limit != "" {
		if l, err := strconv.Atoi(limit); err == nil {
			opts.Limit = l
		}
	}
	if offset := r.URL.Query().Get("offset"); offset != "" {
		if o, err := strconv.Atoi(offset); err == nil {
			opts.Offset = o
		}
	}

	// Use registry if available
	if h.registry != nil {
		agents, err := h.registry.List(ctx, opts)
		if err != nil {
			h.respondError(w, r, http.StatusInternalServerError, "failed to list agents", err)
			return
		}
		h.respondJSON(w, http.StatusOK, map[string]interface{}{
			"agents": agents,
			"count":  len(agents),
		})
		return
	}

	// Fallback: hardcoded list for backwards compatibility
	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"agents": []map[string]string{
			{"id": "mentatlab.echo", "name": "Echo Agent"},
			{"id": "mentatlab.psyche-sim", "name": "Psyche Simulation"},
			{"id": "mentatlab.ctm-cogpack", "name": "CTM CogPack"},
		},
		"count": 3,
	})
}

// CreateAgent handles POST /api/v1/agents
func (h *Handlers) CreateAgent(w http.ResponseWriter, r *http.Request) {
	ctx, span := apiTracer.Start(r.Context(), "api.CreateAgent")
	defer span.End()

	if h.registry == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "agent registry not available", errors.New("registry not configured"))
		return
	}

	var req registry.CreateAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}

	agent, err := h.registry.Create(ctx, &req)
	if err != nil {
		if errors.Is(err, registry.ErrAgentExists) {
			h.respondError(w, r, http.StatusConflict, "agent already exists", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to create agent", err)
		return
	}

	h.logger.Info("agent created", slog.String("id", agent.ID), slog.String("name", agent.Name))
	h.respondJSON(w, http.StatusCreated, agent)
}

// GetAgent handles GET /api/v1/agents/{id}
func (h *Handlers) GetAgent(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	agentID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.GetAgent",
		trace.WithAttributes(attribute.String("agent_id", agentID)),
	)
	defer span.End()

	if h.registry == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "agent registry not available", errors.New("registry not configured"))
		return
	}

	agent, err := h.registry.Get(ctx, agentID)
	if err != nil {
		if errors.Is(err, registry.ErrAgentNotFound) {
			h.respondError(w, r, http.StatusNotFound, "agent not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to get agent", err)
		return
	}

	h.respondJSON(w, http.StatusOK, agent)
}

// UpdateAgent handles PUT /api/v1/agents/{id}
func (h *Handlers) UpdateAgent(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	agentID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.UpdateAgent",
		trace.WithAttributes(attribute.String("agent_id", agentID)),
	)
	defer span.End()

	if h.registry == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "agent registry not available", errors.New("registry not configured"))
		return
	}

	var req registry.UpdateAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}

	agent, err := h.registry.Update(ctx, agentID, &req)
	if err != nil {
		if errors.Is(err, registry.ErrAgentNotFound) {
			h.respondError(w, r, http.StatusNotFound, "agent not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to update agent", err)
		return
	}

	h.logger.Info("agent updated", slog.String("id", agent.ID))
	h.respondJSON(w, http.StatusOK, agent)
}

// DeleteAgent handles DELETE /api/v1/agents/{id}
func (h *Handlers) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	agentID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.DeleteAgent",
		trace.WithAttributes(attribute.String("agent_id", agentID)),
	)
	defer span.End()

	if h.registry == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "agent registry not available", errors.New("registry not configured"))
		return
	}

	if err := h.registry.Delete(ctx, agentID); err != nil {
		if errors.Is(err, registry.ErrAgentNotFound) {
			h.respondError(w, r, http.StatusNotFound, "agent not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to delete agent", err)
		return
	}

	h.logger.Info("agent deleted", slog.String("id", agentID))
	w.WriteHeader(http.StatusNoContent)
}

// ReloadAgent handles POST /api/v1/agents/{id}/reload
// Re-reads the agent configuration and bumps UpdatedAt to signal a hot reload.
func (h *Handlers) ReloadAgent(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	agentID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.ReloadAgent",
		trace.WithAttributes(attribute.String("agent_id", agentID)),
	)
	defer span.End()

	if h.registry == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "agent registry not available", errors.New("registry not configured"))
		return
	}

	// Verify the agent exists
	agent, err := h.registry.Get(ctx, agentID)
	if err != nil {
		if errors.Is(err, registry.ErrAgentNotFound) {
			h.respondError(w, r, http.StatusNotFound, "agent not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to get agent", err)
		return
	}

	// Perform reload by touching the agent record (bumps UpdatedAt)
	reloaded, err := h.registry.Update(ctx, agentID, &registry.UpdateAgentRequest{
		Version: &agent.Version,
	})
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to reload agent", err)
		return
	}

	h.logger.Info("agent reloaded", slog.String("id", agentID))
	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"agent":    reloaded,
		"reloaded": true,
	})
}
