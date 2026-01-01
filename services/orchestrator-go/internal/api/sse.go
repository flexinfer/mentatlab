package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/gorilla/mux"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/metrics"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// StreamEvents handles GET /api/v1/runs/{id}/events
// It implements Server-Sent Events (SSE) for streaming run events.
func (h *Handlers) StreamEvents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	vars := mux.Vars(r)
	runID := vars["id"]
	startTime := time.Now()

	// Extract request ID for logging
	requestID := GetRequestID(ctx, r)

	// Track active SSE connections
	metrics.SSEActiveConnections.Inc()
	defer metrics.SSEActiveConnections.Dec()

	h.logger.Info("SSE connection opened",
		slog.String("run_id", runID),
		slog.String("request_id", requestID),
		slog.String("remote_addr", r.RemoteAddr),
	)

	// Check if run exists
	_, err := h.store.GetRunMeta(ctx, runID)
	if err != nil {
		if errors.Is(err, runstore.ErrRunNotFound) {
			h.respondError(w, r, http.StatusNotFound, "run not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to get run", err)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering

	// Check for Last-Event-ID header for resumption
	lastEventID := r.Header.Get("Last-Event-ID")

	// Flush headers
	flusher, ok := w.(http.Flusher)
	if !ok {
		h.respondError(w, r, http.StatusInternalServerError, "streaming not supported", nil)
		return
	}
	flusher.Flush()

	// Send a hello event
	h.writeSSE(w, flusher, &types.Event{
		ID:        "0",
		RunID:     runID,
		Type:      "hello",
		Timestamp: time.Now().UTC(),
	})

	// Get historical events if resuming
	if lastEventID != "" {
		events, err := h.store.GetEventsSince(ctx, runID, lastEventID)
		if err != nil {
			h.logger.Error("failed to get historical events", "error", err, "run_id", runID)
		} else {
			for _, evt := range events {
				h.writeSSE(w, flusher, evt)
			}
		}
	}

	// Subscribe to new events
	eventCh, cleanup, err := h.store.Subscribe(ctx, runID)
	if err != nil {
		h.logger.Error("failed to subscribe to events", "error", err, "run_id", runID)
		return
	}
	defer cleanup()

	// Create a done channel for client disconnect
	done := r.Context().Done()

	// Heartbeat ticker to keep connection alive
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	// Stream events
	for {
		select {
		case <-done:
			// Client disconnected
			duration := time.Since(startTime)
			metrics.SSEConnectionDuration.Observe(duration.Seconds())
			h.logger.Info("SSE connection closed (client disconnect)",
				slog.String("run_id", runID),
				slog.String("request_id", requestID),
				slog.Duration("duration", duration),
				slog.String("reason", "client_disconnect"),
			)
			return

		case evt, ok := <-eventCh:
			if !ok {
				// Channel closed, run completed or cancelled
				h.sendRunCompleteEvent(w, flusher, runID, ctx)
				duration := time.Since(startTime)
				metrics.SSEConnectionDuration.Observe(duration.Seconds())
				h.logger.Info("SSE connection closed (run completed)",
					slog.String("run_id", runID),
					slog.String("request_id", requestID),
					slog.Duration("duration", duration),
					slog.String("reason", "run_completed"),
				)
				return
			}
			h.writeSSE(w, flusher, evt)

		case <-heartbeat.C:
			// Send a heartbeat comment to keep connection alive
			h.writeComment(w, flusher, "heartbeat")
		}
	}
}

// writeSSE writes an event in SSE format and flushes.
func (h *Handlers) writeSSE(w http.ResponseWriter, flusher http.Flusher, evt *types.Event) {
	if evt == nil {
		return
	}
	data := evt.ToSSE()
	_, err := w.Write(data)
	if err != nil {
		h.logger.Error("failed to write SSE event", "error", err)
		return
	}
	flusher.Flush()
}

// writeComment writes an SSE comment (for heartbeats).
func (h *Handlers) writeComment(w http.ResponseWriter, flusher http.Flusher, comment string) {
	_, err := w.Write([]byte(": " + comment + "\n\n"))
	if err != nil {
		h.logger.Error("failed to write SSE comment", "error", err)
		return
	}
	flusher.Flush()
}

// sendRunCompleteEvent sends a final event indicating the run stream has ended.
func (h *Handlers) sendRunCompleteEvent(w http.ResponseWriter, flusher http.Flusher, runID string, ctx context.Context) {
	// Get final run status
	run, err := h.store.GetRunMeta(ctx, runID)
	if err != nil {
		h.logger.Error("failed to get run meta for completion event", "error", err)
		return
	}

	evt := &types.Event{
		ID:        "final",
		RunID:     runID,
		Type:      types.EventTypeStreamEnd,
		Timestamp: time.Now().UTC(),
	}

	// Include final status in the event
	if run != nil {
		data := map[string]interface{}{
			"status": run.Status,
		}
		if run.Error != "" {
			data["error"] = run.Error
		}
		dataJSON, _ := json.Marshal(data)
		evt.Data = dataJSON
	}

	h.writeSSE(w, flusher, evt)
}
