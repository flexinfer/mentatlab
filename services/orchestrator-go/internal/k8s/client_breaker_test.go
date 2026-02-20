package k8s

import (
	"strings"
	"testing"
	"time"

	"github.com/sony/gobreaker"
)

func TestClient_BreakerGuard_NilBreaker(t *testing.T) {
	c := &Client{}
	done, err := c.breakerGuard()
	if err != nil {
		t.Fatalf("breakerGuard with nil breaker: %v", err)
	}
	// Should be a no-op
	done(true)
	done(false)
}

func TestClient_BreakerGuard_ClosedState(t *testing.T) {
	cb := gobreaker.NewTwoStepCircuitBreaker(gobreaker.Settings{
		Name:        "k8s-test",
		MaxRequests: 1,
		Timeout:     30 * time.Second,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= 5
		},
	})

	c := &Client{breaker: cb}
	done, err := c.breakerGuard()
	if err != nil {
		t.Fatalf("breakerGuard in closed state: %v", err)
	}
	done(true) // report success
}

func TestClient_BreakerOpensAfterConsecutiveFailures(t *testing.T) {
	cb := gobreaker.NewTwoStepCircuitBreaker(gobreaker.Settings{
		Name:        "k8s-test",
		MaxRequests: 1,
		Timeout:     30 * time.Second,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= 5
		},
	})

	c := &Client{breaker: cb}

	// Simulate 5 consecutive failures
	for i := 0; i < 5; i++ {
		done, err := c.breakerGuard()
		if err != nil {
			t.Fatalf("call %d: unexpected breaker error: %v", i, err)
		}
		done(false) // report failure
	}

	// 6th call should be rejected by circuit breaker
	_, err := c.breakerGuard()
	if err == nil {
		t.Fatal("expected circuit breaker error after 5 failures")
	}
	if !strings.Contains(err.Error(), "circuit breaker open") {
		t.Errorf("expected circuit breaker open error, got: %v", err)
	}
}

func TestClient_BreakerResetsOnSuccess(t *testing.T) {
	cb := gobreaker.NewTwoStepCircuitBreaker(gobreaker.Settings{
		Name:        "k8s-test",
		MaxRequests: 1,
		Timeout:     30 * time.Second,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= 5
		},
	})

	c := &Client{breaker: cb}

	// Cause 3 consecutive failures
	for i := 0; i < 3; i++ {
		done, _ := c.breakerGuard()
		done(false)
	}

	// Success resets consecutive count
	done, _ := c.breakerGuard()
	done(true)

	// Need 5 more consecutive failures to trip
	for i := 0; i < 5; i++ {
		done, err := c.breakerGuard()
		if err != nil {
			t.Fatalf("call %d: breaker tripped too early after reset: %v", i, err)
		}
		done(false)
	}

	// 6th call (after 5 consecutive failures) should be rejected
	_, err := c.breakerGuard()
	if err == nil {
		t.Fatal("expected circuit breaker error after 5 consecutive failures")
	}
}

func TestClient_BreakerHalfOpenAfterTimeout(t *testing.T) {
	cb := gobreaker.NewTwoStepCircuitBreaker(gobreaker.Settings{
		Name:        "k8s-test",
		MaxRequests: 1,
		Timeout:     100 * time.Millisecond,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= 5
		},
	})

	c := &Client{breaker: cb}

	// Trip the breaker
	for i := 0; i < 5; i++ {
		done, _ := c.breakerGuard()
		done(false)
	}

	// Verify it's open
	_, err := c.breakerGuard()
	if err == nil {
		t.Fatal("expected circuit breaker to be open")
	}

	// Wait for timeout
	time.Sleep(150 * time.Millisecond)

	// Should allow one probe request (half-open)
	done, err := c.breakerGuard()
	if err != nil {
		t.Fatalf("expected half-open to allow probe, got: %v", err)
	}

	// Successful probe should close the breaker
	done(true)

	// Should be closed now — multiple requests allowed
	for i := 0; i < 3; i++ {
		done, err = c.breakerGuard()
		if err != nil {
			t.Fatalf("call %d after close: unexpected error: %v", i, err)
		}
		done(true)
	}
}
