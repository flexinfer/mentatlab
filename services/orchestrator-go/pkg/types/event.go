package types

import (
	"encoding/json"
	"fmt"
	"time"
)

// EventType categorizes the kind of event.
type EventType string

const (
	EventTypeStreamStart EventType = "stream_start"
	EventTypeStreamEnd   EventType = "stream_end"
	EventTypeStreamData  EventType = "stream_data"
	EventTypeLog         EventType = "log"
	EventTypeCheckpoint  EventType = "checkpoint"
	EventTypeNodeStatus  EventType = "node_status"
	EventTypeRunStatus   EventType = "run_status"
	EventTypeProgress    EventType = "progress"
	EventTypeError       EventType = "error"

	// Control flow events
	EventTypeConditionEvaluated EventType = "condition_evaluated"
	EventTypeBranchSelected     EventType = "branch_selected"
	EventTypeBranchSkipped      EventType = "branch_skipped"
	EventTypeLoopStarted        EventType = "loop_started"
	EventTypeLoopIteration      EventType = "loop_iteration"
	EventTypeLoopComplete       EventType = "loop_complete"
)

// LogLevel represents the severity of a log event.
type LogLevel string

const (
	LogLevelDebug   LogLevel = "debug"
	LogLevelInfo    LogLevel = "info"
	LogLevelWarning LogLevel = "warning"
	LogLevelError   LogLevel = "error"
)

// Event represents a single event in a run's event stream.
type Event struct {
	ID        string          `json:"id"`
	RunID     string          `json:"run_id"`
	Type      EventType       `json:"type"`
	NodeID    string          `json:"node_id,omitempty"`
	Timestamp time.Time       `json:"timestamp"`
	Data      json.RawMessage `json:"data,omitempty"`
}

// EventInput is used when appending new events.
type EventInput struct {
	Type   EventType   `json:"type"`
	NodeID string      `json:"node_id,omitempty"`
	Data   interface{} `json:"data,omitempty"`
}

// LogEvent represents the data payload for log events.
type LogEvent struct {
	Level   LogLevel          `json:"level"`
	Message string            `json:"message"`
	Fields  map[string]string `json:"fields,omitempty"`
}

// CheckpointEvent represents the data payload for checkpoint events.
type CheckpointEvent struct {
	Label       string                 `json:"label"`
	ArtifactRef string                 `json:"artifact_ref,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

// NodeStatusEvent represents the data payload for node status change events.
type NodeStatusEvent struct {
	Status   NodeStatus `json:"status"`
	ExitCode *int       `json:"exit_code,omitempty"`
	Error    string     `json:"error,omitempty"`
}

// RunStatusEvent represents the data payload for run status change events.
type RunStatusEvent struct {
	Status RunStatus `json:"status"`
	Error  string    `json:"error,omitempty"`
}

// ProgressEvent represents the data payload for progress events.
type ProgressEvent struct {
	Current int    `json:"current"`
	Total   int    `json:"total"`
	Message string `json:"message,omitempty"`
}

// StreamDataEvent represents generic streaming data from an agent.
type StreamDataEvent struct {
	ContentType string          `json:"content_type,omitempty"`
	Text        string          `json:"text,omitempty"`
	Raw         json.RawMessage `json:"raw,omitempty"`
}

// ToSSE formats the event for Server-Sent Events protocol.
// Format: id: <id>\nevent: <type>\ndata: <json>\n\n
func (e *Event) ToSSE() []byte {
	data, _ := json.Marshal(e)
	return []byte(fmt.Sprintf("id: %s\nevent: %s\ndata: %s\n\n", e.ID, e.Type, data))
}

// ParseNDJSON attempts to parse a line of NDJSON from an agent's stdout.
// Returns the event type and parsed data, or an error.
func ParseNDJSON(line []byte) (*EventInput, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal(line, &raw); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	// Determine event type from the JSON structure
	eventType := EventTypeLog // default
	if t, ok := raw["type"].(string); ok {
		eventType = EventType(t)
	}

	return &EventInput{
		Type: eventType,
		Data: raw,
	}, nil
}
