package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/flexinfer/mentatlab/services/gateway-go/hub"
	"github.com/flexinfer/mentatlab/services/gateway-go/middleware"
	"github.com/flexinfer/mentatlab/services/gateway-go/tracing"

	"github.com/gorilla/mux"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	// Import metrics to register them
	_ "github.com/flexinfer/mentatlab/services/gateway-go/metrics"
)

// Config holds gateway configuration.
type Config struct {
	Port                  string
	OrchestratorURL       string
	RedisAddr             string
	CFTeamDomain          string
	CFPolicyAUD           string
	CFServiceClientID     string
	CFServiceClientSecret string
	AuthEnabled           bool
	AllowedOrigins        []string
	RateLimitRPS          float64
	RateLimitBurst        int
	ShutdownTimeout       time.Duration
	TracingEnabled        bool
	OTLPEndpoint          string
}

// loadConfig loads configuration from environment variables.
func loadConfig() *Config {
	cfg := &Config{
		Port:                  getEnv("PORT", "8080"),
		OrchestratorURL:       getEnv("ORCHESTRATOR_BASE_URL", "http://localhost:7070"),
		RedisAddr:             getEnv("REDIS_URL", "redis:6379"),
		CFTeamDomain:          getEnv("CF_TEAM_DOMAIN", ""),
		CFPolicyAUD:           getEnv("CF_POLICY_AUD", ""),
		CFServiceClientID:     getEnv("CF_ACCESS_CLIENT_ID", ""),
		CFServiceClientSecret: getEnv("CF_ACCESS_CLIENT_SECRET", ""),
		AuthEnabled:           getEnv("AUTH_ENABLED", "false") == "true",
		RateLimitRPS:          100,
		RateLimitBurst:        200,
		ShutdownTimeout:       10 * time.Second,
		TracingEnabled:        getEnv("TRACING_ENABLED", "false") == "true",
		OTLPEndpoint:          getEnv("OTLP_ENDPOINT", "localhost:4317"),
	}

	// Parse allowed origins
	origins := getEnv("CORS_ORIGINS", "")
	if origins != "" {
		cfg.AllowedOrigins = strings.Split(origins, ",")
	}

	return cfg
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func main() {
	// Setup structured logging
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	cfg := loadConfig()

	// Initialize tracing
	tracingProvider, err := tracing.Init(context.Background(), &tracing.Config{
		ServiceName:    "mentatlab-gateway",
		ServiceVersion: "1.0.0",
		OTLPEndpoint:   cfg.OTLPEndpoint,
		Enabled:        cfg.TracingEnabled,
		SampleRate:     1.0,
	}, logger)
	if err != nil {
		logger.Error("failed to initialize tracing", slog.String("error", err.Error()))
		// Continue without tracing
	}

	orchURL, err := url.Parse(cfg.OrchestratorURL)
	if err != nil {
		logger.Error("invalid orchestrator URL", slog.String("error", err.Error()))
		os.Exit(1)
	}

	// Initialize auth middleware first (needed by hub for WebSocket auth)
	authMiddleware := middleware.NewAuthMiddleware(&middleware.AuthConfig{
		TeamDomain:          cfg.CFTeamDomain,
		PolicyAUD:           cfg.CFPolicyAUD,
		ServiceClientID:     cfg.CFServiceClientID,
		ServiceClientSecret: cfg.CFServiceClientSecret,
		Enabled:             cfg.AuthEnabled,
		SkipPaths:           []string{"/health", "/healthz", "/ready", "/metrics"},
	}, logger)

	// Initialize Hub with structured logging, origin validation, and auth
	wsHub := hub.NewHubWithConfig(&hub.HubConfig{
		RedisAddr:      cfg.RedisAddr,
		Logger:         logger,
		AllowedOrigins: cfg.AllowedOrigins,
		AuthValidator: func(r *http.Request) (string, string, error) {
			userInfo, err := authMiddleware.ValidateWebSocketToken(r)
			if err != nil {
				return "", "", err
			}
			return userInfo.Email, userInfo.Type, nil
		},
	})
	go wsHub.Run()

	// Log warning if no origins configured (allows all)
	if len(cfg.AllowedOrigins) == 0 {
		logger.Warn("CORS_ORIGINS not configured - allowing all WebSocket origins (not recommended for production)")
	}

	securityMiddleware := middleware.NewSecurityMiddleware(&middleware.SecurityConfig{
		AllowedOrigins: cfg.AllowedOrigins,
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders: []string{"Content-Type", "Authorization", "X-Request-ID", "CF-Access-JWT-Assertion"},
		FrameOptions:   "DENY",
		HSTSMaxAge:     31536000,
	})

	rateLimiter := middleware.NewRateLimiter(&middleware.RateLimitConfig{
		RequestsPerSecond: cfg.RateLimitRPS,
		BurstSize:         cfg.RateLimitBurst,
		SkipPaths:         []string{"/health", "/healthz", "/ready", "/metrics"},
	})

	loggingMiddleware := middleware.NewLoggingMiddleware(&middleware.LoggingConfig{
		SkipPaths: []string{"/health", "/healthz", "/ready", "/metrics"},
	}, logger)

	tracingMiddleware := middleware.NewTracingMiddleware(&middleware.TracingConfig{
		Enabled: cfg.TracingEnabled,
	})

	r := mux.NewRouter()

	// Health endpoints
	r.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}).Methods("GET")

	r.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}).Methods("GET")

	// Prometheus metrics endpoint
	r.Handle("/metrics", promhttp.Handler()).Methods("GET")

	r.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		status := map[string]interface{}{
			"status": "ready",
			"components": map[string]interface{}{
				"redis": map[string]interface{}{
					"healthy": wsHub.RedisHealthy(ctx),
				},
				"websocket": map[string]interface{}{
					"clients": wsHub.ClientCount(),
				},
			},
		}

		// Check if Redis is healthy
		if !wsHub.RedisHealthy(ctx) {
			status["status"] = "degraded"
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(status)
	}).Methods("GET")

	// WebSocket endpoint
	r.HandleFunc("/ws/streams/{stream_id}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		streamID := vars["stream_id"]
		hub.ServeWs(wsHub, w, r, streamID)
	})

	// Reverse Proxy for API requests
	proxy := httputil.NewSingleHostReverseProxy(orchURL)

	// Modify proxy to inject service tokens for orchestrator requests
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		// Inject Cloudflare Access service token for internal requests
		authMiddleware.InjectServiceToken(req)
	}

	r.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHTTP(w, r)
	})

	// Apply middleware (order matters: outer -> inner)
	// 1. Tracing (outermost - create spans)
	// 2. Logging (capture request/response with trace context)
	// 3. Security headers
	// 4. CORS
	// 5. Rate limiting
	// 6. Authentication
	handler := tracingMiddleware.Middleware(
		loggingMiddleware.Middleware(
			securityMiddleware.Middleware(
				securityMiddleware.CORSMiddleware(
					rateLimiter.Middleware(
						authMiddleware.Middleware(r),
					),
				),
			),
		),
	)

	// Create HTTP server with timeouts
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		logger.Info("gateway starting",
			slog.String("port", cfg.Port),
			slog.String("orchestrator", cfg.OrchestratorURL),
			slog.String("redis", cfg.RedisAddr),
			slog.Bool("auth_enabled", cfg.AuthEnabled),
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", slog.String("error", err.Error()))
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down server...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()

	// Stop accepting new WebSocket connections and close existing ones
	wsHub.Stop()

	// Stop rate limiter cleanup goroutine
	rateLimiter.Stop()

	// Shutdown tracer
	if tracingProvider != nil {
		if err := tracingProvider.Shutdown(ctx); err != nil {
			logger.Error("tracer shutdown error", slog.String("error", err.Error()))
		}
	}

	// Shutdown HTTP server
	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("server shutdown error", slog.String("error", err.Error()))
	}

	logger.Info("server stopped")
}
