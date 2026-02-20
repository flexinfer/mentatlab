package driver

import (
	"context"
	"fmt"
	"testing"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// --- K8sDriver.processLogLine tests ---

func TestK8sDriver_ProcessLogLine_PlainStdout(t *testing.T) {
	emitter := &mockEmitter{}
	d := &K8sDriver{emitter: emitter}

	d.processLogLine(context.Background(), "run1", "node1", "plain text output", false)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].EventType != "log" {
		t.Errorf("event type: got %q, want %q", events[0].EventType, "log")
	}
	if events[0].Data["message"] != "plain text output" {
		t.Errorf("message: got %v, want %q", events[0].Data["message"], "plain text output")
	}
	if events[0].Data["level"] != "info" {
		t.Errorf("level: got %v, want %q", events[0].Data["level"], "info")
	}
}

func TestK8sDriver_ProcessLogLine_PlainStderr(t *testing.T) {
	emitter := &mockEmitter{}
	d := &K8sDriver{emitter: emitter}

	d.processLogLine(context.Background(), "run1", "node1", "error message", true)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Data["level"] != "error" {
		t.Errorf("level: got %v, want %q", events[0].Data["level"], "error")
	}
}

func TestK8sDriver_ProcessLogLine_ValidJSON(t *testing.T) {
	emitter := &mockEmitter{}
	d := &K8sDriver{emitter: emitter}

	d.processLogLine(context.Background(), "run1", "node1", `{"type":"metric","value":42}`, false)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].EventType != "metric" {
		t.Errorf("event type: got %q, want %q", events[0].EventType, "metric")
	}
}

func TestK8sDriver_ProcessLogLine_JSONWithLevel(t *testing.T) {
	emitter := &mockEmitter{}
	d := &K8sDriver{emitter: emitter}

	d.processLogLine(context.Background(), "run1", "node1", `{"type":"log","level":"warn","message":"low disk"}`, false)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Level != "warn" {
		t.Errorf("level: got %q, want %q", events[0].Level, "warn")
	}
}

func TestK8sDriver_ProcessLogLine_JSONInjectsRunNodeID(t *testing.T) {
	emitter := &mockEmitter{}
	d := &K8sDriver{emitter: emitter}

	d.processLogLine(context.Background(), "run1", "node1", `{"type":"output","data":"test"}`, false)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Data["runId"] != "run1" {
		t.Errorf("runId: got %v, want %q", events[0].Data["runId"], "run1")
	}
	if events[0].Data["nodeId"] != "node1" {
		t.Errorf("nodeId: got %v, want %q", events[0].Data["nodeId"], "node1")
	}
}

func TestK8sDriver_ProcessLogLine_JSONPreservesExistingIDs(t *testing.T) {
	emitter := &mockEmitter{}
	d := &K8sDriver{emitter: emitter}

	d.processLogLine(context.Background(), "run1", "node1", `{"type":"log","runId":"orig-run","nodeId":"orig-node"}`, false)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	// Should preserve the original IDs from the JSON
	if events[0].Data["runId"] != "orig-run" {
		t.Errorf("runId: got %v, want %q", events[0].Data["runId"], "orig-run")
	}
	if events[0].Data["nodeId"] != "orig-node" {
		t.Errorf("nodeId: got %v, want %q", events[0].Data["nodeId"], "orig-node")
	}
}

// --- K8sDriver.emitEvent nil safety ---

func TestK8sDriver_EmitEvent_NilEmitter(t *testing.T) {
	d := &K8sDriver{emitter: nil}
	// Should not panic
	d.emitEvent(context.Background(), "run1", "log", map[string]interface{}{"message": "test"}, "node1", "info")
}

// --- RunStoreEmitter tests ---

func TestRunStoreEmitter_EmitEvent(t *testing.T) {
	store := runstore.NewMemoryStore(nil)

	// Create a run so AppendEvent has a target
	runID, err := store.CreateRun(context.Background(), "test-run", &types.Plan{
		Nodes: []types.NodeSpec{{ID: "n1"}},
	}, "owner")
	if err != nil {
		t.Fatalf("CreateRun: %v", err)
	}

	emitter := NewRunStoreEmitter(store)

	err = emitter.EmitEvent(context.Background(), runID, "log", map[string]interface{}{
		"message": "hello world",
	}, "n1", "info")
	if err != nil {
		t.Fatalf("EmitEvent: %v", err)
	}

	// Verify event was stored
	events, err := store.GetEventsSince(context.Background(), runID, "")
	if err != nil {
		t.Fatalf("GetEventsSince: %v", err)
	}
	if len(events) == 0 {
		t.Fatal("expected at least 1 event")
	}

	last := events[len(events)-1]
	if string(last.Type) != "log" {
		t.Errorf("event type: got %q, want %q", last.Type, "log")
	}
	if last.NodeID != "n1" {
		t.Errorf("node_id: got %q, want %q", last.NodeID, "n1")
	}
}

func TestRunStoreEmitter_EmitEvent_IncludesLevel(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	runID, _ := store.CreateRun(context.Background(), "test-run", &types.Plan{
		Nodes: []types.NodeSpec{{ID: "n1"}},
	}, "owner")

	emitter := NewRunStoreEmitter(store)

	data := map[string]interface{}{"message": "warning"}
	err := emitter.EmitEvent(context.Background(), runID, "log", data, "n1", "warn")
	if err != nil {
		t.Fatalf("EmitEvent: %v", err)
	}

	// level should have been injected into data
	if data["level"] != "warn" {
		t.Errorf("data level: got %v, want %q", data["level"], "warn")
	}
}

func TestRunStoreEmitter_EmitEvent_EmptyLevel(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	runID, _ := store.CreateRun(context.Background(), "test-run", &types.Plan{
		Nodes: []types.NodeSpec{{ID: "n1"}},
	}, "owner")

	emitter := NewRunStoreEmitter(store)

	data := map[string]interface{}{"message": "no level"}
	err := emitter.EmitEvent(context.Background(), runID, "output", data, "n1", "")
	if err != nil {
		t.Fatalf("EmitEvent: %v", err)
	}

	// Empty level should not be set
	if _, ok := data["level"]; ok {
		t.Errorf("data should not have 'level' key when level is empty, got %v", data["level"])
	}
}

func TestRunStoreEmitter_NilCheck(t *testing.T) {
	// Compile-time check
	var _ EventEmitter = (*RunStoreEmitter)(nil)
}

// --- Emitter error handling ---

type errorEmitter struct{}

func (e *errorEmitter) EmitEvent(_ context.Context, _, _ string, _ map[string]interface{}, _, _ string) error {
	return fmt.Errorf("emit failed")
}

func TestSubprocessDriver_EmitEvent_Error(t *testing.T) {
	d := NewLocalSubprocessDriver(&errorEmitter{}, nil)
	// Should not panic, just log the error
	d.emitEvent(context.Background(), "run1", "log", map[string]interface{}{"message": "test"}, "node1", "info")
}

func TestK8sDriver_EmitEvent_Error(t *testing.T) {
	d := &K8sDriver{emitter: &errorEmitter{}}
	// Should not panic, just log the error
	d.emitEvent(context.Background(), "run1", "log", map[string]interface{}{"message": "test"}, "node1", "info")
}

// --- processStdoutLine edge cases ---

func TestProcessStdoutLine_JSONNoType(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	// JSON without "type" field defaults to "log"
	d.processStdoutLine(context.Background(), "run1", "node1", `{"message":"hello"}`)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].EventType != "log" {
		t.Errorf("event type: got %q, want %q", events[0].EventType, "log")
	}
}

func TestProcessStdoutLine_JSONEmptyType(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	d.processStdoutLine(context.Background(), "run1", "node1", `{"type":"","value":1}`)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].EventType != "log" {
		t.Errorf("event type: got %q, want %q (empty type should default to log)", events[0].EventType, "log")
	}
}

func TestProcessStdoutLine_InvalidJSON(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	d.processStdoutLine(context.Background(), "run1", "node1", `{invalid json`)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].EventType != "log" {
		t.Errorf("event type: got %q, want %q", events[0].EventType, "log")
	}
	if events[0].Data["message"] != `{invalid json` {
		t.Errorf("message: got %v, want %q", events[0].Data["message"], `{invalid json`)
	}
}

func TestProcessStdoutLine_JSONWithLevel(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	d.processStdoutLine(context.Background(), "run1", "node1", `{"type":"log","level":"debug","message":"trace"}`)

	events := emitter.getEvents()
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Level != "debug" {
		t.Errorf("level: got %q, want %q", events[0].Level, "debug")
	}
}

// --- SubprocessDriver additional tests ---

func TestSubprocessDriver_StderrOutput(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	code, err := d.RunNode(context.Background(), "run1", "node1",
		[]string{"sh", "-c", "echo error-message >&2"},
		nil, 0,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 0 {
		t.Errorf("exit code: got %d, want 0", code)
	}

	events := emitter.getEvents()
	foundStderr := false
	for _, e := range events {
		if e.EventType == "log" && e.Level == "error" {
			if msg, ok := e.Data["message"].(string); ok && msg == "error-message" {
				foundStderr = true
				break
			}
		}
	}
	if !foundStderr {
		t.Error("expected stderr to be captured as error-level log event")
	}
}

func TestSubprocessDriver_MultipleNDJSONLines(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	script := `echo '{"type":"output","key":"a","value":1}'
echo '{"type":"output","key":"b","value":2}'
echo '{"type":"metric","name":"latency","value":42}'`

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
	outputCount := 0
	metricCount := 0
	for _, e := range events {
		switch e.EventType {
		case "output":
			outputCount++
		case "metric":
			metricCount++
		}
	}
	if outputCount != 2 {
		t.Errorf("output events: got %d, want 2", outputCount)
	}
	if metricCount != 1 {
		t.Errorf("metric events: got %d, want 1", metricCount)
	}
}

func TestSubprocessDriver_WithCWD(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, &SubprocessConfig{
		CWD: "/tmp",
	})

	code, err := d.RunNode(context.Background(), "run1", "node1",
		[]string{"pwd"},
		nil, 0,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != 0 {
		t.Errorf("exit code: got %d, want 0", code)
	}
}

func TestSubprocessDriver_NonexistentCommand(t *testing.T) {
	emitter := &mockEmitter{}
	d := NewLocalSubprocessDriver(emitter, nil)

	_, err := d.RunNode(context.Background(), "run1", "node1",
		[]string{"nonexistent_command_abc123"},
		nil, 0,
	)
	if err == nil {
		t.Error("expected error for nonexistent command")
	}
}
