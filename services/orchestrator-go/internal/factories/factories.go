package factories

import (
	"log/slog"
	"strings"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/driver"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/k8s"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/metrics"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/scheduler"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
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
		redisAddr := strings.TrimPrefix(cfg.RedisURL, "redis://")
		registryCfg := &registry.RedisConfig{
			Addr:     redisAddr,
			Password: cfg.RedisPassword,
			DB:       cfg.RedisDB,
		}
		redisRegistry, err := registry.NewRedisRegistry(registryCfg)
		if err != nil {
			logger.Warn("failed to create Redis agent registry, using memory", "error", err)
			return registry.NewMemoryRegistryWithDefaults(), nil
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
		redisAddr := strings.TrimPrefix(cfg.RedisURL, "redis://")
		redisFlows, err := flowstore.NewRedisStore(redisAddr)
		if err != nil {
			logger.Warn("failed to create Redis flow store, using memory", "error", err)
			return flowstore.NewMemoryStore(), nil
		}
		logger.Info("using Redis flow store")
		return redisFlows, nil
	}
	logger.Info("using in-memory flow store")
	return flowstore.NewMemoryStore(), nil
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
