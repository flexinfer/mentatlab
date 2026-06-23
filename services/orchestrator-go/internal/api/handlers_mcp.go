package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gorilla/mux"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/mcpclient"
)

const (
	defaultMCPPageSize = 100
	maxMCPPageSize     = 500
)

// MCPTool represents an MCP tool exposed to frontend clients.
type MCPTool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Server      string                 `json:"server,omitempty"`
	InputSchema map[string]interface{} `json:"inputSchema,omitempty"`
}

// MCPToolsFetcher retrieves the currently available MCP tools.
type MCPToolsFetcher func(ctx context.Context) ([]MCPTool, error)

// MCPToolCaller executes a namespaced MCP tool with structured arguments.
type MCPToolCaller func(ctx context.Context, toolName string, args map[string]interface{}) (interface{}, error)

// FetchMCPToolsFromHubCatalog uses the Loom hub catalog as the MCP inventory source.
func FetchMCPToolsFromHubCatalog(ctx context.Context, client *mcpclient.Client) ([]MCPTool, error) {
	rawTools, err := client.FetchTools(ctx)
	if err != nil {
		return nil, err
	}

	tools := make([]MCPTool, 0, len(rawTools))
	for _, tool := range rawTools {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		server := strings.TrimSpace(tool.Server)
		if server == "" {
			server = inferServerName(name)
		}
		tools = append(tools, MCPTool{
			Name:        name,
			Description: tool.Description,
			Server:      server,
			InputSchema: tool.InputSchema,
		})
	}
	return tools, nil
}

func inferServerName(toolName string) string {
	parts := strings.SplitN(toolName, "__", 2)
	if len(parts) != 2 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func parsePositiveInt(raw string, fallback int) int {
	if raw == "" {
		return fallback
	}
	var v int
	if _, err := fmt.Sscanf(raw, "%d", &v); err != nil || v <= 0 {
		return fallback
	}
	return v
}

func (h *Handlers) filteredMCPTools(tools []MCPTool, serverFilter string) []MCPTool {
	if serverFilter == "" {
		return tools
	}
	filtered := make([]MCPTool, 0, len(tools))
	for _, tool := range tools {
		if strings.EqualFold(tool.Server, serverFilter) {
			filtered = append(filtered, tool)
		}
	}
	return filtered
}

func paginateMCPTools(tools []MCPTool, page, pageSize int) ([]MCPTool, int) {
	total := len(tools)
	if total == 0 {
		return []MCPTool{}, 0
	}
	totalPages := (total + pageSize - 1) / pageSize
	if page > totalPages {
		return []MCPTool{}, totalPages
	}
	start := (page - 1) * pageSize
	if start >= total {
		return []MCPTool{}, totalPages
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return tools[start:end], totalPages
}

// ListMCPTools returns paginated MCP tool inventory for frontend clients.
func (h *Handlers) ListMCPTools(w http.ResponseWriter, r *http.Request) {
	tools, err := h.mcpFetcher(r.Context())
	if err != nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "failed to load mcp tools", err)
		return
	}

	query := r.URL.Query()
	serverFilter := strings.TrimSpace(query.Get("server"))
	page := parsePositiveInt(query.Get("page"), 1)
	pageSize := parsePositiveInt(query.Get("page_size"), defaultMCPPageSize)
	if pageSize > maxMCPPageSize {
		pageSize = maxMCPPageSize
	}
	if pageSize <= 0 {
		pageSize = defaultMCPPageSize
	}

	filtered := h.filteredMCPTools(tools, serverFilter)
	slice, totalPages := paginateMCPTools(filtered, page, pageSize)

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"server":     serverFilterOrAll(serverFilter),
		"page":       page,
		"pageSize":   pageSize,
		"totalTools": len(filtered),
		"totalPages": totalPages,
		"tools":      slice,
	})
}

// ListMCPToolsIndex returns index-style metadata and first-page tools.
func (h *Handlers) ListMCPToolsIndex(w http.ResponseWriter, r *http.Request) {
	tools, err := h.mcpFetcher(r.Context())
	if err != nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "failed to load mcp tool index", err)
		return
	}

	query := r.URL.Query()
	serverFilter := strings.TrimSpace(query.Get("server"))
	filtered := h.filteredMCPTools(tools, serverFilter)

	pageSize := parsePositiveInt(query.Get("page_size"), defaultMCPPageSize)
	if pageSize > maxMCPPageSize {
		pageSize = maxMCPPageSize
	}
	if pageSize <= 0 {
		pageSize = defaultMCPPageSize
	}

	page := parsePositiveInt(query.Get("page"), 1)
	slice, totalPages := paginateMCPTools(filtered, page, pageSize)

	h.respondJSON(w, http.StatusOK, map[string]interface{}{
		"server":     serverFilterOrAll(serverFilter),
		"page":       page,
		"pageSize":   pageSize,
		"totalTools": len(filtered),
		"totalPages": totalPages,
		"tools":      slice,
	})
}

func serverFilterOrAll(server string) string {
	if server == "" {
		return "all"
	}
	return server
}

// CallMCPTool proxies an executing request to the remote MCP hub.
func (h *Handlers) CallMCPTool(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	toolName := strings.TrimSpace(vars["name"])
	if toolName == "" {
		h.respondError(w, r, http.StatusBadRequest, "tool name is required", nil)
		return
	}

	// Read request body as arguments.
	args := map[string]interface{}{}
	if err := json.NewDecoder(r.Body).Decode(&args); err != nil && !errors.Is(err, io.EOF) {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}

	argsJSON, err := json.Marshal(args)
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to parse arguments", err)
		return
	}

	if h.mcpCaller == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "mcp runtime unavailable", errors.New("mcp caller not configured"))
		return
	}

	var typedArgs map[string]interface{}
	if err := json.Unmarshal(argsJSON, &typedArgs); err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to decode arguments", err)
		return
	}

	result, err := h.mcpCaller(r.Context(), toolName, typedArgs)
	if err != nil {
		if errors.Is(r.Context().Err(), context.DeadlineExceeded) {
			h.respondError(w, r, http.StatusGatewayTimeout, "mcp tool execution timed out", err)
			return
		}
		h.respondError(w, r, http.StatusBadGateway, "mcp tool execution failed", err)
		return
	}

	h.respondJSON(w, http.StatusOK, result)
}
