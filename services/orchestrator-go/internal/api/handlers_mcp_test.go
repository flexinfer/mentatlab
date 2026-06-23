package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/config"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
)

func newMCPTestServer(t *testing.T, fetcher MCPToolsFetcher, caller MCPToolCaller) *Server {
	t.Helper()

	store := runstore.NewMemoryStore(&runstore.Config{
		EventMaxLen: 1000,
		TTLSeconds:  3600,
	})
	opts := &HandlerOptions{
		Registry:   registry.NewMemoryRegistryWithDefaults(),
		FlowStore:  flowstore.NewMemoryStore(),
		MCPFetcher: fetcher,
		MCPCaller:  caller,
	}
	handlers := NewHandlers(store, nil, nil, config.Load(), nil, opts)
	return NewServer(handlers, nil, 0, 0)
}

func decodeJSONBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()
	var payload map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return payload
}

func TestListMCPToolsPagination(t *testing.T) {
	tools := []MCPTool{
		{Name: "alpha__one", Server: "alpha"},
		{Name: "alpha__two", Server: "alpha"},
		{Name: "beta__three", Server: "beta"},
	}
	srv := newMCPTestServer(t, func(context.Context) ([]MCPTool, error) {
		return tools, nil
	}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/mcp/tools?page=2&page_size=1", nil)
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body := decodeJSONBody(t, rec)
	if got := int(body["totalTools"].(float64)); got != 3 {
		t.Fatalf("expected totalTools=3, got %d", got)
	}
	if got := int(body["totalPages"].(float64)); got != 3 {
		t.Fatalf("expected totalPages=3, got %d", got)
	}

	items, ok := body["tools"].([]interface{})
	if !ok || len(items) != 1 {
		t.Fatalf("expected one paginated tool, got %v", body["tools"])
	}
	tool := items[0].(map[string]interface{})
	if got := tool["name"].(string); got != "alpha__two" {
		t.Fatalf("expected second tool on page 2, got %q", got)
	}
}

func TestListMCPToolsServerFilter(t *testing.T) {
	tools := []MCPTool{
		{Name: "gitlab__list_issues", Server: "gitlab"},
		{Name: "flexinfer__flexinfer_list_models", Server: "flexinfer"},
	}
	srv := newMCPTestServer(t, func(context.Context) ([]MCPTool, error) {
		return tools, nil
	}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/mcp/tools?server=gitlab", nil)
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body := decodeJSONBody(t, rec)
	items, ok := body["tools"].([]interface{})
	if !ok || len(items) != 1 {
		t.Fatalf("expected one filtered tool, got %v", body["tools"])
	}
	tool := items[0].(map[string]interface{})
	if got := tool["name"].(string); got != "gitlab__list_issues" {
		t.Fatalf("unexpected filtered tool: %q", got)
	}
}

func TestListMCPToolsIndexRoute(t *testing.T) {
	tools := []MCPTool{
		{Name: "agent_context__agent_session_start", Server: "agent_context"},
	}
	srv := newMCPTestServer(t, func(context.Context) ([]MCPTool, error) {
		return tools, nil
	}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/mcp/tools/index", nil)
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body := decodeJSONBody(t, rec)
	if got := int(body["totalTools"].(float64)); got != 1 {
		t.Fatalf("expected totalTools=1, got %d", got)
	}
}

func TestListMCPToolsFetcherError(t *testing.T) {
	srv := newMCPTestServer(t, func(context.Context) ([]MCPTool, error) {
		return nil, errors.New("boom")
	}, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/mcp/tools", nil)
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCallMCPToolAllowsEmptyBody(t *testing.T) {
	srv := newMCPTestServer(t, func(context.Context) ([]MCPTool, error) { return nil, nil }, func(ctx context.Context, toolName string, args map[string]interface{}) (interface{}, error) {
		if toolName != "agent_context__agent_session_start" {
			t.Fatalf("unexpected tool name: %q", toolName)
		}
		if len(args) != 0 {
			t.Fatalf("expected empty args, got %#v", args)
		}
		return map[string]any{"ok": true}, nil
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/mcp/tools/agent_context__agent_session_start/call", http.NoBody)
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body := decodeJSONBody(t, rec)
	if ok, _ := body["ok"].(bool); !ok {
		t.Fatalf("expected ok=true response, got %v", body)
	}
}

func TestCallMCPToolReturnsBadGatewayOnRemoteFailure(t *testing.T) {
	srv := newMCPTestServer(t, func(context.Context) ([]MCPTool, error) { return nil, nil }, func(ctx context.Context, toolName string, args map[string]interface{}) (interface{}, error) {
		return nil, errors.New("hub unavailable")
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/mcp/tools/agent_context__agent_session_start/call", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	srv.Router().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", rec.Code, rec.Body.String())
	}
}
