// Package api provides HTTP handlers and routing for the orchestrator service.
package api

import (
	"net/http"

	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	// Import metrics to register them
	_ "github.com/flexinfer/mentatlab/services/orchestrator-go/internal/metrics"
)

// Server holds the HTTP handlers and dependencies.
type Server struct {
	router   *mux.Router
	handlers *Handlers
}

// NewServer creates a new API server with the given handlers.
func NewServer(h *Handlers) *Server {
	s := &Server{
		router:   mux.NewRouter(),
		handlers: h,
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

	// Agent scheduling
	api.HandleFunc("/agents/schedule", s.handlers.ScheduleAgent).Methods("POST")
	api.HandleFunc("/agents/validate", s.handlers.ValidateManifest).Methods("POST")

	// Flow management
	api.HandleFunc("/flows", s.handlers.CreateFlow).Methods("POST")
	api.HandleFunc("/flows", s.handlers.ListFlows).Methods("GET")
	api.HandleFunc("/flows/{id}", s.handlers.GetFlow).Methods("GET")
	api.HandleFunc("/flows/{id}", s.handlers.UpdateFlow).Methods("PUT")
	api.HandleFunc("/flows/{id}", s.handlers.DeleteFlow).Methods("DELETE")

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

	// Apply middleware
	s.router.Use(s.handlers.CORSMiddleware)
	s.router.Use(s.handlers.LoggingMiddleware)
	s.router.Use(s.handlers.RecoveryMiddleware)
}
