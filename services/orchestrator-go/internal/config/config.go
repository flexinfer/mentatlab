// Package config provides configuration loading for the orchestrator service.
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all configuration for the orchestrator service.
type Config struct {
	// Server configuration
	Port           string
	ReadTimeout    time.Duration
	WriteTimeout   time.Duration
	ShutdownGrace  time.Duration

	// Redis configuration
	RedisURL      string
	RedisPassword string
	RedisDB       int

	// RunStore configuration
	RunStoreType string // "memory" or "redis"
	RunStoreTTL  time.Duration
	EventMaxLen  int64

	// OIDC configuration
	OIDCIssuer       string
	OIDCClientID     string
	OIDCClientSecret string
	OIDCEnabled      bool

	// CORS configuration
	CORSOrigins []string

	// Rate limiting
	RateLimitRPS   float64
	RateLimitBurst int

	// K8s configuration
	K8sNamespace  string
	K8sInCluster  bool
	K8sKubeconfig string

	// Scheduler configuration
	MaxParallelism     int
	DefaultMaxRetries  int
	DefaultBackoffSecs int

	// Logging
	LogLevel  string
	LogFormat string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	return &Config{
		// Server
		Port:          getEnv("PORT", "7070"),
		ReadTimeout:   getDuration("READ_TIMEOUT", 30*time.Second),
		WriteTimeout:  getDuration("WRITE_TIMEOUT", 30*time.Second),
		ShutdownGrace: getDuration("SHUTDOWN_GRACE", 10*time.Second),

		// Redis
		RedisURL:      getEnv("REDIS_URL", "redis://localhost:6379"),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),
		RedisDB:       getInt("REDIS_DB", 0),

		// RunStore
		RunStoreType: getEnv("ORCH_RUNSTORE", "memory"), // "memory" or "redis"
		RunStoreTTL:  getDuration("RUNSTORE_TTL", 7*24*time.Hour), // 7 days
		EventMaxLen:  getInt64("EVENT_MAX_LEN", 5000),

		// OIDC
		OIDCIssuer:       getEnv("OIDC_ISSUER", ""),
		OIDCClientID:     getEnv("OIDC_CLIENT_ID", ""),
		OIDCClientSecret: getEnv("OIDC_CLIENT_SECRET", ""),
		OIDCEnabled:      getBool("OIDC_ENABLED", false),

		// CORS
		CORSOrigins: getStringSlice("CORS_ORIGINS", []string{"http://localhost:5173", "http://localhost:3000"}),

		// Rate limiting
		RateLimitRPS:   getFloat("RATE_LIMIT_RPS", 100.0),
		RateLimitBurst: getInt("RATE_LIMIT_BURST", 200),

		// K8s
		K8sNamespace:  getEnv("K8S_NAMESPACE", "mentatlab"),
		K8sInCluster:  getBool("K8S_IN_CLUSTER", false),
		K8sKubeconfig: getEnv("KUBECONFIG", ""),

		// Scheduler
		MaxParallelism:     getInt("ORCH_MAX_PARALLELISM", 0), // 0 = unlimited
		DefaultMaxRetries:  getInt("ORCH_MAX_RETRIES_DEFAULT", 0),
		DefaultBackoffSecs: getInt("ORCH_BACKOFF_SECONDS_DEFAULT", 2),

		// Logging
		LogLevel:  getEnv("LOG_LEVEL", "info"),
		LogFormat: getEnv("LOG_FORMAT", "json"),
	}
}

// Helper functions for environment variable parsing

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

func getInt64(key string, defaultVal int64) int64 {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.ParseInt(val, 10, 64); err == nil {
			return i
		}
	}
	return defaultVal
}

func getFloat(key string, defaultVal float64) float64 {
	if val := os.Getenv(key); val != "" {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			return f
		}
	}
	return defaultVal
}

func getBool(key string, defaultVal bool) bool {
	if val := os.Getenv(key); val != "" {
		if b, err := strconv.ParseBool(val); err == nil {
			return b
		}
	}
	return defaultVal
}

func getDuration(key string, defaultVal time.Duration) time.Duration {
	if val := os.Getenv(key); val != "" {
		if d, err := time.ParseDuration(val); err == nil {
			return d
		}
	}
	return defaultVal
}

func getStringSlice(key string, defaultVal []string) []string {
	if val := os.Getenv(key); val != "" {
		return strings.Split(val, ",")
	}
	return defaultVal
}
