package config

import (
	"os"
	"testing"
	"time"
)

func TestLoad_Defaults(t *testing.T) {
	// Unset any env vars that could affect defaults
	for _, key := range []string{
		"PORT", "ORCH_RUNSTORE", "REDIS_URL", "ORCH_DRIVER",
		"LOG_LEVEL", "LOG_FORMAT", "ORCH_ALLOW_MEMORY_FALLBACK",
		"TRACING_ENABLED", "OIDC_ENABLED",
	} {
		t.Setenv(key, "")
		os.Unsetenv(key)
	}

	cfg := Load()

	if cfg.Port != "7070" {
		t.Errorf("Port: got %q, want %q", cfg.Port, "7070")
	}
	if cfg.RunStoreType != "memory" {
		t.Errorf("RunStoreType: got %q, want %q", cfg.RunStoreType, "memory")
	}
	if cfg.RedisURL != "redis://localhost:6379" {
		t.Errorf("RedisURL: got %q, want %q", cfg.RedisURL, "redis://localhost:6379")
	}
	if cfg.DriverType != "subprocess" {
		t.Errorf("DriverType: got %q, want %q", cfg.DriverType, "subprocess")
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel: got %q, want %q", cfg.LogLevel, "info")
	}
	if cfg.LogFormat != "json" {
		t.Errorf("LogFormat: got %q, want %q", cfg.LogFormat, "json")
	}
	if cfg.AllowMemoryFallback != false {
		t.Errorf("AllowMemoryFallback: got %v, want false", cfg.AllowMemoryFallback)
	}
	if cfg.TracingEnabled != false {
		t.Errorf("TracingEnabled: got %v, want false", cfg.TracingEnabled)
	}
	if cfg.OIDCEnabled != false {
		t.Errorf("OIDCEnabled: got %v, want false", cfg.OIDCEnabled)
	}
	if cfg.RunStoreTTL != 7*24*time.Hour {
		t.Errorf("RunStoreTTL: got %v, want %v", cfg.RunStoreTTL, 7*24*time.Hour)
	}
	if cfg.MaxParallelism != 0 {
		t.Errorf("MaxParallelism: got %d, want 0", cfg.MaxParallelism)
	}
	if cfg.RateLimitRPS != 100.0 {
		t.Errorf("RateLimitRPS: got %f, want 100.0", cfg.RateLimitRPS)
	}
	if cfg.AgentContextEnabled != true {
		t.Errorf("AgentContextEnabled: got %v, want true", cfg.AgentContextEnabled)
	}
	if cfg.AgentContextAgentID != "mentatlab-orchestrator" {
		t.Errorf("AgentContextAgentID: got %q, want %q", cfg.AgentContextAgentID, "mentatlab-orchestrator")
	}
	if cfg.LoomBin != "loom" {
		t.Errorf("LoomBin: got %q, want %q", cfg.LoomBin, "loom")
	}
	if cfg.MCPHubURL != "wss://mcp.flexinfer.ai/ws" {
		t.Errorf("MCPHubURL: got %q, want %q", cfg.MCPHubURL, "wss://mcp.flexinfer.ai/ws")
	}
	if cfg.MCPHubProfile != "codex" {
		t.Errorf("MCPHubProfile: got %q, want %q", cfg.MCPHubProfile, "codex")
	}
	if cfg.MCPHubServers != "" {
		t.Errorf("MCPHubServers: got %q, want empty string", cfg.MCPHubServers)
	}
}

func TestLoad_EnvOverrides(t *testing.T) {
	t.Setenv("PORT", "9090")
	t.Setenv("ORCH_RUNSTORE", "redis")
	t.Setenv("REDIS_URL", "redis://redis:6379")
	t.Setenv("ORCH_DRIVER", "k8s")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("LOG_FORMAT", "text")
	t.Setenv("ORCH_ALLOW_MEMORY_FALLBACK", "true")
	t.Setenv("TRACING_ENABLED", "true")
	t.Setenv("OIDC_ENABLED", "true")
	t.Setenv("ORCH_MAX_PARALLELISM", "10")
	t.Setenv("RATE_LIMIT_RPS", "50.0")
	t.Setenv("RATE_LIMIT_BURST", "100")
	t.Setenv("K8S_NAMESPACE", "test-ns")
	t.Setenv("CORS_ORIGINS", "http://a.com,http://b.com")
	t.Setenv("ORCH_AGENT_CONTEXT_ENABLED", "false")
	t.Setenv("ORCH_AGENT_CONTEXT_AGENT_ID", "agent-x")
	t.Setenv("ORCH_AGENT_CONTEXT_NAMESPACE", "mentatlab")
	t.Setenv("LOOM_BIN", "/usr/local/bin/loom")
	t.Setenv("MCP_HUB_URL", "wss://mcp.example/ws")
	t.Setenv("MCP_HUB_CATALOG_URL", "https://mcp.example/openapi.json")
	t.Setenv("MCP_HUB_PROFILE", "full")
	t.Setenv("MCP_HUB_SERVERS", "time,gitlab")
	t.Setenv("CF_ACCESS_CLIENT_ID", "cf-id")
	t.Setenv("CF_ACCESS_CLIENT_SECRET", "cf-secret")
	t.Setenv("MCP_HUB_TOKEN", "hub-token")

	cfg := Load()

	if cfg.Port != "9090" {
		t.Errorf("Port: got %q, want %q", cfg.Port, "9090")
	}
	if cfg.RunStoreType != "redis" {
		t.Errorf("RunStoreType: got %q, want %q", cfg.RunStoreType, "redis")
	}
	if cfg.RedisURL != "redis://redis:6379" {
		t.Errorf("RedisURL: got %q, want %q", cfg.RedisURL, "redis://redis:6379")
	}
	if cfg.DriverType != "k8s" {
		t.Errorf("DriverType: got %q, want %q", cfg.DriverType, "k8s")
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel: got %q, want %q", cfg.LogLevel, "debug")
	}
	if cfg.AllowMemoryFallback != true {
		t.Errorf("AllowMemoryFallback: got %v, want true", cfg.AllowMemoryFallback)
	}
	if cfg.TracingEnabled != true {
		t.Errorf("TracingEnabled: got %v, want true", cfg.TracingEnabled)
	}
	if cfg.MaxParallelism != 10 {
		t.Errorf("MaxParallelism: got %d, want 10", cfg.MaxParallelism)
	}
	if cfg.RateLimitRPS != 50.0 {
		t.Errorf("RateLimitRPS: got %f, want 50.0", cfg.RateLimitRPS)
	}
	if cfg.K8sNamespace != "test-ns" {
		t.Errorf("K8sNamespace: got %q, want %q", cfg.K8sNamespace, "test-ns")
	}
	if len(cfg.CORSOrigins) != 2 || cfg.CORSOrigins[0] != "http://a.com" {
		t.Errorf("CORSOrigins: got %v, want [http://a.com http://b.com]", cfg.CORSOrigins)
	}
	if cfg.AgentContextEnabled != false {
		t.Errorf("AgentContextEnabled: got %v, want false", cfg.AgentContextEnabled)
	}
	if cfg.AgentContextAgentID != "agent-x" {
		t.Errorf("AgentContextAgentID: got %q, want %q", cfg.AgentContextAgentID, "agent-x")
	}
	if cfg.AgentContextNamespace != "mentatlab" {
		t.Errorf("AgentContextNamespace: got %q, want %q", cfg.AgentContextNamespace, "mentatlab")
	}
	if cfg.LoomBin != "/usr/local/bin/loom" {
		t.Errorf("LoomBin: got %q, want %q", cfg.LoomBin, "/usr/local/bin/loom")
	}
	if cfg.MCPHubURL != "wss://mcp.example/ws" {
		t.Errorf("MCPHubURL: got %q, want %q", cfg.MCPHubURL, "wss://mcp.example/ws")
	}
	if cfg.MCPHubCatalogURL != "https://mcp.example/openapi.json" {
		t.Errorf("MCPHubCatalogURL: got %q, want %q", cfg.MCPHubCatalogURL, "https://mcp.example/openapi.json")
	}
	if cfg.MCPHubProfile != "full" {
		t.Errorf("MCPHubProfile: got %q, want %q", cfg.MCPHubProfile, "full")
	}
	if cfg.MCPHubServers != "time,gitlab" {
		t.Errorf("MCPHubServers: got %q, want %q", cfg.MCPHubServers, "time,gitlab")
	}
	if cfg.CFAccessClientID != "cf-id" {
		t.Errorf("CFAccessClientID: got %q, want %q", cfg.CFAccessClientID, "cf-id")
	}
	if cfg.CFAccessClientSecret != "cf-secret" {
		t.Errorf("CFAccessClientSecret: got %q, want %q", cfg.CFAccessClientSecret, "cf-secret")
	}
	if cfg.MCPHubToken != "hub-token" {
		t.Errorf("MCPHubToken: got %q, want %q", cfg.MCPHubToken, "hub-token")
	}
}

func TestGetEnv_Default(t *testing.T) {
	os.Unsetenv("TEST_MISSING_VAR")
	val := getEnv("TEST_MISSING_VAR", "fallback")
	if val != "fallback" {
		t.Errorf("getEnv: got %q, want %q", val, "fallback")
	}
}

func TestGetInt_InvalidFallsToDefault(t *testing.T) {
	t.Setenv("TEST_BAD_INT", "notanumber")
	val := getInt("TEST_BAD_INT", 42)
	if val != 42 {
		t.Errorf("getInt: got %d, want 42", val)
	}
}

func TestGetFloat_InvalidFallsToDefault(t *testing.T) {
	t.Setenv("TEST_BAD_FLOAT", "notafloat")
	val := getFloat("TEST_BAD_FLOAT", 3.14)
	if val != 3.14 {
		t.Errorf("getFloat: got %f, want 3.14", val)
	}
}

func TestGetBool_InvalidFallsToDefault(t *testing.T) {
	t.Setenv("TEST_BAD_BOOL", "maybe")
	val := getBool("TEST_BAD_BOOL", true)
	if val != true {
		t.Errorf("getBool: got %v, want true", val)
	}
}

func TestGetDuration_ValidParsing(t *testing.T) {
	t.Setenv("TEST_DURATION", "5m")
	val := getDuration("TEST_DURATION", time.Second)
	if val != 5*time.Minute {
		t.Errorf("getDuration: got %v, want 5m", val)
	}
}

func TestGetDuration_InvalidFallsToDefault(t *testing.T) {
	t.Setenv("TEST_DURATION", "badvalue")
	val := getDuration("TEST_DURATION", 10*time.Second)
	if val != 10*time.Second {
		t.Errorf("getDuration: got %v, want 10s", val)
	}
}

func TestGetInt64_ValidParsing(t *testing.T) {
	t.Setenv("TEST_INT64", "9999")
	val := getInt64("TEST_INT64", 0)
	if val != 9999 {
		t.Errorf("getInt64: got %d, want 9999", val)
	}
}

func TestGetStringSlice_Empty(t *testing.T) {
	os.Unsetenv("TEST_SLICE")
	val := getStringSlice("TEST_SLICE", nil)
	if val != nil {
		t.Errorf("getStringSlice: got %v, want nil", val)
	}
}
