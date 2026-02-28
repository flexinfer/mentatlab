package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gorilla/mux"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/scheduler"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// newTestHandlers creates Handlers with in-memory backends for testing.
func newTestHandlers(t *testing.T) *Handlers {
	t.Helper()
	store := runstore.NewMemoryStore(&runstore.Config{
		EventMaxLen: 1000,
		TTLSeconds:  3600,
	})
	reg := registry.NewMemoryRegistryWithDefaults()
	flows := flowstore.NewMemoryStore()
	cfg := config.Load()

	opts := &HandlerOptions{
		Registry:  reg,
		FlowStore: flows,
	}
	return NewHandlers(store, nil, nil, cfg, nil, opts)
}

// newTestServer creates a Server wired with in-memory backends.
func newTestServer(t *testing.T) *Server {
	t.Helper()
	h := newTestHandlers(t)
	return NewServer(h, nil, 0, 0)
}

// newTestHandlersWithScheduler creates Handlers with in-memory backends and scheduler.
func newTestHandlersWithScheduler(t *testing.T) *Handlers {
	t.Helper()
	store := runstore.NewMemoryStore(&runstore.Config{
		EventMaxLen: 1000,
		TTLSeconds:  3600,
	})
	reg := registry.NewMemoryRegistryWithDefaults()
	flows := flowstore.NewMemoryStore()
	cfg := config.Load()
	sched := scheduler.New(store, nil, nil, nil, nil)

	opts := &HandlerOptions{
		Registry:  reg,
		FlowStore: flows,
	}
	return NewHandlers(store, sched, nil, cfg, nil, opts)
}

// newTestServerWithScheduler creates a Server with in-memory backends and scheduler.
func newTestServerWithScheduler(t *testing.T) *Server {
	t.Helper()
	h := newTestHandlersWithScheduler(t)
	return NewServer(h, nil, 0, 0)
}

// --- Health endpoints ---

func TestHealth(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var body map[string]string
	json.NewDecoder(w.Body).Decode(&body)
	if body["status"] != "ok" {
		t.Fatalf("expected status ok, got %s", body["status"])
	}
}

func TestReady(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest("GET", "/ready", nil)
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var body map[string]interface{}
	json.NewDecoder(w.Body).Decode(&body)
	if body["status"] != "ready" {
		t.Fatalf("expected status ready, got %v", body["status"])
	}
}

// --- Run management ---

func TestCreateRun(t *testing.T) {
	srv := newTestServer(t)

	payload := CreateRunRequest{
		Name: "test-run",
		Plan: &types.Plan{
			Nodes: []types.NodeSpec{
				{ID: "node1", Type: "agent", AgentID: "mentatlab.echo"},
			},
		},
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/api/v1/runs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp CreateRunResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.RunID == "" {
		t.Fatal("expected non-empty runId")
	}
	if resp.Status != "created" {
		t.Fatalf("expected status created, got %s", resp.Status)
	}
}

func TestListRuns(t *testing.T) {
	srv := newTestServer(t)

	// Create a run first
	payload := CreateRunRequest{Name: "list-test"}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/api/v1/runs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	// List runs
	req = httptest.NewRequest("GET", "/api/v1/runs", nil)
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	total, ok := resp["total"].(float64)
	if !ok || total < 1 {
		t.Fatalf("expected at least 1 run, got %v", resp["total"])
	}
}

func TestGetRunNotFound(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest("GET", "/api/v1/runs/nonexistent-id", nil)
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestGetRun(t *testing.T) {
	srv := newTestServer(t)

	// Create a run
	payload := CreateRunRequest{Name: "get-test"}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/api/v1/runs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	var createResp CreateRunResponse
	json.NewDecoder(w.Body).Decode(&createResp)

	// Get the run
	req = httptest.NewRequest("GET", "/api/v1/runs/"+createResp.RunID, nil)
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// --- Agent CRUD ---

func TestCreateAgent(t *testing.T) {
	srv := newTestServer(t)

	payload := registry.CreateAgentRequest{
		ID:      "test.agent",
		Name:    "Test Agent",
		Version: "1.0.0",
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/api/v1/agents", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListAgents(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest("GET", "/api/v1/agents", nil)
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if _, ok := resp["agents"]; !ok {
		t.Fatal("expected agents field in response")
	}
}

func TestGetAgentNotFound(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest("GET", "/api/v1/agents/nonexistent", nil)
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// --- Flow CRUD ---

func TestCreateFlow(t *testing.T) {
	srv := newTestServer(t)

	payload := flowstore.CreateFlowRequest{
		Name:  "Test Flow",
		Graph: json.RawMessage(`{"nodes":[],"edges":[]}`),
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/api/v1/flows", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListFlows(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest("GET", "/api/v1/flows", nil)
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if _, ok := resp["flows"]; !ok {
		t.Fatal("expected flows field in response")
	}
}

func TestGetFlowNotFound(t *testing.T) {
	srv := newTestServer(t)
	req := httptest.NewRequest("GET", "/api/v1/flows/nonexistent", nil)
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestFlowCRUDRoundTripGraphParity(t *testing.T) {
	srv := newTestServer(t)

	initialGraph := json.RawMessage(`{
		"nodes":[{"id":"n1","type":"agent","position":{"x":10,"y":20},"data":{"agent_id":"echo"}}],
		"edges":[]
	}`)
	createPayload := flowstore.CreateFlowRequest{
		Name:        "RoundTrip Flow",
		Description: "initial",
		Graph:       initialGraph,
	}
	createBody, _ := json.Marshal(createPayload)
	createReq := httptest.NewRequest("POST", "/api/v1/flows", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createW := httptest.NewRecorder()
	srv.Router().ServeHTTP(createW, createReq)

	if createW.Code != http.StatusCreated {
		t.Fatalf("expected 201 on create, got %d: %s", createW.Code, createW.Body.String())
	}

	var created flowstore.Flow
	if err := json.NewDecoder(createW.Body).Decode(&created); err != nil {
		t.Fatalf("failed to decode create response: %v", err)
	}
	if created.ID == "" {
		t.Fatal("expected created flow ID")
	}

	updatedName := "RoundTrip Flow Updated"
	updatedGraph := json.RawMessage(`{
		"nodes":[
			{"id":"n1","type":"agent","position":{"x":120,"y":220},"data":{"agent_id":"echo","label":"updated"}},
			{"id":"n2","type":"agent","position":{"x":300,"y":220},"data":{"agent_id":"echo"}}
		],
		"edges":[{"id":"e-1","source":"n1","target":"n2"}]
	}`)
	updatePayload := flowstore.UpdateFlowRequest{
		Name:  &updatedName,
		Graph: updatedGraph,
	}
	updateBody, _ := json.Marshal(updatePayload)
	updateReq := httptest.NewRequest("PUT", "/api/v1/flows/"+created.ID, bytes.NewReader(updateBody))
	updateReq.Header.Set("Content-Type", "application/json")
	updateW := httptest.NewRecorder()
	srv.Router().ServeHTTP(updateW, updateReq)

	if updateW.Code != http.StatusOK {
		t.Fatalf("expected 200 on update, got %d: %s", updateW.Code, updateW.Body.String())
	}

	var updated flowstore.Flow
	if err := json.NewDecoder(updateW.Body).Decode(&updated); err != nil {
		t.Fatalf("failed to decode update response: %v", err)
	}
	if updated.Name != updatedName {
		t.Fatalf("expected updated name %q, got %q", updatedName, updated.Name)
	}
	if !jsonEqual(updatedGraph, updated.Graph) {
		t.Fatalf("updated graph mismatch. expected=%s got=%s", string(updatedGraph), string(updated.Graph))
	}

	getReq := httptest.NewRequest("GET", "/api/v1/flows/"+created.ID, nil)
	getW := httptest.NewRecorder()
	srv.Router().ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected 200 on get, got %d: %s", getW.Code, getW.Body.String())
	}

	var fetched flowstore.Flow
	if err := json.NewDecoder(getW.Body).Decode(&fetched); err != nil {
		t.Fatalf("failed to decode get response: %v", err)
	}
	if fetched.Name != updatedName {
		t.Fatalf("expected fetched name %q, got %q", updatedName, fetched.Name)
	}
	if !jsonEqual(updatedGraph, fetched.Graph) {
		t.Fatalf("fetched graph mismatch. expected=%s got=%s", string(updatedGraph), string(fetched.Graph))
	}
}

func jsonEqual(expected, actual json.RawMessage) bool {
	var exp any
	var got any
	if err := json.Unmarshal(expected, &exp); err != nil {
		return false
	}
	if err := json.Unmarshal(actual, &got); err != nil {
		return false
	}
	return reflect.DeepEqual(exp, got)
}

// --- SSE StreamEvents ---

func TestStreamEventsContentType(t *testing.T) {
	h := newTestHandlers(t)

	// Create a run to stream
	store := h.store
	ctx := t.Context()
	runID, err := store.CreateRun(ctx, "sse-test", &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "n1", Type: "agent", AgentID: "mentatlab.echo"},
		},
	}, "")
	if err != nil {
		t.Fatalf("failed to create run: %v", err)
	}

	// Use mux router to set path vars
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/runs/{id}/events", h.StreamEvents).Methods("GET")

	// Use a pre-cancelled context so the SSE loop exits immediately
	cancelCtx, cancel := context.WithCancel(ctx)
	cancel() // Cancel immediately

	req := httptest.NewRequest("GET", "/api/v1/runs/"+runID+"/events", nil)
	req = req.WithContext(cancelCtx)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	ct := w.Header().Get("Content-Type")
	if ct != "text/event-stream" {
		t.Fatalf("expected Content-Type text/event-stream, got %s", ct)
	}
}

func TestStreamEventsNotFound(t *testing.T) {
	h := newTestHandlers(t)

	r := mux.NewRouter()
	r.HandleFunc("/api/v1/runs/{id}/events", h.StreamEvents).Methods("GET")

	req := httptest.NewRequest("GET", "/api/v1/runs/nonexistent/events", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// --- Artifact endpoints (no dataflow service) ---

func TestArtifacts503WhenNoDataflow(t *testing.T) {
	srv := newTestServer(t)

	// Create a run first for artifact endpoints that need a run ID
	payload := CreateRunRequest{Name: "artifact-test"}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/api/v1/runs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	var createResp CreateRunResponse
	json.NewDecoder(w.Body).Decode(&createResp)

	// Test ListRunArtifacts returns 503
	req = httptest.NewRequest("GET", "/api/v1/runs/"+createResp.RunID+"/artifacts", nil)
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for artifacts without dataflow, got %d", w.Code)
	}

	// Test GetArtifact returns 503
	req = httptest.NewRequest("GET", "/api/v1/artifacts?uri=test", nil)
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for get artifact without dataflow, got %d", w.Code)
	}
}

// --- StartRun without scheduler ---

func TestStartRunNoScheduler(t *testing.T) {
	srv := newTestServer(t)

	// Create a run
	payload := CreateRunRequest{Name: "start-test"}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest("POST", "/api/v1/runs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	var createResp CreateRunResponse
	json.NewDecoder(w.Body).Decode(&createResp)

	// Try to start - should fail because no scheduler
	req = httptest.NewRequest("POST", "/api/v1/runs/"+createResp.RunID+"/start", nil)
	w = httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for start without scheduler, got %d", w.Code)
	}
}

func TestStartRunRejectsInvalidPlan(t *testing.T) {
	srv := newTestServerWithScheduler(t)
	store := srv.handlers.store
	ctx := t.Context()

	runID, err := store.CreateRun(ctx, "invalid-plan", &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a", Type: "agent"},
			{ID: "b", Type: "agent"},
		},
		Edges: []types.EdgeSpec{
			{From: "a", To: "b"},
			{From: "b", To: "a"},
		},
	}, "")
	if err != nil {
		t.Fatalf("failed to create run: %v", err)
	}

	req := httptest.NewRequest("POST", "/api/v1/runs/"+runID+"/start", nil)
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid run plan, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "cycle detected") {
		t.Fatalf("expected cycle validation error, got: %s", w.Body.String())
	}
}

func TestCloneRunRejectsInvalidPlan(t *testing.T) {
	srv := newTestServer(t)
	store := srv.handlers.store
	ctx := t.Context()

	runID, err := store.CreateRun(ctx, "invalid-plan-clone", &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "a", Type: "agent"},
			{ID: "b", Type: "agent"},
		},
		Edges: []types.EdgeSpec{
			{From: "a", To: "b"},
			{From: "b", To: "a"},
		},
	}, "")
	if err != nil {
		t.Fatalf("failed to create run: %v", err)
	}

	req := httptest.NewRequest("POST", "/api/v1/runs/"+runID+"/clone", bytes.NewReader([]byte(`{"auto_start":false}`)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid run plan clone, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "cycle detected") {
		t.Fatalf("expected cycle validation error, got: %s", w.Body.String())
	}
}
