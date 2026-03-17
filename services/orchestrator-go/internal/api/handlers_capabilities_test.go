package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func TestCreateRunRejectsCapabilityMismatch(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	reg := registry.NewMemoryRegistry()
	_, err := reg.Create(t.Context(), &registry.CreateAgentRequest{
		ID:      "custom.mcp-lite",
		Name:    "Custom MCP Lite",
		Version: "1.0.0",
		Command: []string{"echo"},
		CapabilitySpec: &types.CapabilityDeclaration{
			Actions: []string{"call_tool"},
		},
		Resources: &types.ResourceRequirements{MaxConcurrent: 1},
	})
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}

	h := NewHandlers(store, nil, nil, config.Load(), nil, &HandlerOptions{
		Registry:  reg,
		FlowStore: flowstore.NewMemoryStore(),
	})
	srv := NewServer(h, nil, 0, 0)

	payload := CreateRunRequest{
		Name: "invalid-capabilities",
		Plan: &types.Plan{
			Nodes: []types.NodeSpec{
				{
					ID:      "node-1",
					Type:    "mcp:flexinfer-template-inference",
					AgentID: "custom.mcp-lite",
					Env: map[string]string{
						"INPUT_SPEC": `{"runtime_contract":{"kind":"flexinfer_inference","required_env":["FLEXINFER_PROXY_URL"]}}`,
					},
				},
			},
		},
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/runs", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	srv.Router().ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "network capability") {
		t.Fatalf("expected capability validation message, got %s", w.Body.String())
	}
}
