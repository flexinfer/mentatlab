package driver

import (
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	defaultHeartbeatTimeout = 60 * time.Second
	heartbeatTimeoutEnvVar  = "MENTAT_HEARTBEAT_TIMEOUT"
)

type driverEventState struct {
	sawRetryable  atomic.Int32
	sawHeartbeat  atomic.Int32
	lastHeartbeat atomic.Int64
}

func (s *driverEventState) markRetryable() {
	s.sawRetryable.Store(1)
}

func (s *driverEventState) retryable() bool {
	return s.sawRetryable.Load() != 0
}

func (s *driverEventState) noteHeartbeat(now time.Time) {
	s.sawHeartbeat.Store(1)
	s.lastHeartbeat.Store(now.UTC().UnixNano())
}

func (s *driverEventState) hasHeartbeat() bool {
	return s.sawHeartbeat.Load() != 0
}

func (s *driverEventState) heartbeatExpired(now time.Time, timeout time.Duration) bool {
	if !s.hasHeartbeat() {
		return false
	}
	last := s.lastHeartbeat.Load()
	if last == 0 {
		return false
	}
	return now.Sub(time.Unix(0, last).UTC()) > timeout
}

func resolveHeartbeatTimeout(env map[string]string) time.Duration {
	if env == nil {
		return defaultHeartbeatTimeout
	}

	raw := strings.TrimSpace(env[heartbeatTimeoutEnvVar])
	if raw == "" {
		return defaultHeartbeatTimeout
	}

	if dur, err := time.ParseDuration(raw); err == nil && dur > 0 {
		return dur
	}

	if seconds, err := strconv.ParseFloat(raw, 64); err == nil && seconds > 0 {
		return time.Duration(seconds * float64(time.Second))
	}

	return defaultHeartbeatTimeout
}

func heartbeatPollInterval(timeout time.Duration) time.Duration {
	interval := timeout / 4
	switch {
	case interval <= 0:
		return 250 * time.Millisecond
	case interval < 25*time.Millisecond:
		return 25 * time.Millisecond
	case interval > time.Second:
		return time.Second
	default:
		return interval
	}
}
