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

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/k8s"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/scheduler"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/validator"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// Handlers contains all HTTP handlers and their dependencies.
type Handlers struct {
	store     runstore.RunStore
	scheduler *scheduler.Scheduler
	validator *validator.Validator
	registry  registry.AgentRegistry
	k8sClient *k8s.Client
	config    *config.Config
	logger    *slog.Logger
}

// HandlerOptions configures optional handler dependencies.
type HandlerOptions struct {
	Registry  registry.AgentRegistry
	K8sClient *k8s.Client
}

// NewHandlers creates a new Handlers instance.
func NewHandlers(store runstore.RunStore, sched *scheduler.Scheduler, v *validator.Validator, cfg *config.Config, logger *slog.Logger, opts *HandlerOptions) *Handlers {
	if logger == nil {
		logger = slog.Default()
	}
	h := &Handlers{
		store:     store,
		scheduler: sched,
		validator: v,
		config:    cfg,
		logger:    logger,
	}
	if opts != nil {
		h.registry = opts.Registry
		h.k8sClient = opts.K8sClient
	}
	return h
}

// --- Health Endpoints ---

// Health handles the /health and /healthz endpoints.
func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// Ready handles the /ready endpoint, checking dependencies.
func (h *Handlers) Ready(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Check RunStore health
	info, err := h.store.AdapterInfo(ctx)
	if err != nil {
		h.respondError(w, http.StatusServiceUnavailable, "runstore unhealthy", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "ready",
		"runstore": info,
	})
}

// --- Run Management ---

// CreateRunRequest is the request body for creating a run.
type CreateRunRequest struct {
	Name      string      `json:"name"`
	Plan      *types.Plan `json:"plan"`
	AutoStart bool        `json:"auto_start,omitempty"` // Start execution immediately
}

// CreateRunResponse is the response body after creating a run.
type CreateRunResponse struct {
	RunID  string `json:"runId"`
	Status string `json:"status"`
	SSEURL string `json:"sse_url,omitempty"`
}

// CreateRun handles POST /api/v1/runs
func (h *Handlers) CreateRun(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req CreateRunRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "invalid request body", err)
		return
	}

	runID, err := h.store.CreateRun(ctx, req.Name, req.Plan)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "failed to create run", err)
		return
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
	ctx := r.Context()
	vars := mux.Vars(r)
	runID := vars["id"]

	if h.scheduler == nil {
		h.respondError(w, http.StatusServiceUnavailable, "scheduler not available", errors.New("scheduler not configured"))
		return
	}

	// Get the run to access its plan
	run, err := h.store.GetRun(ctx, runID)
	if err != nil {
		if errors.Is(err, runstore.ErrRunNotFound) {
			h.respondError(w, http.StatusNotFound, "run not found", err)
			return
		}
		h.respondError(w, http.StatusInternalServerError, "failed to get run", err)
		return
	}

	// Enqueue and start via scheduler
	if err := h.scheduler.EnqueueRun(ctx, runID, run.Name, run.Plan); err != nil {
		h.respondError(w, http.StatusInternalServerError, "failed to enqueue run", err)
		return
	}

	if err := h.scheduler.StartRun(ctx, runID); err != nil {
		h.respondError(w, http.StatusInternalServerError, "failed to start run", err)
		return
	}

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"runId":  runID,
		"status": "running",
		"sseUrl": "/api/v1/runs/" + runID + "/events",
	})
}

// ListRuns handles GET /api/v1/runs
func (h *Handlers) ListRuns(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Parse pagination parameters
	limit := 50 // Default limit
	offset := 0

	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 {
			limit = parsed
			if limit > 500 { // Cap at 500
				limit = 500
			}
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := strconv.Atoi(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	runIDs, err := h.store.ListRuns(ctx)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "failed to list runs", err)
		return
	}

	// Apply pagination
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
	ctx := r.Context()
	vars := mux.Vars(r)
	runID := vars["id"]

	run, err := h.store.GetRun(ctx, runID)
	if err != nil {
		if errors.Is(err, runstore.ErrRunNotFound) {
			h.respondError(w, http.StatusNotFound, "run not found", err)
			return
		}
		h.respondError(w, http.StatusInternalServerError, "failed to get run", err)
		return
	}

	h.respondJSON(w, http.StatusOK, run)
}

// DeleteRun handles DELETE /api/v1/runs/{id}
func (h *Handlers) DeleteRun(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	runID := vars["id"]

	if err := h.store.CancelRun(ctx, runID); err != nil {
		if errors.Is(err, runstore.ErrRunNotFound) {
			h.respondError(w, http.StatusNotFound, "run not found", err)
			return
		}
		h.respondError(w, http.StatusInternalServerError, "failed to delete run", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// CancelRun handles POST /api/v1/runs/{id}/cancel
func (h *Handlers) CancelRun(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	runID := vars["id"]

	// Use scheduler if available (it handles both scheduler state and store state)
	if h.scheduler != nil {
		if err := h.scheduler.CancelRun(ctx, runID); err != nil {
			h.logger.Error("scheduler cancel error", "error", err, "runId", runID)
		}
	} else {
		if err := h.store.CancelRun(ctx, runID); err != nil {
			if errors.Is(err, runstore.ErrRunNotFound) {
				h.respondError(w, http.StatusNotFound, "run not found", err)
				return
			}
			h.respondError(w, http.StatusInternalServerError, "failed to cancel run", err)
			return
		}
	}

	h.respondJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

// --- Agent Scheduling ---

// ScheduleAgent handles POST /api/v1/agents/schedule
func (h *Handlers) ScheduleAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var req types.AgentScheduleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "invalid request body", err)
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
				ID:      "main",
				Type:    "agent",
				AgentID: agentID,
				Image:   image,
				Command: command,
				Env:     env,
			},
		},
	}

	runID, err := h.store.CreateRun(ctx, agentID, plan)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "failed to schedule agent", err)
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
		h.respondError(w, http.StatusBadRequest, "invalid request body", err)
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
	ctx := r.Context()

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
			h.respondError(w, http.StatusInternalServerError, "failed to list agents", err)
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
	ctx := r.Context()

	if h.registry == nil {
		h.respondError(w, http.StatusServiceUnavailable, "agent registry not available", errors.New("registry not configured"))
		return
	}

	var req registry.CreateAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "invalid request body", err)
		return
	}

	agent, err := h.registry.Create(ctx, &req)
	if err != nil {
		if errors.Is(err, registry.ErrAgentExists) {
			h.respondError(w, http.StatusConflict, "agent already exists", err)
			return
		}
		h.respondError(w, http.StatusInternalServerError, "failed to create agent", err)
		return
	}

	h.logger.Info("agent created", slog.String("id", agent.ID), slog.String("name", agent.Name))
	h.respondJSON(w, http.StatusCreated, agent)
}

// GetAgent handles GET /api/v1/agents/{id}
func (h *Handlers) GetAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	agentID := vars["id"]

	if h.registry == nil {
		h.respondError(w, http.StatusServiceUnavailable, "agent registry not available", errors.New("registry not configured"))
		return
	}

	agent, err := h.registry.Get(ctx, agentID)
	if err != nil {
		if errors.Is(err, registry.ErrAgentNotFound) {
			h.respondError(w, http.StatusNotFound, "agent not found", err)
			return
		}
		h.respondError(w, http.StatusInternalServerError, "failed to get agent", err)
		return
	}

	h.respondJSON(w, http.StatusOK, agent)
}

// UpdateAgent handles PUT /api/v1/agents/{id}
func (h *Handlers) UpdateAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	agentID := vars["id"]

	if h.registry == nil {
		h.respondError(w, http.StatusServiceUnavailable, "agent registry not available", errors.New("registry not configured"))
		return
	}

	var req registry.UpdateAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, http.StatusBadRequest, "invalid request body", err)
		return
	}

	agent, err := h.registry.Update(ctx, agentID, &req)
	if err != nil {
		if errors.Is(err, registry.ErrAgentNotFound) {
			h.respondError(w, http.StatusNotFound, "agent not found", err)
			return
		}
		h.respondError(w, http.StatusInternalServerError, "failed to update agent", err)
		return
	}

	h.logger.Info("agent updated", slog.String("id", agent.ID))
	h.respondJSON(w, http.StatusOK, agent)
}

// DeleteAgent handles DELETE /api/v1/agents/{id}
func (h *Handlers) DeleteAgent(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	agentID := vars["id"]

	if h.registry == nil {
		h.respondError(w, http.StatusServiceUnavailable, "agent registry not available", errors.New("registry not configured"))
		return
	}

	if err := h.registry.Delete(ctx, agentID); err != nil {
		if errors.Is(err, registry.ErrAgentNotFound) {
			h.respondError(w, http.StatusNotFound, "agent not found", err)
			return
		}
		h.respondError(w, http.StatusInternalServerError, "failed to delete agent", err)
		return
	}

	h.logger.Info("agent deleted", slog.String("id", agentID))
	w.WriteHeader(http.StatusNoContent)
}

// --- Job Management ---

// GetJobStatus handles GET /api/v1/jobs/{id}/status
func (h *Handlers) GetJobStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	jobID := vars["id"]

	if h.k8sClient == nil {
		// No K8s client - return unknown status
		h.respondJSON(w, http.StatusOK, map[string]interface{}{
			"job_id": jobID,
			"status": "unknown",
			"error":  "k8s client not configured",
		})
		return
	}

	job, err := h.k8sClient.GetJob(ctx, jobID)
	if err != nil {
		h.respondError(w, http.StatusNotFound, "job not found", err)
		return
	}

	// Determine job status from K8s job conditions
	status := "unknown"
	var startTime, completionTime *string

	if job.Status.StartTime != nil {
		t := job.Status.StartTime.Format(time.RFC3339)
		startTime = &t
	}
	if job.Status.CompletionTime != nil {
		t := job.Status.CompletionTime.Format(time.RFC3339)
		completionTime = &t
	}

	if job.Status.Succeeded > 0 {
		status = "succeeded"
	} else if job.Status.Failed > 0 {
		status = "failed"
	} else if job.Status.Active > 0 {
		status = "running"
	} else {
		status = "pending"
	}

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"job_id":          jobID,
		"status":          status,
		"active":          job.Status.Active,
		"succeeded":       job.Status.Succeeded,
		"failed":          job.Status.Failed,
		"start_time":      startTime,
		"completion_time": completionTime,
	})
}

// DeleteJob handles DELETE /api/v1/jobs/{id}
func (h *Handlers) DeleteJob(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	jobID := vars["id"]

	if h.k8sClient == nil {
		h.respondError(w, http.StatusServiceUnavailable, "k8s client not available", errors.New("k8s client not configured"))
		return
	}

	if err := h.k8sClient.DeleteJob(ctx, jobID); err != nil {
		h.respondError(w, http.StatusInternalServerError, "failed to delete job", err)
		return
	}

	h.logger.Info("job deleted", slog.String("job_id", jobID))
	w.WriteHeader(http.StatusNoContent)
}

// --- RunStore Diagnostics ---

// RunStoreInfo handles GET /api/v1/runstore/info
func (h *Handlers) RunStoreInfo(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	info, err := h.store.AdapterInfo(ctx)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "failed to get runstore info", err)
		return
	}

	h.respondJSON(w, http.StatusOK, info)
}

// RunStoreSelfCheck handles GET /api/v1/runstore/selfcheck
func (h *Handlers) RunStoreSelfCheck(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Simple self-check: create a run, append event, read it back, delete it
	start := time.Now()

	runID, err := h.store.CreateRun(ctx, "_selfcheck", nil)
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "selfcheck failed: create", err)
		return
	}

	_, err = h.store.AppendEvent(ctx, runID, &types.EventInput{
		Type: types.EventTypeLog,
		Data: map[string]string{"message": "selfcheck"},
	})
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "selfcheck failed: append", err)
		return
	}

	events, err := h.store.GetEventsSince(ctx, runID, "")
	if err != nil {
		h.respondError(w, http.StatusInternalServerError, "selfcheck failed: read", err)
		return
	}

	if err := h.store.CancelRun(ctx, runID); err != nil {
		h.respondError(w, http.StatusInternalServerError, "selfcheck failed: cleanup", err)
		return
	}

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"status":      "ok",
		"latency_ms":  time.Since(start).Milliseconds(),
		"event_count": len(events),
	})
}

// --- Helper Methods ---

func (h *Handlers) respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		h.logger.Error("failed to encode response", "error", err)
	}
}

func (h *Handlers) respondError(w http.ResponseWriter, status int, message string, err error) {
	h.logger.Error(message, "error", err, "status", status)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{
		"error":   message,
		"details": err.Error(),
	})
}
