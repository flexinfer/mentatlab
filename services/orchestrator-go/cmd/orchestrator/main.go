// Package main is the entry point for the orchestrator service.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/api"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/auth"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/dataflow"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/driver"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/factories"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/k8s"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/scheduler"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/tracing"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/validator"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Setup structured logging
	logLevel := slog.LevelInfo
	switch cfg.LogLevel {
	case "debug":
		logLevel = slog.LevelDebug
	case "warn":
		logLevel = slog.LevelWarn
	case "error":
		logLevel = slog.LevelError
	}

	var handler slog.Handler
	if cfg.LogFormat == "json" {
		handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel})
	} else {
		handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel})
	}
	logger := slog.New(handler)
	slog.SetDefault(logger)

	logger.Info("starting orchestrator",
		slog.String("port", cfg.Port),
		slog.String("log_level", cfg.LogLevel),
	)

	// Initialize tracing
	tracingProvider, err := tracing.Init(context.Background(), &tracing.Config{
		ServiceName:    "mentatlab-orchestrator",
		ServiceVersion: "1.0.0",
		OTLPEndpoint:   cfg.OTLPEndpoint,
		Enabled:        cfg.TracingEnabled,
		SampleRate:     1.0,
	}, logger)
	if err != nil {
		logger.Error("failed to initialize tracing", slog.String("error", err.Error()))
		// Continue without tracing
	}

	// Initialize RunStore based on configuration
	store, err := factories.CreateRunStore(cfg, logger)
	if err != nil {
		logger.Error("failed to initialize runstore", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	// Initialize driver and scheduler
	emitter := driver.NewRunStoreEmitter(store)

	// Select execution driver based on ORCH_DRIVER config
	execDriver, err := factories.CreateDriver(cfg, emitter, logger)
	if err != nil {
		logger.Error("failed to create driver", "error", err)
		os.Exit(1)
	}

	// Command resolver for agents
	resolveCmd := factories.CreateCommandResolver(cfg)

	sched := scheduler.NewScheduler(store, execDriver, resolveCmd,
		scheduler.WithMaxParallelism(cfg.MaxParallelism),
		scheduler.WithDefaultMaxRetries(cfg.DefaultMaxRetries),
		scheduler.WithDefaultBackoffSecs(cfg.DefaultBackoffSecs),
		scheduler.WithDefaultRunTimeout(cfg.DefaultRunTimeout),
		scheduler.WithLogger(logger.With(slog.String("component", "scheduler"))),
	)

	logger.Info("scheduler initialized",
		slog.String("driver", cfg.DriverType),
		slog.Int("max_parallelism", cfg.MaxParallelism),
		slog.Int("default_retries", cfg.DefaultMaxRetries),
		slog.Duration("default_run_timeout", cfg.DefaultRunTimeout),
	)

	// Initialize validator
	v, err := validator.New()
	if err != nil {
		logger.Error("failed to create validator", "error", err)
		// Continue without validator - validation will be basic
		v = nil
	}

	// Initialize agent registry
	agentRegistry, err := factories.CreateAgentRegistry(cfg, logger)
	if err != nil {
		logger.Error("failed to initialize agent registry", "error", err)
		os.Exit(1)
	}
	defer agentRegistry.Close()

	// Initialize flow store
	flows, err := factories.CreateFlowStore(cfg, logger)
	if err != nil {
		logger.Error("failed to initialize flow store", "error", err)
		os.Exit(1)
	}
	defer flows.Close()

	// Initialize API key store (requires Redis)
	var apiKeyStore *auth.APIKeyStore
	if cfg.RunStoreType == "redis" {
		redisAddr := strings.TrimPrefix(cfg.RedisURL, "redis://")
		apiKeyRedis := redisClient(redisAddr, cfg.RedisPassword, cfg.RedisDB)
		if apiKeyRedis != nil {
			apiKeyStore = auth.NewAPIKeyStore(apiKeyRedis)
			logger.Info("API key store initialized (Redis)")
		}
	}

	// Initialize CronRunner for scheduled runs
	cronRunner := scheduler.NewCronRunner(sched, flows, store, logger.With(slog.String("component", "cron")))
	cronRunner.Start()
	defer cronRunner.Stop()
	logger.Info("cron runner started")

	// Initialize K8s client (optional)
	var k8sClient *k8s.Client
	if cfg.K8sInCluster || cfg.K8sKubeconfig != "" {
		k8sCfg := &k8s.Config{
			InCluster:  cfg.K8sInCluster,
			Kubeconfig: cfg.K8sKubeconfig,
			Namespace:  cfg.K8sNamespace,
		}
		client, err := k8s.NewClient(k8sCfg)
		if err != nil {
			logger.Warn("failed to create K8s client", "error", err)
		} else {
			k8sClient = client
			logger.Info("K8s client initialized", slog.String("namespace", cfg.K8sNamespace))
		}
	}

	// Initialize dataflow service (optional)
	var dataflowSvc *dataflow.Service
	dataflowType := os.Getenv("DATAFLOW_TYPE")
	if dataflowType != "" {
		dfCfg := &dataflow.Config{
			Type:           dataflowType,
			Endpoint:       os.Getenv("MINIO_ENDPOINT"),
			Bucket:         os.Getenv("MINIO_BUCKET"),
			Region:         os.Getenv("MINIO_REGION"),
			AccessKeyID:    os.Getenv("MINIO_ACCESS_KEY"),
			SecretAccessKey: os.Getenv("MINIO_SECRET_KEY"),
			UseSSL:         os.Getenv("MINIO_USE_SSL") == "true",
			PathPrefix:     "artifacts",
		}
		svc, err := dataflow.New(dfCfg)
		if err != nil {
			logger.Warn("failed to create dataflow service, artifacts disabled", "error", err)
		} else {
			dataflowSvc = svc
			logger.Info("dataflow service initialized", slog.String("type", dataflowType))
		}
	}

	// Initialize OIDC auth middleware (optional, disabled by default)
	var authMiddleware *auth.Middleware
	if cfg.OIDCEnabled {
		authProvider, err := auth.NewProvider(context.Background(), &auth.Config{
			Issuer:       cfg.OIDCIssuer,
			ClientID:     cfg.OIDCClientID,
			ClientSecret: cfg.OIDCClientSecret,
		})
		if err != nil {
			logger.Error("failed to initialize OIDC provider", "error", err)
		} else {
			authMiddleware = auth.NewMiddleware(authProvider, &auth.MiddlewareConfig{
				Enabled:     true,
				PublicPaths: []string{"/health", "/healthz", "/ready", "/metrics"},
				APIKeyStore: apiKeyStore,
			})
			logger.Info("OIDC auth middleware initialized", slog.String("issuer", cfg.OIDCIssuer))
		}
	}

	// Initialize API handlers
	handlerOpts := &api.HandlerOptions{
		Registry:    agentRegistry,
		FlowStore:   flows,
		K8sClient:   k8sClient,
		DataflowSvc: dataflowSvc,
		CronRunner:  cronRunner,
		APIKeyStore: apiKeyStore,
	}
	handlers := api.NewHandlers(store, sched, v, cfg, logger, handlerOpts)
	server := api.NewServer(handlers, authMiddleware, cfg.RateLimitRPS, cfg.RateLimitBurst)

	// Create HTTP server
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      server.Router(),
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		logger.Info("server listening", slog.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down server...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownGrace)
	defer cancel()

	// Shutdown tracer
	if tracingProvider != nil {
		if err := tracingProvider.Shutdown(ctx); err != nil {
			logger.Error("tracer shutdown error", slog.String("error", err.Error()))
		}
	}

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("server shutdown error", "error", err)
	}

	logger.Info("server stopped")
}

// redisClient creates a Redis client for the given address.
func redisClient(addr, password string, db int) *redis.Client {
	return redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       db,
	})
}
