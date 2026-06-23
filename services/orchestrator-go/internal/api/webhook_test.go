package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/scheduler"
)

func newWebhookTestHandlers(t *testing.T) (*Handlers, flowstore.FlowStore) {
	t.Helper()
	store := runstore.NewMemoryStore(&runstore.Config{EventMaxLen: 100, TTLSeconds: 3600})
	flows := flowstore.NewMemoryStore()
	sched := scheduler.New(store, nil, nil, nil, nil)
	h := NewHandlers(store, sched, nil, config.Load(), nil, &HandlerOptions{
		Registry:  registry.NewMemoryRegistryWithDefaults(),
		FlowStore: flows,
	})
	return h, flows
}

func triggerWebhook(h *Handlers, flowID, tokenHeader, tokenValue string) int {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks/trigger/"+flowID, nil)
	if tokenHeader != "" {
		req.Header.Set(tokenHeader, tokenValue)
	}
	req = mux.SetURLVars(req, map[string]string{"flowId": flowID})
	rec := httptest.NewRecorder()
	h.TriggerWebhook(rec, req)
	return rec.Code
}

func TestTriggerWebhook_RejectsMissingAndInvalidToken(t *testing.T) {
	h, flows := newWebhookTestHandlers(t)
	_, err := flows.Create(context.Background(), &flowstore.CreateFlowRequest{
		ID:       "f1",
		Name:     "flow",
		Graph:    json.RawMessage(`{"nodes":[]}`),
		Metadata: map[string]any{"webhook_token": "s3cret"},
	})
	if err != nil {
		t.Fatalf("Create flow: %v", err)
	}

	if code := triggerWebhook(h, "f1", "", ""); code != http.StatusForbidden {
		t.Errorf("missing token = %d, want 403", code)
	}
	if code := triggerWebhook(h, "f1", "X-Webhook-Token", "wrong"); code != http.StatusForbidden {
		t.Errorf("invalid token = %d, want 403", code)
	}
	if code := triggerWebhook(h, "f1", "Authorization", "Bearer wrong"); code != http.StatusForbidden {
		t.Errorf("invalid bearer = %d, want 403", code)
	}
}

func TestTriggerWebhook_NoTokenConfigured(t *testing.T) {
	h, flows := newWebhookTestHandlers(t)
	_, _ = flows.Create(context.Background(), &flowstore.CreateFlowRequest{
		ID:    "f2",
		Name:  "flow",
		Graph: json.RawMessage(`{"nodes":[]}`),
	})
	if code := triggerWebhook(h, "f2", "X-Webhook-Token", "anything"); code != http.StatusForbidden {
		t.Errorf("flow without configured webhook = %d, want 403", code)
	}
}

func TestTriggerWebhook_UnknownFlow404(t *testing.T) {
	h, _ := newWebhookTestHandlers(t)
	if code := triggerWebhook(h, "nope", "X-Webhook-Token", "x"); code != http.StatusNotFound {
		t.Errorf("unknown flow = %d, want 404", code)
	}
}
