// {{AGENT_NAME}} Agent - {{DESCRIPTION}}
// Follows MentatLab agent contract: reads JSON from stdin, emits NDJSON events to stdout.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// Event is the NDJSON event format expected by the MentatLab orchestrator.
type Event struct {
	Type    string         `json:"type"`
	Level   string         `json:"level,omitempty"`
	Message string         `json:"message,omitempty"`
	Data    map[string]any `json:"data,omitempty"`
	TS      string         `json:"ts,omitempty"`
}

func emit(e Event) {
	if e.TS == "" {
		e.TS = time.Now().UTC().Format(time.RFC3339Nano)
	}
	raw, _ := json.Marshal(e)
	fmt.Fprintln(os.Stdout, string(raw))
}

func checkpoint(stage string, progress float64, extra map[string]any) {
	data := map[string]any{"stage": stage, "progress": progress}
	for k, v := range extra {
		data[k] = v
	}
	emit(Event{Type: "checkpoint", Data: data})
}

func logInfo(msg string, data map[string]any) {
	emit(Event{Type: "log", Level: "info", Message: msg, Data: data})
}

func logError(msg string, data map[string]any) {
	emit(Event{Type: "log", Level: "error", Message: msg, Data: data})
}

func emitOutput(key string, value any) {
	emit(Event{Type: "output", Data: map[string]any{"key": key, "value": value}})
}

func emitError(code string, message string, retryable bool, details map[string]any) {
	data := map[string]any{
		"code":      code,
		"message":   message,
		"retryable": retryable,
	}
	if len(details) > 0 {
		data["details"] = details
	}
	emit(Event{Type: "error", Level: "error", Message: message, Data: data})
}

func main() {
	checkpoint("start", 0.0, nil)

	var input map[string]any
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		emitError("INVALID_INPUT", "failed to read input", false, map[string]any{"error": err.Error()})
		os.Exit(1)
	}

	text, _ := input["text"].(string)
	if text == "" {
		emitError("INVALID_INPUT", "missing required field 'text'", false, nil)
		os.Exit(1)
	}

	logInfo("processing", map[string]any{"input_length": len(text)})

	// TODO: Replace with your agent logic
	// Example transient failure:
	// emitError("MODEL_NOT_READY", "model is still loading", true, map[string]any{"model": "my-model"})
	// os.Exit(1)
	start := time.Now()
	result := fmt.Sprintf("Processed: %s", text)
	elapsed := time.Since(start)

	emitOutput("result", result)
	logInfo("done", map[string]any{"elapsed_ms": elapsed.Milliseconds()})
	checkpoint("end", 1.0, map[string]any{"elapsed_ms": elapsed.Milliseconds()})
}
