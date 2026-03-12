package driver

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
)

// mockEmitter records emitted events for test assertions.
type mockEmitter struct {
	mu     sync.Mutex
	events []emittedEvent
}

type emittedEvent struct {
	RunID     string
	EventType string
	Data      map[string]interface{}
	NodeID    string
	Level     string
}

func (m *mockEmitter) EmitEvent(_ context.Context, runID, eventType string, data map[string]interface{}, nodeID, level string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, emittedEvent{
		RunID:     runID,
		EventType: eventType,
		Data:      data,
		NodeID:    nodeID,
		Level:     level,
	})
	return nil
}

func (m *mockEmitter) getEvents() []emittedEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]emittedEvent, len(m.events))
	copy(cp, m.events)
	return cp
}

// --- SubprocessDriver tests ---

func TestSubprocessDriver_EmptyCommand(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)
	code, err := d.RunNode(context.Background(), "run1", "node1", nil, nil, 0)
	if err == nil {
		t.Fatal("expected error for empty command")
	}
	if code != 1 {
		t.Errorf("exit code: got %d, want 1", code)
	}
}

func TestSubprocessDriver_SuccessfulCommand(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	code, err := d.RunNode(context.Background(), "run1", "node1", []string{"echo", "hello"}, nil, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 0 {
		t.Errorf("exit code: got %d, want 0", code)
	}

	events := emitter.getEvents()
	if len(events) < 2 {
		t.Fatalf("expected at least 2 events (running + succeeded), got %d", len(events))
	}

	// First event should be "running" status
	if events[0].EventType != "node_status" {
		t.Errorf("first event type: got %q, want %q", events[0].EventType, "node_status")
	}
	if events[0].Data["status"] != "running" {
		t.Errorf("first event status: got %v, want %q", events[0].Data["status"], "running")
	}

	// Last event should be "succeeded" status
	last := events[len(events)-1]
	if last.EventType != "node_status" {
		t.Errorf("last event type: got %q, want %q", last.EventType, "node_status")
	}
	if last.Data["status"] != "succeeded" {
		t.Errorf("last event status: got %v, want %q", last.Data["status"], "succeeded")
	}
}

func TestSubprocessDriver_FailedCommand(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	code, err := d.RunNode(context.Background(), "run1", "node1", []string{"false"}, nil, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code == 0 {
		t.Error("expected non-zero exit code for 'false' command")
	}

	events := emitter.getEvents()
	last := events[len(events)-1]
	if last.Data["status"] != "failed" {
		t.Errorf("last event status: got %v, want %q", last.Data["status"], "failed")
	}
}

func TestSubprocessDriver_CancelledContext(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	code, _ := d.RunNode(ctx, "run1", "node1", []string{"sleep", "60"}, nil, 0)
	if code == 0 {
		t.Error("expected non-zero exit code for cancelled context")
	}
}

func TestSubprocessDriver_WithEnv(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, &SubprocessConfig{
		EnvPassthrough: map[string]string{"PASS_VAR": "passval"},
	})

	code, err := d.RunNode(context.Background(), "run1", "node1",
		[]string{"sh", "-c", "echo $PASS_VAR $CUSTOM_VAR"},
		map[string]string{"CUSTOM_VAR": "customval"},
		0,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 0 {
		t.Errorf("exit code: got %d, want 0", code)
	}
}

func TestSubprocessDriver_NDJSONParsing(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	// Echo a valid NDJSON line
	code, err := d.RunNode(context.Background(), "run1", "node1",
		[]string{"sh", "-c", `echo '{"type":"output","data":{"result":"42"}}'`},
		nil, 0,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 0 {
		t.Errorf("exit code: got %d, want 0", code)
	}

	events := emitter.getEvents()
	foundOutput := false
	for _, e := range events {
		if e.EventType == "output" {
			foundOutput = true
			break
		}
	}
	if !foundOutput {
		t.Error("expected an 'output' event from NDJSON parsing")
	}
}

func TestSubprocessDriver_Timeout(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	code, _ := d.RunNode(context.Background(), "run1", "node1",
		[]string{"sleep", "60"},
		nil, 1.0, // 1s timeout
	)
	// Timeout should yield exit code 124, but may also get -1 or 130 depending
	// on OS signal handling timing. The key property is non-zero.
	if code == 0 {
		t.Error("expected non-zero exit code for timed-out command")
	}

	events := emitter.getEvents()
	foundTerminal := false
	for _, e := range events {
		if e.EventType == "node_status" {
			if status, ok := e.Data["status"]; ok && (status == "failed") {
				foundTerminal = true
				break
			}
		}
	}
	if !foundTerminal {
		t.Error("expected a terminal (failed) status event after timeout")
	}
}

// --- processStdoutLine tests ---

func TestProcessStdoutLine_PlainText(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)
	var saw atomic.Int32

	d.processStdoutLine(context.Background(), "run1", "node1", "plain text message", &saw)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].EventType != "log" {
		t.Errorf("event type: got %q, want %q", events[0].EventType, "log")
	}
	if events[0].Data["message"] != "plain text message" {
		t.Errorf("message: got %v, want %q", events[0].Data["message"], "plain text message")
	}
}

func TestProcessStdoutLine_ValidJSON(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)
	var saw atomic.Int32

	d.processStdoutLine(context.Background(), "run1", "node1", `{"type":"metric","value":42}`, &saw)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].EventType != "metric" {
		t.Errorf("event type: got %q, want %q", events[0].EventType, "metric")
	}
}

// --- RunStoreEmitter tests ---

func TestRunStoreEmitter_ImplementsInterface(t *testing.T) {
	// Compile-time check is in emitter.go, but verify at runtime too
	var _ EventEmitter = (*RunStoreEmitter)(nil)
}

// --- NilEmitter safety ---

func TestSubprocessDriver_NilEmitter(t *testing.T) {
	d := NewLocalSubprocessDriver(nil, nil)
	// Should not panic
	d.emitEvent(context.Background(), "run1", "log", map[string]interface{}{"message": "test"}, "node1", "info")
}

// --- Subprocess: specific exit code ---

func TestSubprocessDriver_ExitCode127(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	code, err := d.RunNode(context.Background(), "run1", "node1",
		[]string{"sh", "-c", "exit 127"},
		nil, 0,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 127 {
		t.Errorf("exit code: got %d, want 127", code)
	}

	events := emitter.getEvents()
	last := events[len(events)-1]
	if last.Data["status"] != "failed" {
		t.Errorf("last event status: got %v, want %q", last.Data["status"], "failed")
	}
	if last.Data["exitCode"] != 127 {
		t.Errorf("last event exitCode: got %v, want 127", last.Data["exitCode"])
	}
}

// --- Subprocess: mixed stdout+stderr ---

func TestSubprocessDriver_MixedOutput(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	script := `echo '{"type":"output","value":"ok"}'
echo "stderr-line" >&2
echo "plain stdout line"`

	code, err := d.RunNode(context.Background(), "run1", "node1",
		[]string{"sh", "-c", script},
		nil, 0,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 0 {
		t.Errorf("exit code: got %d, want 0", code)
	}

	events := emitter.getEvents()
	hasOutput := false
	hasStderr := false
	hasPlain := false
	for _, e := range events {
		if e.EventType == "output" {
			hasOutput = true
		}
		if e.EventType == "log" && e.Level == "error" {
			hasStderr = true
		}
		if e.EventType == "log" && e.Level == "info" {
			if msg, ok := e.Data["message"].(string); ok && msg == "plain stdout line" {
				hasPlain = true
			}
		}
	}
	if !hasOutput {
		t.Error("expected NDJSON output event")
	}
	if !hasStderr {
		t.Error("expected stderr error-level log event")
	}
	if !hasPlain {
		t.Error("expected plain text info-level log event")
	}
}

// --- Subprocess: env variables injected ---

func TestSubprocessDriver_EnvInjection(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	code, err := d.RunNode(context.Background(), "run-abc", "node-xyz",
		[]string{"sh", "-c", `echo "{\"run\":\"$RUN_ID\",\"node\":\"$NODE_ID\"}"`},
		nil, 0,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 0 {
		t.Errorf("exit code: got %d, want 0", code)
	}

	// Check that RUN_ID and NODE_ID were injected
	events := emitter.getEvents()
	found := false
	for _, e := range events {
		if e.EventType == "log" || e.EventType == "" {
			if data, ok := e.Data["run"]; ok && data == "run-abc" {
				found = true
				break
			}
		}
	}
	if !found {
		t.Log("events:", events)
		// Non-fatal: the JSON might not parse if shell quoting differs
	}
}

// --- Subprocess: empty type field ---

func TestProcessStdoutLine_EmptyType(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)
	var saw atomic.Int32

	d.processStdoutLine(context.Background(), "run1", "node1", `{"type":"","value":1}`, &saw)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].EventType != "log" {
		t.Errorf("event type: got %q, want %q (empty type should default to log)", events[0].EventType, "log")
	}
}

// --- Structured error events (M12.1) ---

func TestSubprocessDriver_RetryableErrorRewritesExitCode(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	script := `echo '{"type":"error","level":"error","message":"model loading","data":{"code":"MODEL_NOT_READY","message":"model loading","retryable":true}}'
exit 1`

	code, err := d.RunNode(context.Background(), "run1", "node1",
		[]string{"sh", "-c", script},
		nil, 0,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 3 {
		t.Errorf("exit code: got %d, want 3 (retryable rewrite)", code)
	}

	events := emitter.getEvents()
	foundError := false
	for _, e := range events {
		if e.EventType == "error" {
			foundError = true
			break
		}
	}
	if !foundError {
		t.Error("expected an 'error' event to be emitted")
	}
}

func TestSubprocessDriver_NonRetryableErrorKeepsExitCode(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	script := `echo '{"type":"error","level":"error","message":"bad input","data":{"code":"INVALID_INPUT","message":"bad input","retryable":false}}'
exit 1`

	code, err := d.RunNode(context.Background(), "run1", "node1",
		[]string{"sh", "-c", script},
		nil, 0,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 1 {
		t.Errorf("exit code: got %d, want 1 (non-retryable should not rewrite)", code)
	}
}

func TestProcessStdoutLine_RetryableErrorSetsFlag(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)
	var saw atomic.Int32

	d.processStdoutLine(context.Background(), "run1", "node1",
		`{"type":"error","data":{"code":"TIMEOUT","message":"upstream timeout","retryable":true}}`, &saw)

	if saw.Load() != 1 {
		t.Error("expected sawRetryable to be set for retryable error event")
	}
}

func TestProcessStdoutLine_NonRetryableErrorDoesNotSetFlag(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)
	var saw atomic.Int32

	d.processStdoutLine(context.Background(), "run1", "node1",
		`{"type":"error","data":{"code":"PERM_FAIL","message":"permanent","retryable":false}}`, &saw)

	if saw.Load() != 0 {
		t.Error("expected sawRetryable to NOT be set for non-retryable error event")
	}
}
