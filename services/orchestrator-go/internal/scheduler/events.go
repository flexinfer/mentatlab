package scheduler

import (
	"context"
	"encoding/json"
	"log/slog"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/metrics"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// emitEvent appends an event to the run's event stream.
func (s *Scheduler) emitEvent(ctx context.Context, runID, eventType string, data map[string]interface{}, nodeID, level string) {
	// Include level in data if provided
	if level != "" {
		data["level"] = level
	}
	input := &types.EventInput{
		Type:   types.EventType(eventType),
		NodeID: nodeID,
		Data:   data,
	}
	if _, err := s.store.AppendEvent(ctx, runID, input); err != nil {
		s.logger.Error("failed to emit event", slog.String("run_id", runID), slog.String("event_type", eventType), slog.Any("error", err))
	}
	metrics.EventsTotal.WithLabelValues(eventType).Inc()
}

// emitRunStatus emits a run status event with trace correlation.
func (s *Scheduler) emitRunStatus(ctx context.Context, runID, status string) {
	data := map[string]interface{}{
		"runId":  runID,
		"status": status,
	}
	// Include trace_id in status events for frontend correlation
	if traceID := trace.SpanContextFromContext(ctx).TraceID(); traceID.IsValid() {
		data["trace_id"] = traceID.String()
	}
	s.emitEvent(ctx, runID, "status", data, "", "")
}

// emitNodeStatus emits a node status event with optional extra data.
func (s *Scheduler) emitNodeStatus(ctx context.Context, runID, nodeID, status string, extra map[string]interface{}) {
	data := map[string]interface{}{
		"runId":  runID,
		"nodeId": nodeID,
		"status": status,
	}
	for k, v := range extra {
		data[k] = v
	}
	s.emitEvent(ctx, runID, "node_status", data, nodeID, "")
}

// captureNodeOutputs scans the run's event stream for output events from the
// given node and stores them via runstore.SetNodeOutputs. This enables
// downstream nodes to access predecessor outputs through the expression
// environment (e.g., inputs.node_id.field).
func (s *Scheduler) captureNodeOutputs(ctx context.Context, runID, nodeID string) {
	_, span := tracer.Start(ctx, "scheduler.captureNodeOutputs",
		trace.WithAttributes(
			attribute.String("run_id", runID),
			attribute.String("node_id", nodeID),
		),
	)
	defer span.End()

	events, err := s.store.GetEventsSince(ctx, runID, "")
	if err != nil {
		s.logger.Warn("failed to read events for output capture",
			slog.String("run_id", runID),
			slog.String("node_id", nodeID),
			slog.Any("error", err))
		return
	}

	// Collect outputs from "output" events emitted by this node's agent.
	// Agents produce NDJSON lines with {"type": "output", "key": "...", "value": ...}
	// We merge all output events into a single outputs map.
	outputs := make(map[string]interface{})
	for _, ev := range events {
		if ev.NodeID != nodeID {
			continue
		}
		if string(ev.Type) != "output" {
			continue
		}
		if len(ev.Data) == 0 {
			continue
		}
		// Unmarshal the raw JSON data
		var data map[string]interface{}
		if err := json.Unmarshal(ev.Data, &data); err != nil {
			s.logger.Warn("failed to unmarshal output event data",
				slog.String("run_id", runID),
				slog.String("node_id", nodeID),
				slog.Any("error", err))
			continue
		}
		// Extract key/value pairs from the event data
		if key, ok := data["key"].(string); ok {
			outputs[key] = data["value"]
		} else {
			// If no explicit key, merge all data fields (except metadata)
			for k, v := range data {
				if k == "type" || k == "runId" || k == "nodeId" || k == "level" {
					continue
				}
				outputs[k] = v
			}
		}
	}

	span.SetAttributes(attribute.Int("output_count", len(outputs)))

	if len(outputs) == 0 {
		return
	}

	if err := s.store.SetNodeOutputs(ctx, runID, nodeID, outputs); err != nil {
		s.logger.Warn("failed to store node outputs",
			slog.String("run_id", runID),
			slog.String("node_id", nodeID),
			slog.Any("error", err))
	}
}
