package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

const (
	defaultMCPPageSize = 100
	maxMCPPageSize     = 500
	mcpCLITimeout      = 10 * time.Second
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

type mcpToolsCLIResponse struct {
	Tools []struct {
		Name        string                 `json:"name"`
		Description string                 `json:"description"`
		InputSchema map[string]interface{} `json:"inputSchema"`
		Server      string                 `json:"server"`
	} `json:"tools"`
}

// FetchMCPToolsFromLoomCLI uses `loom tools list --json` as the MCP inventory source.
func FetchMCPToolsFromLoomCLI(ctx context.Context) ([]MCPTool, error) {
	ctx, cancel := context.WithTimeout(ctx, mcpCLITimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "loom", "tools", "list", "--json")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("run loom tools list: %w", err)
	}

	var raw mcpToolsCLIResponse
	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("decode loom tools response: %w", err)
	}

	tools := make([]MCPTool, 0, len(raw.Tools))
	for _, tool := range raw.Tools {
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

// CallMCPTool proxies an executing request to the Loom CLI:
// loom tools call <name> --json --args '<body_json>'
func (h *Handlers) CallMCPTool(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	toolName := strings.TrimSpace(vars["name"])
	if toolName == "" {
		h.respondError(w, r, http.StatusBadRequest, "tool name is required", nil)
		return
	}

	// Read request body as arguments.
	var args map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&args); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}

	argsJSON, err := json.Marshal(args)
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to parse arguments", err)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), mcpCLITimeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "loom", "tools", "call", toolName, "--json", "--args", string(argsJSON))

	// We want both stdout and stderr (which may contain JSON error details from loom CLI)
	// but currently loom tools call typically outputs JSON to stdout. We'll grab output.
	out, err := cmd.CombinedOutput()

	// The loom CLI outputs JSON. We can just pipe its JSON directly to the response.
	// But let's check if it's valid JSON to ensure we wrap it properly if it's a raw string or error.
	w.Header().Set("Content-Type", "application/json")

	if err != nil {
		// If command failed but output is valid JSON (e.g., loom emitted a structured error),
		// we should still return it with an appropriate HTTP status (e.g., 500 or 400).
		var structuredErr map[string]interface{}
		if jsonErr := json.Unmarshal(out, &structuredErr); jsonErr == nil {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write(out)
			return
		}

		// Fallback for non-JSON errors
		h.respondError(w, r, http.StatusInternalServerError, "mcp tool execution failed", fmt.Errorf("%s: %s", err, string(out)))
		return
	}

	// Success case: return the JSON output
	w.WriteHeader(http.StatusOK)
	w.Write(out)
}
