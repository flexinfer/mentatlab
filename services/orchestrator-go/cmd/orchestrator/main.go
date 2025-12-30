// Package main is the entry point for the orchestrator service.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/api"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/driver"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/scheduler"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/validator"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
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

	// Initialize RunStore based on configuration
	var store runstore.RunStore
	switch cfg.RunStoreType {
	case "redis":
		redisCfg := &runstore.RedisConfig{
			URL:      cfg.RedisURL,
			Password: cfg.RedisPassword,
			DB:       cfg.RedisDB,
			Prefix:   "runs",
			TTL:      cfg.RunStoreTTL,
		}
		redisStore, err := runstore.NewRedisStore(redisCfg)
		if err != nil {
			logger.Error("failed to connect to Redis, falling back to memory store", "error", err)
			storeCfg := &runstore.Config{
				EventMaxLen: cfg.EventMaxLen,
				TTLSeconds:  int64(cfg.RunStoreTTL.Seconds()),
			}
			store = runstore.NewMemoryStore(storeCfg)
		} else {
			store = redisStore
			logger.Info("using Redis runstore", slog.String("url", cfg.RedisURL))
		}
	default:
		storeCfg := &runstore.Config{
			EventMaxLen: cfg.EventMaxLen,
			TTLSeconds:  int64(cfg.RunStoreTTL.Seconds()),
		}
		store = runstore.NewMemoryStore(storeCfg)
		logger.Info("using in-memory runstore")
	}
	defer store.Close()

	// Initialize driver and scheduler
	emitter := driver.NewRunStoreEmitter(store)
	subprocessDriver := driver.NewLocalSubprocessDriver(emitter, &driver.SubprocessConfig{
		EnvPassthrough: map[string]string{
			"ORCHESTRATOR_URL": "http://localhost:" + cfg.Port,
		},
	})

	// Command resolver for agents
	resolveCmd := func(node *types.NodeSpec) []string {
		if len(node.Command) > 0 {
			return node.Command
		}
		// Default: try to find agent in agents directory
		// This would be replaced with proper agent resolution in production
		if node.AgentID != "" {
			return []string{"python", "-m", "agents." + node.AgentID}
		}
		return nil
	}

	schedCfg := &scheduler.Config{
		MaxParallelism:     cfg.MaxParallelism,
		DefaultMaxRetries:  cfg.DefaultMaxRetries,
		DefaultBackoffSecs: cfg.DefaultBackoffSecs,
	}
	sched := scheduler.New(store, subprocessDriver, resolveCmd, schedCfg)

	logger.Info("scheduler initialized",
		slog.Int("max_parallelism", cfg.MaxParallelism),
		slog.Int("default_retries", cfg.DefaultMaxRetries),
	)

	// Initialize validator
	v, err := validator.New()
	if err != nil {
		logger.Error("failed to create validator", "error", err)
		// Continue without validator - validation will be basic
		v = nil
	}

	// Initialize API handlers
	handlers := api.NewHandlers(store, sched, v, cfg, logger)
	server := api.NewServer(handlers)

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

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("server shutdown error", "error", err)
	}

	logger.Info("server stopped")
}
