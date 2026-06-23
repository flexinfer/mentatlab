package mcpclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestDefaultCatalogURL(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		hubURL string
		want   string
	}{
		{name: "wss", hubURL: "wss://mcp.flexinfer.ai/ws", want: "https://mcp.flexinfer.ai/openapi.json"},
		{name: "ws", hubURL: "ws://mcp.internal/ws", want: "http://mcp.internal/openapi.json"},
		{name: "empty", hubURL: "", want: "https://mcp.flexinfer.ai/openapi.json"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := DefaultCatalogURL(tc.hubURL); got != tc.want {
				t.Fatalf("DefaultCatalogURL(%q) = %q, want %q", tc.hubURL, got, tc.want)
			}
		})
	}
}

func TestFetchToolsFromCatalog(t *testing.T) {
	t.Parallel()

	mux := http.NewServeMux()
	mux.HandleFunc("/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"paths": map[string]any{
				"/redis/openapi.json": map[string]any{},
				"/time/openapi.json":  map[string]any{},
				"/time/docs":          map[string]any{},
			},
		})
	})
	mux.HandleFunc("/time/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"paths": map[string]any{
				"/get_current_time": map[string]any{
					"post": map[string]any{
						"summary": "Get current time",
						"requestBody": map[string]any{
							"content": map[string]any{
								"application/json": map[string]any{
									"schema": map[string]any{
										"type": "object",
										"properties": map[string]any{
											"timezone": map[string]any{"type": "string"},
										},
									},
								},
							},
						},
					},
				},
			},
		})
	})
	mux.HandleFunc("/redis/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"paths": map[string]any{
				"/redis_info": map[string]any{
					"post": map[string]any{
						"description": "Inspect Redis",
					},
				},
			},
		})
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	client := New(Config{
		CatalogURL: server.URL + "/openapi.json",
		HTTPClient: server.Client(),
	})

	tools, err := client.FetchTools(context.Background())
	if err != nil {
		t.Fatalf("FetchTools returned error: %v", err)
	}
	if len(tools) != 2 {
		t.Fatalf("expected 2 tools, got %d", len(tools))
	}
	if tools[0].Name != "redis__redis_info" {
		t.Fatalf("unexpected first tool: %#v", tools[0])
	}
	if tools[1].Name != "time__get_current_time" {
		t.Fatalf("unexpected second tool: %#v", tools[1])
	}
	if tools[1].InputSchema == nil || tools[1].InputSchema["type"] != "object" {
		t.Fatalf("expected input schema to be preserved, got %#v", tools[1].InputSchema)
	}
}

func TestCallToolViaWebSocketHub(t *testing.T) {
	t.Parallel()

	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("server"); got != "time" {
			t.Fatalf("expected server=time query param, got %q", got)
		}
		if got := r.URL.Query().Get("profile"); got != defaultHubProfile {
			t.Fatalf("expected profile=%q, got %q", defaultHubProfile, got)
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Fatalf("upgrade websocket: %v", err)
		}
		defer conn.Close()

		var initReq rpcMessage
		if err := conn.ReadJSON(&initReq); err != nil {
			t.Fatalf("read initialize request: %v", err)
		}
		if initReq.Method != "initialize" {
			t.Fatalf("expected initialize request, got %q", initReq.Method)
		}

		initResp := rpcMessage{
			JSONRPC: jsonRPCVersion,
			ID:      initReq.ID,
		}
		initResp.Result, err = json.Marshal(initializeResult{
			ProtocolVersion: protocolVersion,
		})
		if err != nil {
			t.Fatalf("marshal init response: %v", err)
		}
		if err := conn.WriteJSON(initResp); err != nil {
			t.Fatalf("write initialize response: %v", err)
		}

		var initialized rpcMessage
		if err := conn.ReadJSON(&initialized); err != nil {
			t.Fatalf("read initialized notification: %v", err)
		}
		if initialized.Method != "notifications/initialized" {
			t.Fatalf("expected initialized notification, got %q", initialized.Method)
		}

		var callReq rpcMessage
		if err := conn.ReadJSON(&callReq); err != nil {
			t.Fatalf("read tools/call request: %v", err)
		}
		if callReq.Method != "tools/call" {
			t.Fatalf("expected tools/call request, got %q", callReq.Method)
		}

		var params callToolParams
		if err := json.Unmarshal(callReq.Params, &params); err != nil {
			t.Fatalf("decode tools/call params: %v", err)
		}
		if params.Name != "get_current_time" {
			t.Fatalf("expected local tool name, got %q", params.Name)
		}

		resultPayload, err := json.Marshal(callToolResult{
			Content: []toolContent{{
				Type: "text",
				Text: `{"now":"2026-03-20T12:00:00Z"}`,
			}},
		})
		if err != nil {
			t.Fatalf("marshal tool result: %v", err)
		}
		if err := conn.WriteJSON(rpcMessage{
			JSONRPC: jsonRPCVersion,
			ID:      callReq.ID,
			Result:  resultPayload,
		}); err != nil {
			t.Fatalf("write tools/call response: %v", err)
		}
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")
	client := New(Config{HubURL: wsURL})

	result, err := client.CallTool(context.Background(), "time__get_current_time", map[string]interface{}{
		"timezone": "UTC",
	})
	if err != nil {
		t.Fatalf("CallTool returned error: %v", err)
	}

	payload, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("expected map result, got %#v", result)
	}
	if payload["now"] != "2026-03-20T12:00:00Z" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestFetchToolsFallsBackToWebSocketServers(t *testing.T) {
	t.Parallel()

	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer httpServer.Close()

	upgrader := websocket.Upgrader{}
	wsServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("server"); got != "time" {
			t.Fatalf("expected server=time query param, got %q", got)
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Fatalf("upgrade websocket: %v", err)
		}
		defer conn.Close()

		var initReq rpcMessage
		if err := conn.ReadJSON(&initReq); err != nil {
			t.Fatalf("read initialize request: %v", err)
		}
		initResp := rpcMessage{
			JSONRPC: jsonRPCVersion,
			ID:      initReq.ID,
		}
		initResp.Result, err = json.Marshal(initializeResult{
			ProtocolVersion: protocolVersion,
		})
		if err != nil {
			t.Fatalf("marshal init response: %v", err)
		}
		if err := conn.WriteJSON(initResp); err != nil {
			t.Fatalf("write initialize response: %v", err)
		}

		var initialized rpcMessage
		if err := conn.ReadJSON(&initialized); err != nil {
			t.Fatalf("read initialized notification: %v", err)
		}

		var listReq rpcMessage
		if err := conn.ReadJSON(&listReq); err != nil {
			t.Fatalf("read tools/list request: %v", err)
		}
		if listReq.Method != "tools/list" {
			t.Fatalf("expected tools/list request, got %q", listReq.Method)
		}

		resultPayload, err := json.Marshal(toolListResult{
			Tools: []toolDefinition{{
				Name:        "get_current_time",
				Description: "Get current time",
				InputSchema: map[string]any{
					"type": "object",
				},
			}},
		})
		if err != nil {
			t.Fatalf("marshal tools/list result: %v", err)
		}
		if err := conn.WriteJSON(rpcMessage{
			JSONRPC: jsonRPCVersion,
			ID:      listReq.ID,
			Result:  resultPayload,
		}); err != nil {
			t.Fatalf("write tools/list response: %v", err)
		}
	}))
	defer wsServer.Close()

	wsURL := "ws" + strings.TrimPrefix(wsServer.URL, "http")
	client := New(Config{
		HubURL:     wsURL,
		CatalogURL: httpServer.URL + "/openapi.json",
		Servers:    []string{"time"},
		HTTPClient: httpServer.Client(),
	})

	tools, err := client.FetchTools(context.Background())
	if err != nil {
		t.Fatalf("FetchTools returned error: %v", err)
	}
	if len(tools) != 1 {
		t.Fatalf("expected 1 tool, got %d", len(tools))
	}
	if tools[0].Name != "time__get_current_time" {
		t.Fatalf("unexpected tool name: %#v", tools[0])
	}
}
