package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/scheduler"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func TestCreateRunWithWebhook(t *testing.T) {
	store := runstore.NewMemoryStore(runstore.DefaultConfig())
	defer store.Close()
	sched := scheduler.New(store, nil, nil, nil, nil)
	h := NewHandlers(store, sched, nil, config.Load(), nil, nil)

	body := `{"name":"webhook-test","webhook_url":"https://example.com/hook","webhook_secret":"s3cret","plan":{"nodes":[{"id":"n1","type":"agent","agent_id":"echo"}]}}`
	req := httptest.NewRequest("POST", "/api/v1/runs", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-Email", "test@example.com")
	rr := httptest.NewRecorder()

	h.CreateRun(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp CreateRunResponse
	json.Unmarshal(rr.Body.Bytes(), &resp)

	// Verify webhook fields are stored
	run, err := store.GetRun(context.Background(), resp.RunID)
	if err != nil {
		t.Fatalf("failed to get run: %v", err)
	}
	if run.WebhookURL != "https://example.com/hook" {
		t.Errorf("expected webhook URL 'https://example.com/hook', got '%s'", run.WebhookURL)
	}
	if run.WebhookSecret != "s3cret" {
		t.Errorf("expected webhook secret 's3cret', got '%s'", run.WebhookSecret)
	}
	if run.Owner != "test@example.com" {
		t.Errorf("expected owner 'test@example.com', got '%s'", run.Owner)
	}
}

func TestListRunsCursorPagination(t *testing.T) {
	store := runstore.NewMemoryStore(runstore.DefaultConfig())
	defer store.Close()
	sched := scheduler.New(store, nil, nil, nil, nil)
	h := NewHandlers(store, sched, nil, config.Load(), nil, nil)

	ctx := context.Background()
	plan := &types.Plan{
		Nodes: []types.NodeSpec{{ID: "n1", Type: "agent", AgentID: "echo"}},
	}
	for i := 0; i < 5; i++ {
		store.CreateRun(ctx, "test-run", plan, "user@example.com")
	}

	// First page: limit=2
	req := httptest.NewRequest("GET", "/api/v1/runs?limit=2", nil)
	rr := httptest.NewRecorder()
	h.ListRuns(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var page1 struct {
		Runs       []interface{} `json:"runs"`
		Total      int           `json:"total"`
		NextCursor string        `json:"next_cursor"`
	}
	json.Unmarshal(rr.Body.Bytes(), &page1)

	if len(page1.Runs) != 2 {
		t.Errorf("expected 2 runs, got %d", len(page1.Runs))
	}
	if page1.Total != 5 {
		t.Errorf("expected total 5, got %d", page1.Total)
	}
	if page1.NextCursor == "" {
		t.Error("expected next_cursor to be set")
	}

	// Second page using cursor
	req2 := httptest.NewRequest("GET", "/api/v1/runs?limit=2&cursor="+page1.NextCursor, nil)
	rr2 := httptest.NewRecorder()
	h.ListRuns(rr2, req2)

	if rr2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr2.Code, rr2.Body.String())
	}

	var page2 struct {
		Runs       []interface{} `json:"runs"`
		NextCursor string        `json:"next_cursor"`
	}
	json.Unmarshal(rr2.Body.Bytes(), &page2)

	if len(page2.Runs) != 2 {
		t.Errorf("expected 2 runs on page 2, got %d", len(page2.Runs))
	}
}

func TestListRunsOwnerFilter(t *testing.T) {
	store := runstore.NewMemoryStore(runstore.DefaultConfig())
	defer store.Close()
	sched := scheduler.New(store, nil, nil, nil, nil)
	h := NewHandlers(store, sched, nil, config.Load(), nil, nil)

	ctx := context.Background()
	plan := &types.Plan{
		Nodes: []types.NodeSpec{{ID: "n1", Type: "agent", AgentID: "echo"}},
	}

	store.CreateRun(ctx, "alice-run", plan, "alice@example.com")
	store.CreateRun(ctx, "bob-run", plan, "bob@example.com")
	store.CreateRun(ctx, "alice-run-2", plan, "alice@example.com")

	// Filter by alice
	req := httptest.NewRequest("GET", "/api/v1/runs?owner=alice@example.com", nil)
	rr := httptest.NewRecorder()
	h.ListRuns(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var resp struct {
		Runs  []interface{} `json:"runs"`
		Total int           `json:"total"`
	}
	json.Unmarshal(rr.Body.Bytes(), &resp)

	if len(resp.Runs) != 2 {
		t.Errorf("expected 2 runs for alice, got %d", len(resp.Runs))
	}
}

func TestCreateFlowSetsCreatedBy(t *testing.T) {
	store := runstore.NewMemoryStore(runstore.DefaultConfig())
	defer store.Close()
	sched := scheduler.New(store, nil, nil, nil, nil)

	fs := flowstore.NewMemoryStore()
	opts := &HandlerOptions{FlowStore: fs}
	h := NewHandlers(store, sched, nil, config.Load(), nil, opts)

	body := `{"name":"test-flow","graph":{"nodes":[]}}`
	req := httptest.NewRequest("POST", "/api/v1/flows", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-User-Email", "builder@example.com")
	rr := httptest.NewRecorder()

	h.CreateFlow(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var flowResp map[string]interface{}
	json.Unmarshal(rr.Body.Bytes(), &flowResp)

	if flowResp["created_by"] != "builder@example.com" {
		t.Errorf("expected created_by='builder@example.com', got '%v'", flowResp["created_by"])
	}
}
