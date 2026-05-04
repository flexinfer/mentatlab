package scheduler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/mcpclient"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

type testRPCMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
}

type testInitializeResult struct {
	ProtocolVersion string `json:"protocolVersion"`
}

type testCallToolResult struct {
	Content []testToolContent `json:"content"`
}

type testToolContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

func TestAgentExecutorExecutesMCPNodeNatively(t *testing.T) {
	t.Parallel()

	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Fatalf("upgrade websocket: %v", err)
		}
		defer conn.Close()

		var initReq testRPCMessage
		if err := conn.ReadJSON(&initReq); err != nil {
			t.Fatalf("read initialize request: %v", err)
		}
		result, _ := json.Marshal(testInitializeResult{
			ProtocolVersion: "2024-11-05",
		})
		if err := conn.WriteJSON(testRPCMessage{
			JSONRPC: "2.0",
			ID:      initReq.ID,
			Result:  result,
		}); err != nil {
			t.Fatalf("write initialize response: %v", err)
		}

		var initialized testRPCMessage
		if err := conn.ReadJSON(&initialized); err != nil {
			t.Fatalf("read initialized notification: %v", err)
		}

		var callReq testRPCMessage
		if err := conn.ReadJSON(&callReq); err != nil {
			t.Fatalf("read tools/call request: %v", err)
		}

		callResult, _ := json.Marshal(testCallToolResult{
			Content: []testToolContent{{
				Type: "text",
				Text: `{"now":"2026-03-20T12:34:56Z"}`,
			}},
		})
		if err := conn.WriteJSON(testRPCMessage{
			JSONRPC: "2.0",
			ID:      callReq.ID,
			Result:  callResult,
		}); err != nil {
			t.Fatalf("write tools/call response: %v", err)
		}
	}))
	defer server.Close()

	store := runstore.NewMemoryStore(&runstore.Config{EventMaxLen: 1000, TTLSeconds: 3600})
	runID, err := store.CreateRun(context.Background(), "native-mcp", &types.Plan{}, "")
	if err != nil {
		t.Fatalf("create run: %v", err)
	}

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	client := mcpclient.New(mcpclient.Config{HubURL: wsURL})
	s := NewScheduler(store, nil, testCommandResolver, WithMCPClient(client))
	executor := &agentExecutor{}

	spec := &types.NodeSpec{
		ID:   "node-mcp-1",
		Type: "agent",
		MCP: &types.MCPConfig{
			ToolName: "time__get_current_time",
			Server:   "time",
			ToolArgs: map[string]any{"timezone": "UTC"},
		},
	}
	rctx := &runContext{runID: runID}

	exitCode, err := executor.Execute(context.Background(), s, rctx, spec.ID, spec)
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if exitCode != 0 {
		t.Fatalf("expected exit code 0, got %d", exitCode)
	}

	outputs, err := store.GetNodeOutputs(context.Background(), runID, spec.ID)
	if err != nil {
		t.Fatalf("GetNodeOutputs returned error: %v", err)
	}
	result, ok := outputs["result"].(map[string]any)
	if !ok {
		t.Fatalf("expected result payload map, got %#v", outputs["result"])
	}
	if result["tool_name"] != "time__get_current_time" {
		t.Fatalf("unexpected tool name payload: %#v", result)
	}
}
