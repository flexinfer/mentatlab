package factories

import (
	"io"
	"log/slog"
	"testing"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestResolveRedisOptions_ParsesDBIndex(t *testing.T) {
	opts, err := ResolveRedisOptions(&config.Config{RedisURL: "redis://localhost:6379/7"})
	if err != nil {
		t.Fatalf("ResolveRedisOptions: %v", err)
	}
	if opts.Addr != "localhost:6379" {
		t.Errorf("Addr = %q, want localhost:6379", opts.Addr)
	}
	if opts.DB != 7 {
		t.Errorf("DB = %d, want 7 (db index must be parsed from URL, not treated as part of the host)", opts.DB)
	}
}

func TestResolveRedisOptions_ExplicitDBOverridesZeroURLDB(t *testing.T) {
	opts, err := ResolveRedisOptions(&config.Config{RedisURL: "redis://localhost:6379", RedisDB: 3})
	if err != nil {
		t.Fatalf("ResolveRedisOptions: %v", err)
	}
	if opts.DB != 3 {
		t.Errorf("DB = %d, want 3 (explicit REDIS_DB)", opts.DB)
	}
}

func TestResolveRedisOptions_BadURL(t *testing.T) {
	if _, err := ResolveRedisOptions(&config.Config{RedisURL: "://not a url"}); err == nil {
		t.Fatal("expected error for malformed redis url")
	}
}

// With an unreachable Redis and fallback disabled (the default), store
// creation must hard-fail rather than silently degrade to memory.
func TestCreateStores_FailFastWhenFallbackDisabled(t *testing.T) {
	cfg := &config.Config{
		RunStoreType:        "redis",
		RedisURL:            "redis://127.0.0.1:1", // connection refused
		AllowMemoryFallback: false,
	}
	if _, err := CreateAgentRegistry(cfg, discardLogger()); err == nil {
		t.Error("CreateAgentRegistry: expected error (fallback disabled), got nil")
	}
	if _, err := CreateFlowStore(cfg, discardLogger()); err == nil {
		t.Error("CreateFlowStore: expected error (fallback disabled), got nil")
	}
}

// With fallback explicitly enabled, store creation degrades to memory.
func TestCreateStores_FallbackWhenEnabled(t *testing.T) {
	cfg := &config.Config{
		RunStoreType:        "redis",
		RedisURL:            "redis://127.0.0.1:1",
		AllowMemoryFallback: true,
	}
	reg, err := CreateAgentRegistry(cfg, discardLogger())
	if err != nil || reg == nil {
		t.Errorf("CreateAgentRegistry: want memory fallback, got reg=%v err=%v", reg, err)
	}
	fs, err := CreateFlowStore(cfg, discardLogger())
	if err != nil || fs == nil {
		t.Errorf("CreateFlowStore: want memory fallback, got fs=%v err=%v", fs, err)
	}
}
