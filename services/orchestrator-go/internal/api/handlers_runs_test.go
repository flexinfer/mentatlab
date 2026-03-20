package api

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/scheduler"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

type capturedRunNode struct {
	RunID   string
	NodeID  string
	Command []string
	Env     map[string]string
}

type capturingDriver struct {
	calls chan capturedRunNode
}

func (d *capturingDriver) RunNode(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
	call := capturedRunNode{
		RunID:   runID,
		NodeID:  nodeID,
		Command: append([]string(nil), cmd...),
		Env:     map[string]string{},
	}
	for k, v := range env {
		call.Env[k] = v
	}

	select {
	case d.calls <- call:
	default:
	}

	return 0, nil
}

func newHydrationTestServer(t *testing.T) (*Server, <-chan capturedRunNode) {
	t.Helper()

	store := runstore.NewMemoryStore(&runstore.Config{
		EventMaxLen: 1000,
		TTLSeconds:  3600,
	})
	reg := registry.NewMemoryRegistryWithDefaults()
	flows := flowstore.NewMemoryStore()
	calls := make(chan capturedRunNode, 1)
	drv := &capturingDriver{calls: calls}
	sched := scheduler.New(store, drv, func(node *types.NodeSpec) []string {
		return node.Command
	}, nil, slog.Default())

	opts := &HandlerOptions{
		Registry:  reg,
		FlowStore: flows,
	}
	handlers := NewHandlers(store, sched, nil, config.Load(), slog.Default(), opts)
	return NewServer(handlers, nil, 0, 0), calls
}

func TestCreateRunHydratesAgentDefaultsInCreatedRunPlan(t *testing.T) {
	srv := newTestServer(t)

	payload := CreateRunRequest{
		Name: "hydrate-create",
		Plan: &types.Plan{
			Nodes: []types.NodeSpec{
				{ID: "node1", Type: "agent", AgentID: "mentatlab.echo"},
			},
		},
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp CreateRunResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/v1/runs/"+resp.RunID, nil)
	getW := httptest.NewRecorder()
	srv.Router().ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected 200 on get run, got %d: %s", getW.Code, getW.Body.String())
	}

	var run types.Run
	if err := json.NewDecoder(getW.Body).Decode(&run); err != nil {
		t.Fatalf("failed to decode run: %v", err)
	}
	if run.Plan == nil || len(run.Plan.Nodes) != 1 {
		t.Fatalf("expected run plan with one node, got %+v", run.Plan)
	}

	node := run.Plan.Nodes[0]
	if got, want := node.Command, []string{"python", "agents/echo/main.py"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("expected hydrated command %v, got %v", want, got)
	}
	if got, want := node.Image, "registry.harbor.lan/library/mentatlab-echoagent:latest"; got != want {
		t.Fatalf("expected hydrated image %q, got %q", want, got)
	}
}

func TestStartRunHydratesLegacyPlanBeforeExecution(t *testing.T) {
	srv, calls := newHydrationTestServer(t)
	store := srv.handlers.store
	ctx := t.Context()

	runID, err := store.CreateRun(ctx, "legacy-hydration", &types.Plan{
		Nodes: []types.NodeSpec{
			{ID: "node1", Type: "agent", AgentID: "mentatlab.echo"},
		},
	}, "")
	if err != nil {
		t.Fatalf("CreateRun failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs/"+runID+"/start", nil)
	w := httptest.NewRecorder()
	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	select {
	case call := <-calls:
		if got, want := call.Command, []string{"python", "agents/echo/main.py"}; len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
			t.Fatalf("expected hydrated command %v, got %v", want, got)
		}
		if got, want := call.Env["AGENT_IMAGE"], "registry.harbor.lan/library/mentatlab-echoagent:latest"; got != want {
			t.Fatalf("expected hydrated AGENT_IMAGE %q, got %q", want, got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for hydrated node execution")
	}
}
