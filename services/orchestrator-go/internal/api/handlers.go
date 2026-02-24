package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"go.opentelemetry.io/otel"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/auth"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/dataflow"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/k8s"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/scheduler"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/validator"
)

var apiTracer = otel.Tracer("mentatlab/api")

// Handlers contains all HTTP handlers and their dependencies.
type Handlers struct {
	store       runstore.RunStore
	scheduler   *scheduler.Scheduler
	validator   *validator.Validator
	registry    registry.AgentRegistry
	flowStore   flowstore.FlowStore
	k8sClient   *k8s.Client
	dataflowSvc *dataflow.Service
	cronRunner  *scheduler.CronRunner
	apiKeyStore *auth.APIKeyStore
	config      *config.Config
	logger      *slog.Logger
}

// HandlerOptions configures optional handler dependencies.
type HandlerOptions struct {
	Registry    registry.AgentRegistry
	FlowStore   flowstore.FlowStore
	K8sClient   *k8s.Client
	DataflowSvc *dataflow.Service
	CronRunner  *scheduler.CronRunner
	APIKeyStore *auth.APIKeyStore
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
		h.flowStore = opts.FlowStore
		h.k8sClient = opts.K8sClient
		h.dataflowSvc = opts.DataflowSvc
		h.cronRunner = opts.CronRunner
		h.apiKeyStore = opts.APIKeyStore
	}
	return h
}

// getOwnerFromRequest extracts the user identity (email) from the request.
// It checks X-User-Email header (set by gateway) first, then OIDC claims.
func getOwnerFromRequest(r *http.Request) string {
	// Check gateway-forwarded header first
	if email := r.Header.Get("X-User-Email"); email != "" {
		return email
	}
	return ""
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
		h.respondError(w, r, http.StatusServiceUnavailable, "runstore unhealthy", err)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "ready",
		"runstore": info,
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

func (h *Handlers) respondError(w http.ResponseWriter, r *http.Request, status int, message string, err error) {
	h.logger.Error(message, "error", err, "status", status)
	code := HTTPStatusToErrorCode(status)
	details := map[string]interface{}{}
	if err != nil {
		details["reason"] = err.Error()
	}
	writeErrorResponse(w, r, status, code, message, details)
}
