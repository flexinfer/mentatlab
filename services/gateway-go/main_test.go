package main

import (
	"testing"
	"time"
)

func TestLoadConfigWebSocketHeartbeatDurations(t *testing.T) {
	t.Setenv("WS_PONG_WAIT", "45s")
	t.Setenv("WS_PING_PERIOD", "20s")

	cfg := loadConfig()

	if cfg.WSPongWait != 45*time.Second {
		t.Fatalf("expected WSPongWait 45s, got %v", cfg.WSPongWait)
	}
	if cfg.WSPingPeriod != 20*time.Second {
		t.Fatalf("expected WSPingPeriod 20s, got %v", cfg.WSPingPeriod)
	}
}

func TestLoadConfigInvalidWebSocketHeartbeatDurationsUseDefaults(t *testing.T) {
	t.Setenv("WS_PONG_WAIT", "not-a-duration")
	t.Setenv("WS_PING_PERIOD", "-1s")

	cfg := loadConfig()

	if cfg.WSPongWait != 60*time.Second {
		t.Fatalf("expected default WSPongWait 60s, got %v", cfg.WSPongWait)
	}
	if cfg.WSPingPeriod != 54*time.Second {
		t.Fatalf("expected default WSPingPeriod 54s, got %v", cfg.WSPingPeriod)
	}
}
