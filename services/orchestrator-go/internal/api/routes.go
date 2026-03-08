// Package api provides HTTP handlers and routing for the orchestrator service.
package api

import (
	"net/http"

	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/auth"

	// Import metrics to register them
	_ "github.com/flexinfer/mentatlab/services/orchestrator-go/internal/metrics"
)

// Server holds the HTTP handlers and dependencies.
type Server struct {
	router         *mux.Router
	handlers       *Handlers
	authMiddleware *auth.Middleware
	rateLimitRPS   float64
	rateLimitBurst int
}

// NewServer creates a new API server with the given handlers.
func NewServer(h *Handlers, authMw *auth.Middleware, rateLimitRPS float64, rateLimitBurst int) *Server {
	s := &Server{
		router:         mux.NewRouter(),
		handlers:       h,
		authMiddleware: authMw,
		rateLimitRPS:   rateLimitRPS,
		rateLimitBurst: rateLimitBurst,
	}
	s.setupRoutes()
	return s
}

// Router returns the configured router for use with http.Server.
func (s *Server) Router() http.Handler {
	return s.router
}

func (s *Server) setupRoutes() {
	// Health endpoints
	s.router.HandleFunc("/health", s.handlers.Health).Methods("GET")
	s.router.HandleFunc("/healthz", s.handlers.Health).Methods("GET")
	s.router.HandleFunc("/ready", s.handlers.Ready).Methods("GET")

	// Prometheus metrics endpoint
	s.router.Handle("/metrics", promhttp.Handler()).Methods("GET")

	// API routes
	api := s.router.PathPrefix("/api/v1").Subrouter()

	// Apply auth middleware to API subrouter if configured
	if s.authMiddleware != nil {
		api.Use(s.authMiddleware.Handler)
	}

	// Audit logging for authenticated API operations
	api.Use(s.handlers.AuditMiddleware)

	// Apply per-IP rate limiting to API subrouter
	if s.rateLimitRPS > 0 {
		rateLimiter := auth.NewPerIPRateLimiter(s.rateLimitRPS, s.rateLimitBurst)
		api.Use(rateLimiter.Handler)
	}

	// Run management
	api.HandleFunc("/runs", s.handlers.CreateRun).Methods("POST")
	api.HandleFunc("/runs", s.handlers.ListRuns).Methods("GET")
	api.HandleFunc("/runs/{id}", s.handlers.GetRun).Methods("GET")
	api.HandleFunc("/runs/{id}", s.handlers.DeleteRun).Methods("DELETE")
	api.HandleFunc("/runs/{id}/start", s.handlers.StartRun).Methods("POST")
	api.HandleFunc("/runs/{id}/cancel", s.handlers.CancelRun).Methods("POST")
	api.HandleFunc("/runs/{id}/events", s.handlers.StreamEvents).Methods("GET")

	// Agent registry CRUD
	api.HandleFunc("/agents", s.handlers.CreateAgent).Methods("POST")
	api.HandleFunc("/agents", s.handlers.ListAgents).Methods("GET")
	api.HandleFunc("/agents/{id}", s.handlers.GetAgent).Methods("GET")
	api.HandleFunc("/agents/{id}", s.handlers.UpdateAgent).Methods("PUT")
	api.HandleFunc("/agents/{id}", s.handlers.DeleteAgent).Methods("DELETE")
	api.HandleFunc("/agents/{id}/reload", s.handlers.ReloadAgent).Methods("POST")

	// Agent scheduling
	api.HandleFunc("/agents/schedule", s.handlers.ScheduleAgent).Methods("POST")
	api.HandleFunc("/agents/validate", s.handlers.ValidateManifest).Methods("POST")

	// Flow management
	api.HandleFunc("/flows", s.handlers.CreateFlow).Methods("POST")
	api.HandleFunc("/flows", s.handlers.ListFlows).Methods("GET")
	api.HandleFunc("/flows/{id}", s.handlers.GetFlow).Methods("GET")
	api.HandleFunc("/flows/{id}", s.handlers.UpdateFlow).Methods("PUT")
	api.HandleFunc("/flows/{id}", s.handlers.DeleteFlow).Methods("DELETE")
	api.HandleFunc("/flows/{id}/run", s.handlers.RunFlow).Methods("POST")
	api.HandleFunc("/flows/import/loom", s.handlers.ImportLoomWorkflow).Methods("POST")
	api.HandleFunc("/flows/{id}/export/loom", s.handlers.ExportFlowAsLoomWorkflow).Methods("GET")

	// Run cloning
	api.HandleFunc("/runs/{id}/clone", s.handlers.CloneRun).Methods("POST")

	// Gate approval/rejection
	api.HandleFunc("/runs/{id}/nodes/{nodeId}/approve", s.handlers.ApproveGate).Methods("POST")
	api.HandleFunc("/runs/{id}/nodes/{nodeId}/reject", s.handlers.RejectGate).Methods("POST")

	// Webhook management
	api.HandleFunc("/webhooks", s.handlers.CreateWebhook).Methods("POST")
	api.HandleFunc("/webhooks/trigger/{flowId}", s.handlers.TriggerWebhook).Methods("POST")

	// API key management
	api.HandleFunc("/apikeys", s.handlers.CreateAPIKey).Methods("POST")
	api.HandleFunc("/apikeys", s.handlers.ListAPIKeys).Methods("GET")
	api.HandleFunc("/apikeys/{id}", s.handlers.RevokeAPIKey).Methods("DELETE")

	// Schedule management (cron)
	api.HandleFunc("/schedules", s.handlers.CreateSchedule).Methods("POST")
	api.HandleFunc("/schedules", s.handlers.ListSchedules).Methods("GET")
	api.HandleFunc("/schedules/{id}", s.handlers.GetSchedule).Methods("GET")
	api.HandleFunc("/schedules/{id}", s.handlers.DeleteSchedule).Methods("DELETE")

	// Job management (K8s jobs)
	api.HandleFunc("/jobs/{id}/status", s.handlers.GetJobStatus).Methods("GET")
	api.HandleFunc("/jobs/{id}", s.handlers.DeleteJob).Methods("DELETE")

	// Artifact management
	api.HandleFunc("/runs/{id}/artifacts", s.handlers.ListRunArtifacts).Methods("GET")
	api.HandleFunc("/runs/{id}/artifacts", s.handlers.UploadArtifact).Methods("POST")
	api.HandleFunc("/artifacts", s.handlers.GetArtifact).Methods("GET")
	api.HandleFunc("/artifacts", s.handlers.DeleteArtifact).Methods("DELETE")
	api.HandleFunc("/artifacts/download-url", s.handlers.GetArtifactDownloadURL).Methods("POST")

	// RunStore diagnostics
	api.HandleFunc("/runstore/info", s.handlers.RunStoreInfo).Methods("GET")
	api.HandleFunc("/runstore/selfcheck", s.handlers.RunStoreSelfCheck).Methods("GET")

	// MCP tooling inventory and execution
	api.HandleFunc("/mcp/tools", s.handlers.ListMCPTools).Methods("GET")
	api.HandleFunc("/mcp/tools/index", s.handlers.ListMCPToolsIndex).Methods("GET")
	api.HandleFunc("/mcp/tools/{name}/call", s.handlers.CallMCPTool).Methods("POST")

	// Apply middleware
	s.router.Use(s.handlers.CORSMiddleware)
	s.router.Use(s.handlers.LoggingMiddleware)
	s.router.Use(s.handlers.RecoveryMiddleware)
}
