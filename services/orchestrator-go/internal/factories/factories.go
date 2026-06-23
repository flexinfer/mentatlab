package factories

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/driver"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/k8s"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/metrics"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/scheduler"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
	"github.com/redis/go-redis/v9"
)

// CreateRunStore initializes a RunStore based on the provided configuration.
func CreateRunStore(cfg *config.Config, logger *slog.Logger) (runstore.RunStore, error) {
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
			if !cfg.AllowMemoryFallback {
				return nil, err
			}
			metrics.RunStoreFallbackTotal.Inc()
			logger.Warn("failed to connect to Redis, falling back to memory store (ORCH_ALLOW_MEMORY_FALLBACK=true)", "error", err)
			storeCfg := &runstore.Config{
				EventMaxLen: cfg.EventMaxLen,
				TTLSeconds:  int64(cfg.RunStoreTTL.Seconds()),
			}
			return runstore.NewMemoryStore(storeCfg), nil
		}
		logger.Info("using Redis runstore", slog.String("url", cfg.RedisURL))
		return redisStore, nil
	default:
		storeCfg := &runstore.Config{
			EventMaxLen: cfg.EventMaxLen,
			TTLSeconds:  int64(cfg.RunStoreTTL.Seconds()),
		}
		logger.Info("using in-memory runstore")
		return runstore.NewMemoryStore(storeCfg), nil
	}
}

// CreateDriver initializes an execution Driver based on the provided configuration.
func CreateDriver(cfg *config.Config, emitter driver.EventEmitter, logger *slog.Logger) (driver.Driver, error) {
	switch cfg.DriverType {
	case "k8s":
		k8sCfg := &driver.K8sDriverConfig{
			K8sConfig: &k8s.Config{
				InCluster:  cfg.K8sInCluster,
				Kubeconfig: cfg.K8sKubeconfig,
				Namespace:  cfg.K8sNamespace,
			},
			JobConfig: &k8s.JobConfig{
				Namespace:        cfg.K8sNamespace,
				ImagePullSecrets: cfg.K8sImagePullSecrets,
			},
		}
		logger.Info("using K8s job driver", slog.String("namespace", cfg.K8sNamespace))
		return driver.NewK8sDriver(emitter, k8sCfg)
	default:
		logger.Info("using subprocess driver")
		return driver.NewLocalSubprocessDriver(emitter, &driver.SubprocessConfig{
			EnvPassthrough: map[string]string{
				"ORCHESTRATOR_URL": "http://localhost:" + cfg.Port,
			},
		}), nil
	}
}

// CreateAgentRegistry initializes an AgentRegistry based on the provided configuration.
func CreateAgentRegistry(cfg *config.Config, logger *slog.Logger) (registry.AgentRegistry, error) {
	if cfg.RunStoreType == "redis" {
		opts, err := ResolveRedisOptions(cfg)
		if err != nil {
			return nil, err
		}
		redisRegistry, err := registry.NewRedisRegistry(&registry.RedisConfig{
			Addr:     opts.Addr,
			Password: opts.Password,
			DB:       opts.DB,
		})
		if err != nil {
			if ferr := handleStoreFallback(cfg, logger, "agent registry", err); ferr != nil {
				return nil, ferr
			}
			return registry.NewMemoryRegistryWithDefaults(), nil
		}
		if err := redisRegistry.SeedDefaultAgents(context.Background()); err != nil {
			logger.Error("failed to seed Redis agent defaults", "error", err)
			return nil, err
		}
		logger.Info("using Redis agent registry")
		return redisRegistry, nil
	}
	logger.Info("using in-memory agent registry with defaults")
	return registry.NewMemoryRegistryWithDefaults(), nil
}

// CreateFlowStore initializes a FlowStore based on the provided configuration.
func CreateFlowStore(cfg *config.Config, logger *slog.Logger) (flowstore.FlowStore, error) {
	if cfg.RunStoreType == "redis" {
		opts, err := ResolveRedisOptions(cfg)
		if err != nil {
			return nil, err
		}
		redisFlows, err := flowstore.NewRedisStoreFromOptions(opts)
		if err != nil {
			if ferr := handleStoreFallback(cfg, logger, "flow store", err); ferr != nil {
				return nil, ferr
			}
			return flowstore.NewMemoryStore(), nil
		}
		logger.Info("using Redis flow store")
		return redisFlows, nil
	}
	logger.Info("using in-memory flow store")
	return flowstore.NewMemoryStore(), nil
}

// ResolveRedisOptions builds redis.Options from configuration, parsing the
// redis:// URL (so a DB index like redis://host:6379/2 is honored) and
// overlaying explicit REDIS_PASSWORD / REDIS_DB when set. Centralizes URL
// parsing so every Redis client in the orchestrator behaves consistently.
func ResolveRedisOptions(cfg *config.Config) (*redis.Options, error) {
	opts := &redis.Options{Addr: cfg.RedisURL, Password: cfg.RedisPassword, DB: cfg.RedisDB}
	if cfg.RedisURL != "" {
		parsed, err := redis.ParseURL(cfg.RedisURL)
		if err != nil {
			return nil, fmt.Errorf("parse redis url %q: %w", cfg.RedisURL, err)
		}
		opts.Addr = parsed.Addr
		if parsed.Password != "" && cfg.RedisPassword == "" {
			opts.Password = parsed.Password
		}
		if parsed.DB != 0 && cfg.RedisDB == 0 {
			opts.DB = parsed.DB
		}
	}
	return opts, nil
}

// handleStoreFallback decides whether a Redis store creation failure hard-fails
// (the default) or falls back to memory (only when AllowMemoryFallback is set).
// Any fallback is loud — WARN + metric — so it is never silent.
func handleStoreFallback(cfg *config.Config, logger *slog.Logger, name string, cause error) error {
	if cause == nil {
		return nil
	}
	if !cfg.AllowMemoryFallback {
		return fmt.Errorf("redis %s unavailable and ORCH_ALLOW_MEMORY_FALLBACK is not set: %w", name, cause)
	}
	metrics.RunStoreFallbackTotal.Inc()
	logger.Warn("Redis "+name+" unavailable, falling back to in-memory store (ORCH_ALLOW_MEMORY_FALLBACK=true) — data will NOT persist across restarts",
		"error", cause)
	return nil
}

// CreateCommandResolver returns a function that resolves node specs to command lines.
func CreateCommandResolver(cfg *config.Config) scheduler.CommandResolver {
	return func(node *types.NodeSpec) []string {
		if len(node.Command) > 0 {
			return node.Command
		}
		return nil
	}
}
