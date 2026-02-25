package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/scheduler"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/validator"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// --- Gate Endpoints (M6.1) ---

// ApproveGate handles POST /api/v1/runs/{id}/nodes/{nodeId}/approve
func (h *Handlers) ApproveGate(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	runID := vars["id"]
	nodeID := vars["nodeId"]

	_, span := apiTracer.Start(r.Context(), "api.ApproveGate",
		trace.WithAttributes(
			attribute.String("run_id", runID),
			attribute.String("node_id", nodeID),
		),
	)
	defer span.End()

	if h.scheduler == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "scheduler not available", errors.New("scheduler not configured"))
		return
	}

	if err := h.scheduler.ApproveGate(runID, nodeID); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "failed to approve gate", err)
		return
	}

	h.logger.Info("gate approved", slog.String("run_id", runID), slog.String("node_id", nodeID))
	h.respondJSON(w, http.StatusOK, map[string]string{
		"status":  "approved",
		"run_id":  runID,
		"node_id": nodeID,
	})
}

// RejectGate handles POST /api/v1/runs/{id}/nodes/{nodeId}/reject
func (h *Handlers) RejectGate(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	runID := vars["id"]
	nodeID := vars["nodeId"]

	_, span := apiTracer.Start(r.Context(), "api.RejectGate",
		trace.WithAttributes(
			attribute.String("run_id", runID),
			attribute.String("node_id", nodeID),
		),
	)
	defer span.End()

	if h.scheduler == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "scheduler not available", errors.New("scheduler not configured"))
		return
	}

	if err := h.scheduler.RejectGate(runID, nodeID); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "failed to reject gate", err)
		return
	}

	h.logger.Info("gate rejected", slog.String("run_id", runID), slog.String("node_id", nodeID))
	h.respondJSON(w, http.StatusOK, map[string]string{
		"status":  "rejected",
		"run_id":  runID,
		"node_id": nodeID,
	})
}

// --- Webhook Endpoints (M6.2) ---

// CreateWebhookRequest is the request body for creating a flow webhook.
type CreateWebhookRequest struct {
	FlowID string `json:"flow_id"`
}

// CreateWebhook handles POST /api/v1/webhooks
func (h *Handlers) CreateWebhook(w http.ResponseWriter, r *http.Request) {
	ctx, span := apiTracer.Start(r.Context(), "api.CreateWebhook")
	defer span.End()

	if h.flowStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "flow store not available", errors.New("flow store not configured"))
		return
	}

	var req CreateWebhookRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}

	if req.FlowID == "" {
		h.respondError(w, r, http.StatusBadRequest, "flow_id is required", errors.New("missing flow_id"))
		return
	}

	flow, err := h.flowStore.Get(ctx, req.FlowID)
	if err != nil {
		if errors.Is(err, flowstore.ErrFlowNotFound) {
			h.respondError(w, r, http.StatusNotFound, "flow not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to get flow", err)
		return
	}

	token, err := generateWebhookToken()
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to generate token", err)
		return
	}

	if _, err := h.flowStore.Update(ctx, req.FlowID, &flowstore.UpdateFlowRequest{
		Metadata: map[string]any{
			"webhook_token": token,
		},
	}); err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to update flow", err)
		return
	}

	h.logger.Info("webhook created", slog.String("flow_id", flow.ID))
	h.respondJSON(w, http.StatusCreated, map[string]string{
		"flow_id":     flow.ID,
		"token":       token,
		"webhook_url": "/api/v1/webhooks/trigger/" + flow.ID,
	})
}

// TriggerWebhook handles POST /api/v1/webhooks/trigger/{flowId}
func (h *Handlers) TriggerWebhook(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	flowID := vars["flowId"]

	ctx, span := apiTracer.Start(r.Context(), "api.TriggerWebhook",
		trace.WithAttributes(attribute.String("flow_id", flowID)),
	)
	defer span.End()

	if h.flowStore == nil || h.scheduler == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "service not available", errors.New("flow store or scheduler not configured"))
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

	expectedToken := ""
	if flow.Metadata != nil {
		if t, ok := flow.Metadata["webhook_token"].(string); ok {
			expectedToken = t
		}
	}
	if expectedToken == "" {
		h.respondError(w, r, http.StatusForbidden, "no webhook configured for this flow", errors.New("missing webhook token"))
		return
	}

	providedToken := r.Header.Get("X-Webhook-Token")
	if providedToken == "" {
		if auth := r.Header.Get("Authorization"); len(auth) > 7 && auth[:7] == "Bearer " {
			providedToken = auth[7:]
		}
	}
	if providedToken != expectedToken {
		h.respondError(w, r, http.StatusForbidden, "invalid webhook token", errors.New("token mismatch"))
		return
	}

	plan, err := flowGraphToPlan(flow.Graph)
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to convert flow to plan", err)
		return
	}

	if result := validator.ValidatePlanGraph(plan); !result.Valid {
		msgs := make([]string, len(result.Errors))
		for i, e := range result.Errors {
			msgs[i] = e.Message
		}
		h.respondError(w, r, http.StatusBadRequest, strings.Join(msgs, "; "), nil)
		return
	}

	runID, err := h.store.CreateRun(ctx, flow.Name+" (webhook)", plan, getOwnerFromRequest(r))
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to create run", err)
		return
	}

	if err := h.scheduler.EnqueueRun(ctx, runID, flow.Name, plan); err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to enqueue run", err)
		return
	}
	if err := h.scheduler.StartRun(ctx, runID); err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to start run", err)
		return
	}

	h.logger.Info("webhook triggered run", slog.String("flow_id", flowID), slog.String("run_id", runID))
	h.respondJSON(w, http.StatusCreated, map[string]string{
		"run_id":  runID,
		"status":  "running",
		"sse_url": "/api/v1/runs/" + runID + "/events",
	})
}

// --- Run Cloning & Flow Run (M6.3) ---

// CloneRun handles POST /api/v1/runs/{id}/clone
func (h *Handlers) CloneRun(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	runID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.CloneRun",
		trace.WithAttributes(attribute.String("run_id", runID)),
	)
	defer span.End()

	run, err := h.store.GetRun(ctx, runID)
	if err != nil {
		if errors.Is(err, runstore.ErrRunNotFound) {
			h.respondError(w, r, http.StatusNotFound, "run not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to get run", err)
		return
	}

	if run.Plan == nil {
		h.respondError(w, r, http.StatusBadRequest, "run has no plan to clone", errors.New("missing plan"))
		return
	}
	if result := validator.ValidatePlanGraph(run.Plan); !result.Valid {
		h.respondError(w, r, http.StatusBadRequest, graphValidationMessage(result), nil)
		return
	}

	var req struct {
		AutoStart bool `json:"auto_start"`
	}
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}

	newRunID, err := h.store.CreateRun(ctx, run.Name+" (clone)", run.Plan, getOwnerFromRequest(r))
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to create cloned run", err)
		return
	}

	resp := map[string]interface{}{
		"run_id":        newRunID,
		"parent_run_id": runID,
		"status":        "created",
	}

	if req.AutoStart && h.scheduler != nil {
		if err := h.scheduler.EnqueueRun(ctx, newRunID, run.Name+" (clone)", run.Plan); err != nil {
			h.logger.Error("failed to enqueue cloned run", "error", err, "runId", newRunID)
		} else if err := h.scheduler.StartRun(ctx, newRunID); err != nil {
			h.logger.Error("failed to start cloned run", "error", err, "runId", newRunID)
		} else {
			resp["status"] = "running"
			resp["sse_url"] = "/api/v1/runs/" + newRunID + "/events"
		}
	}

	h.logger.Info("run cloned", slog.String("original", runID), slog.String("clone", newRunID))
	h.respondJSON(w, http.StatusCreated, resp)
}

// RunFlow handles POST /api/v1/flows/{id}/run
func (h *Handlers) RunFlow(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	flowID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.RunFlow",
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

	plan, err := flowGraphToPlan(flow.Graph)
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to convert flow to plan", err)
		return
	}

	if result := validator.ValidatePlanGraph(plan); !result.Valid {
		msgs := make([]string, len(result.Errors))
		for i, e := range result.Errors {
			msgs[i] = e.Message
		}
		h.respondError(w, r, http.StatusBadRequest, strings.Join(msgs, "; "), nil)
		return
	}

	var req struct {
		Timeout string `json:"timeout,omitempty"`
	}
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}
	if req.Timeout != "" {
		if d, err := time.ParseDuration(req.Timeout); err == nil {
			plan.Timeout = d
		}
	}

	runID, err := h.store.CreateRun(ctx, flow.Name, plan, getOwnerFromRequest(r))
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to create run", err)
		return
	}

	resp := map[string]interface{}{
		"run_id":  runID,
		"flow_id": flowID,
		"status":  "created",
	}

	if h.scheduler != nil {
		if err := h.scheduler.EnqueueRun(ctx, runID, flow.Name, plan); err != nil {
			h.logger.Error("failed to enqueue flow run", "error", err, "runId", runID)
		} else if err := h.scheduler.StartRun(ctx, runID); err != nil {
			h.logger.Error("failed to start flow run", "error", err, "runId", runID)
		} else {
			resp["status"] = "running"
			resp["sse_url"] = "/api/v1/runs/" + runID + "/events"
		}
	}

	h.logger.Info("flow run started", slog.String("flow_id", flowID), slog.String("run_id", runID))
	h.respondJSON(w, http.StatusCreated, resp)
}

// --- Schedule Endpoints (M6.4) ---

// CreateScheduleRequest is the request body for creating a schedule.
type CreateScheduleRequest struct {
	FlowID      string                 `json:"flow_id"`
	Cron        string                 `json:"cron"`
	InputParams map[string]interface{} `json:"input_params,omitempty"`
	Enabled     *bool                  `json:"enabled,omitempty"`
}

// CreateSchedule handles POST /api/v1/schedules
func (h *Handlers) CreateSchedule(w http.ResponseWriter, r *http.Request) {
	ctx, span := apiTracer.Start(r.Context(), "api.CreateSchedule")
	defer span.End()

	if h.flowStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "flow store not available", errors.New("flow store not configured"))
		return
	}

	var req CreateScheduleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}

	if req.FlowID == "" || req.Cron == "" {
		h.respondError(w, r, http.StatusBadRequest, "flow_id and cron are required", errors.New("missing required fields"))
		return
	}

	if _, err := h.flowStore.Get(ctx, req.FlowID); err != nil {
		if errors.Is(err, flowstore.ErrFlowNotFound) {
			h.respondError(w, r, http.StatusNotFound, "flow not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to get flow", err)
		return
	}

	// Validate cron expression
	if err := validateCronExpression(req.Cron); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid cron expression", err)
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	id, _ := generateID()
	now := time.Now().UTC()
	sched := &scheduler.Schedule{
		ID:          id,
		FlowID:      req.FlowID,
		Cron:        req.Cron,
		InputParams: req.InputParams,
		Enabled:     enabled,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if h.cronRunner != nil {
		if err := h.cronRunner.AddSchedule(sched); err != nil {
			h.respondError(w, r, http.StatusInternalServerError, "failed to create schedule", err)
			return
		}
	}

	h.logger.Info("schedule created", slog.String("id", id), slog.String("flow_id", req.FlowID), slog.String("cron", req.Cron))
	h.respondJSON(w, http.StatusCreated, sched)
}

// ListSchedules handles GET /api/v1/schedules
func (h *Handlers) ListSchedules(w http.ResponseWriter, r *http.Request) {
	_, span := apiTracer.Start(r.Context(), "api.ListSchedules")
	defer span.End()

	if h.cronRunner == nil {
		h.respondJSON(w, http.StatusOK, map[string]interface{}{
			"schedules": []*scheduler.Schedule{},
			"count":     0,
		})
		return
	}

	schedules := h.cronRunner.ListSchedules()
	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"schedules": schedules,
		"count":     len(schedules),
	})
}

// GetSchedule handles GET /api/v1/schedules/{id}
func (h *Handlers) GetSchedule(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	_, span := apiTracer.Start(r.Context(), "api.GetSchedule",
		trace.WithAttributes(attribute.String("schedule_id", id)),
	)
	defer span.End()

	if h.cronRunner == nil {
		h.respondError(w, r, http.StatusNotFound, "schedule not found", errors.New("cron runner not configured"))
		return
	}

	sched, err := h.cronRunner.GetSchedule(id)
	if err != nil {
		h.respondError(w, r, http.StatusNotFound, "schedule not found", err)
		return
	}

	h.respondJSON(w, http.StatusOK, sched)
}

// DeleteSchedule handles DELETE /api/v1/schedules/{id}
func (h *Handlers) DeleteSchedule(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	_, span := apiTracer.Start(r.Context(), "api.DeleteSchedule",
		trace.WithAttributes(attribute.String("schedule_id", id)),
	)
	defer span.End()

	if h.cronRunner == nil {
		h.respondError(w, r, http.StatusNotFound, "schedule not found", errors.New("cron runner not configured"))
		return
	}

	if err := h.cronRunner.RemoveSchedule(id); err != nil {
		h.respondError(w, r, http.StatusNotFound, "schedule not found", err)
		return
	}

	h.logger.Info("schedule deleted", slog.String("id", id))
	w.WriteHeader(http.StatusNoContent)
}

// --- Helpers ---

func flowGraphToPlan(graph json.RawMessage) (*types.Plan, error) {
	if len(graph) == 0 {
		return nil, errors.New("empty graph")
	}

	// First, try direct unmarshal (flat Plan format).
	var plan types.Plan
	if err := json.Unmarshal(graph, &plan); err != nil {
		return nil, err
	}

	// Detect ReactFlow format: nodes have a "data" object with agent_id/command.
	// Parse raw graph to check for "data" fields and extract nested properties.
	var raw struct {
		Nodes []json.RawMessage `json:"nodes"`
		Edges []json.RawMessage `json:"edges"`
	}
	if err := json.Unmarshal(graph, &raw); err != nil {
		return &plan, nil // fallback to what we already parsed
	}

	for i, rawNode := range raw.Nodes {
		if i >= len(plan.Nodes) {
			break
		}
		// If agent_id and command are already set at top level, skip this node.
		if plan.Nodes[i].AgentID != "" || len(plan.Nodes[i].Command) > 0 {
			continue
		}

		// Check for ReactFlow "data" object with nested fields.
		var nodeWithData struct {
			Data struct {
				AgentID string            `json:"agent_id"`
				Image   string            `json:"image"`
				Command []string          `json:"command"`
				Env     map[string]string `json:"env"`
				Input   json.RawMessage   `json:"input"`
				Timeout string            `json:"timeout"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rawNode, &nodeWithData); err != nil {
			continue
		}
		d := nodeWithData.Data
		if d.AgentID != "" {
			plan.Nodes[i].AgentID = d.AgentID
		}
		if d.Image != "" {
			plan.Nodes[i].Image = d.Image
		}
		if len(d.Command) > 0 {
			plan.Nodes[i].Command = d.Command
		}
		if len(d.Env) > 0 {
			if plan.Nodes[i].Env == nil {
				plan.Nodes[i].Env = make(map[string]string)
			}
			for k, v := range d.Env {
				plan.Nodes[i].Env[k] = v
			}
		}
		if len(d.Input) > 0 && string(d.Input) != "null" {
			if plan.Nodes[i].Env == nil {
				plan.Nodes[i].Env = make(map[string]string)
			}
			plan.Nodes[i].Env["AGENT_INPUT"] = string(d.Input)
		}
		if d.Timeout != "" {
			if dur, err := time.ParseDuration(d.Timeout); err == nil {
				plan.Nodes[i].Timeout = dur
			}
		}
	}

	// Handle ReactFlow edge format (source/target → from/to).
	if len(plan.Edges) == 0 && len(raw.Edges) > 0 {
		for _, rawEdge := range raw.Edges {
			var rfEdge struct {
				Source string `json:"source"`
				Target string `json:"target"`
			}
			if err := json.Unmarshal(rawEdge, &rfEdge); err != nil {
				continue
			}
			if rfEdge.Source != "" && rfEdge.Target != "" {
				plan.Edges = append(plan.Edges, types.EdgeSpec{
					From: rfEdge.Source,
					To:   rfEdge.Target,
				})
			}
		}
	}

	return &plan, nil
}

func generateWebhookToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func generateID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// validateCronExpression checks whether a cron expression has 5 valid fields.
func validateCronExpression(expr string) error {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return fmt.Errorf("expected 5 fields, got %d", len(fields))
	}
	return nil
}
