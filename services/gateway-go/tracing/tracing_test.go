package tracing

import (
	"context"
	"io"
	"log/slog"
	"testing"
)

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg.ServiceName != "mentatlab-gateway" {
		t.Errorf("expected ServiceName 'mentatlab-gateway', got %q", cfg.ServiceName)
	}
	if cfg.ServiceVersion != "1.0.0" {
		t.Errorf("expected ServiceVersion '1.0.0', got %q", cfg.ServiceVersion)
	}
	if cfg.OTLPEndpoint != "localhost:4317" {
		t.Errorf("expected OTLPEndpoint 'localhost:4317', got %q", cfg.OTLPEndpoint)
	}
	if cfg.Enabled {
		t.Error("expected Enabled=false by default")
	}
	if cfg.SampleRate != 1.0 {
		t.Errorf("expected SampleRate 1.0, got %f", cfg.SampleRate)
	}
}

func TestInitDisabled(t *testing.T) {
	ctx := context.Background()

	t.Run("nil config defaults to disabled", func(t *testing.T) {
		p, err := Init(ctx, nil, silentLogger())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p == nil {
			t.Fatal("expected non-nil provider")
		}
		if p.provider != nil {
			t.Error("expected nil underlying provider when disabled")
		}
	})

	t.Run("explicit disabled", func(t *testing.T) {
		p, err := Init(ctx, &Config{Enabled: false}, silentLogger())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.provider != nil {
			t.Error("expected nil underlying provider when disabled")
		}
	})

	t.Run("nil logger uses default", func(t *testing.T) {
		p, err := Init(ctx, &Config{Enabled: false}, nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p == nil {
			t.Fatal("expected non-nil provider")
		}
	})
}

func TestShutdown(t *testing.T) {
	t.Run("nil provider is safe", func(t *testing.T) {
		p := &Provider{provider: nil, logger: silentLogger()}
		err := p.Shutdown(context.Background())
		if err != nil {
			t.Errorf("expected nil error for nil provider, got %v", err)
		}
	})
}

func TestTracerProvider(t *testing.T) {
	t.Run("returns nil when disabled", func(t *testing.T) {
		p, err := Init(context.Background(), &Config{Enabled: false}, silentLogger())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.TracerProvider() != nil {
			t.Error("expected nil TracerProvider when disabled")
		}
	})
}

func TestInitEnabled(t *testing.T) {
	// Use a non-routable address so the exporter is created but won't connect.
	// The OTLP exporter creation itself should succeed (connection is lazy).
	ctx := context.Background()
	cfg := &Config{
		ServiceName:    "test-service",
		ServiceVersion: "0.1.0",
		OTLPEndpoint:   "127.0.0.1:14317",
		Enabled:        true,
		SampleRate:     0.5,
	}

	p, err := Init(ctx, cfg, silentLogger())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p == nil {
		t.Fatal("expected non-nil provider")
	}
	if p.provider == nil {
		t.Error("expected non-nil underlying provider when enabled")
	}
	if p.TracerProvider() == nil {
		t.Error("TracerProvider() should return non-nil when enabled")
	}

	// Clean shutdown
	if err := p.Shutdown(ctx); err != nil {
		t.Errorf("shutdown error: %v", err)
	}
}
