package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func newSSETestHandlers(t *testing.T) (*Handlers, runstore.RunStore) {
	t.Helper()
	store := runstore.NewMemoryStore(&runstore.Config{EventMaxLen: 1000, TTLSeconds: 3600})
	h := NewHandlers(store, nil, nil, config.Load(), nil, &HandlerOptions{
		Registry:  registry.NewMemoryRegistryWithDefaults(),
		FlowStore: flowstore.NewMemoryStore(),
	})
	return h, store
}

// A reconnect with Last-Event-ID replays the run's prior events losslessly
// before the live stream takes over.
func TestStreamEvents_ReplaysHistoryFromLastEventID(t *testing.T) {
	h, store := newSSETestHandlers(t)
	bg := context.Background()

	runID, err := store.CreateRun(bg, "sse", &types.Plan{Nodes: []types.NodeSpec{{ID: "n"}}}, "")
	if err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, err := store.AppendEvent(bg, runID, &types.EventInput{
			Type: types.EventTypeLog, NodeID: "n", Data: map[string]interface{}{"type": "log", "i": i},
		}); err != nil {
			t.Fatalf("AppendEvent: %v", err)
		}
	}

	reqCtx, cancel := context.WithCancel(bg)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/runs/"+runID+"/events", nil).WithContext(reqCtx)
	req.Header.Set("Last-Event-ID", "0") // replay from the beginning
	req = mux.SetURLVars(req, map[string]string{"id": runID})
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		h.StreamEvents(rec, req)
		close(done)
	}()

	time.Sleep(150 * time.Millisecond) // allow hello + historical writes
	cancel()                           // unblock the stream loop (client disconnect)
	<-done

	body := rec.Body.String()
	if got := strings.Count(body, "event: log"); got != 3 {
		t.Errorf("replayed %d log events, want 3 (lossless resumption)\nbody:\n%s", got, body)
	}
	if !strings.Contains(body, "event: hello") {
		t.Errorf("expected a hello event at stream start; body:\n%s", body)
	}
	if strings.Contains(body, "streaming not supported") {
		t.Error("SSE handler returned 'streaming not supported' (Flusher assertion failed)")
	}
}

// Streaming a non-existent run returns 404 rather than hanging.
func TestStreamEvents_UnknownRun404(t *testing.T) {
	h, _ := newSSETestHandlers(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/runs/nope/events", nil)
	req = mux.SetURLVars(req, map[string]string{"id": "nope"})
	rec := httptest.NewRecorder()

	h.StreamEvents(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}
