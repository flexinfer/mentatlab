package mcpclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const (
	defaultHubURL         = "wss://mcp.flexinfer.ai/ws"
	defaultHubProfile     = "codex"
	defaultRequestTimeout = 30 * time.Second
	jsonRPCVersion        = "2.0"
	protocolVersion       = "2024-11-05"
)

var defaultHubServers = []string{
	"agent_context",
	"docker",
	"flux",
	"github",
	"gitlab",
	"jobsearch",
	"loki",
	"prometheus",
	"time",
}

// Tool describes an MCP tool exposed through the hub catalog.
type Tool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	Server      string                 `json:"server,omitempty"`
	InputSchema map[string]interface{} `json:"inputSchema,omitempty"`
}

// ClientInfo identifies the WebSocket MCP client during initialization.
type ClientInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// Config controls remote MCP catalog discovery and tool execution.
type Config struct {
	HubURL               string
	CatalogURL           string
	Profile              string
	Servers              []string
	CFAccessClientID     string
	CFAccessClientSecret string
	Token                string
	HTTPClient           *http.Client
	ClientInfo           ClientInfo
}

// Client provides catalog discovery over HTTP and tool execution over the hub WebSocket transport.
type Client struct {
	cfg        Config
	httpClient *http.Client
}

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type initializeParams struct {
	ProtocolVersion string     `json:"protocolVersion"`
	Capabilities    any        `json:"capabilities"`
	ClientInfo      ClientInfo `json:"clientInfo"`
}

type initializeResult struct {
	ProtocolVersion string `json:"protocolVersion"`
}

type callToolParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments,omitempty"`
}

type callToolResult struct {
	Content []toolContent `json:"content"`
	IsError bool          `json:"isError,omitempty"`
}

type toolListResult struct {
	Tools []toolDefinition `json:"tools"`
}

type toolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description,omitempty"`
	InputSchema map[string]interface{} `json:"inputSchema,omitempty"`
}

type toolContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

// New creates a client with sensible defaults.
func New(cfg Config) *Client {
	if strings.TrimSpace(cfg.HubURL) == "" {
		cfg.HubURL = defaultHubURL
	}
	if strings.TrimSpace(cfg.Profile) == "" {
		cfg.Profile = defaultHubProfile
	}
	if strings.TrimSpace(cfg.CatalogURL) == "" {
		cfg.CatalogURL = DefaultCatalogURL(cfg.HubURL)
	}
	if len(cfg.Servers) == 0 {
		cfg.Servers = append([]string(nil), defaultHubServers...)
	}
	if strings.TrimSpace(cfg.ClientInfo.Name) == "" {
		cfg.ClientInfo = ClientInfo{Name: "mentatlab-orchestrator", Version: "1.0.0"}
	}
	httpClient := cfg.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultRequestTimeout}
	}
	return &Client{cfg: cfg, httpClient: httpClient}
}

// DefaultCatalogURL derives the HTTP OpenAPI catalog URL from a hub WebSocket URL.
func DefaultCatalogURL(hubURL string) string {
	if strings.TrimSpace(hubURL) == "" {
		hubURL = defaultHubURL
	}

	u, err := url.Parse(hubURL)
	if err != nil {
		return "https://mcp.flexinfer.ai/openapi.json"
	}
	switch u.Scheme {
	case "wss":
		u.Scheme = "https"
	case "ws":
		u.Scheme = "http"
	case "":
		u.Scheme = "https"
	}
	u.Path = "/openapi.json"
	u.RawQuery = ""
	u.Fragment = ""
	return u.String()
}

// ParseServerList turns a comma-separated env value into stable server names.
func ParseServerList(raw string) []string {
	parts := strings.Split(raw, ",")
	servers := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		server := strings.TrimSpace(part)
		if server == "" {
			continue
		}
		if _, exists := seen[server]; exists {
			continue
		}
		seen[server] = struct{}{}
		servers = append(servers, server)
	}
	return servers
}

// FetchTools returns the aggregated MCP tool inventory by reading the hub's OpenAPI catalog.
func (c *Client) FetchTools(ctx context.Context) ([]Tool, error) {
	if strings.TrimSpace(c.cfg.CatalogURL) != "" {
		catalog, err := c.fetchJSON(ctx, c.cfg.CatalogURL)
		if err == nil {
			serverNames := discoverServerNames(catalog)
			if len(serverNames) == 0 {
				return []Tool{}, nil
			}

			tools := make([]Tool, 0, 128)
			seen := make(map[string]struct{})
			for _, serverName := range serverNames {
				serverSpecURL, err := serverOpenAPIURL(c.cfg.CatalogURL, serverName)
				if err != nil {
					return nil, fmt.Errorf("build server catalog url for %s: %w", serverName, err)
				}
				spec, err := c.fetchJSON(ctx, serverSpecURL)
				if err != nil {
					return nil, fmt.Errorf("fetch %s catalog: %w", serverName, err)
				}
				for _, tool := range toolsFromServerSpec(serverName, spec) {
					if _, exists := seen[tool.Name]; exists {
						continue
					}
					seen[tool.Name] = struct{}{}
					tools = append(tools, tool)
				}
			}

			sort.Slice(tools, func(i, j int) bool {
				if tools[i].Server == tools[j].Server {
					return tools[i].Name < tools[j].Name
				}
				return tools[i].Server < tools[j].Server
			})
			return tools, nil
		}
		if len(c.cfg.Servers) == 0 {
			return nil, fmt.Errorf("fetch hub catalog: %w", err)
		}
	}

	return c.fetchToolsFromServers(ctx, c.cfg.Servers)
}

// CallTool executes a namespaced tool through the hub WebSocket transport.
func (c *Client) CallTool(ctx context.Context, toolName string, args map[string]interface{}) (interface{}, error) {
	serverName, localToolName, err := splitToolName(toolName)
	if err != nil {
		return nil, err
	}

	conn, err := c.connectWebSocket(ctx, serverName)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if err := c.initialize(ctx, conn); err != nil {
		return nil, err
	}

	params, err := json.Marshal(callToolParams{
		Name:      localToolName,
		Arguments: toAnyMap(args),
	})
	if err != nil {
		return nil, fmt.Errorf("marshal tools/call params: %w", err)
	}
	if err := conn.WriteJSON(rpcMessage{
		JSONRPC: jsonRPCVersion,
		ID:      1,
		Method:  "tools/call",
		Params:  params,
	}); err != nil {
		return nil, fmt.Errorf("send tools/call request: %w", err)
	}

	var resp rpcMessage
	if err := conn.ReadJSON(&resp); err != nil {
		return nil, fmt.Errorf("receive tools/call response: %w", err)
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("hub tools/call error (%d): %s", resp.Error.Code, resp.Error.Message)
	}

	return parseCallToolResult(resp.Result)
}

func (c *Client) fetchJSON(ctx context.Context, rawURL string) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	for key, value := range c.httpHeaders() {
		req.Header.Set(key, value)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode json: %w", err)
	}
	return payload, nil
}

func (c *Client) connectWebSocket(ctx context.Context, serverName string) (*websocket.Conn, error) {
	endpoint, err := url.Parse(c.cfg.HubURL)
	if err != nil {
		return nil, fmt.Errorf("parse hub url: %w", err)
	}
	query := endpoint.Query()
	query.Set("server", serverName)
	if strings.TrimSpace(c.cfg.Profile) != "" {
		query.Set("profile", c.cfg.Profile)
	}
	endpoint.RawQuery = query.Encode()

	headers := http.Header{}
	for key, value := range c.httpHeaders() {
		headers.Set(key, value)
	}

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, _, err := dialer.DialContext(ctx, endpoint.String(), headers)
	if err != nil {
		return nil, fmt.Errorf("connect hub websocket: %w", err)
	}
	return conn, nil
}

func (c *Client) fetchToolsFromServers(ctx context.Context, serverNames []string) ([]Tool, error) {
	tools := make([]Tool, 0, 128)
	seen := make(map[string]struct{})
	var lastErr error

	for _, rawServer := range serverNames {
		serverName := strings.TrimSpace(rawServer)
		if serverName == "" {
			continue
		}

		serverTools, err := c.fetchServerTools(ctx, serverName)
		if err != nil {
			lastErr = err
			continue
		}
		for _, tool := range serverTools {
			if _, exists := seen[tool.Name]; exists {
				continue
			}
			seen[tool.Name] = struct{}{}
			tools = append(tools, tool)
		}
	}

	if len(tools) == 0 && lastErr != nil {
		return nil, lastErr
	}

	sort.Slice(tools, func(i, j int) bool {
		if tools[i].Server == tools[j].Server {
			return tools[i].Name < tools[j].Name
		}
		return tools[i].Server < tools[j].Server
	})
	return tools, nil
}

func (c *Client) fetchServerTools(ctx context.Context, serverName string) ([]Tool, error) {
	conn, err := c.connectWebSocket(ctx, serverName)
	if err != nil {
		return nil, fmt.Errorf("connect %s websocket: %w", serverName, err)
	}
	defer conn.Close()

	if err := c.initialize(ctx, conn); err != nil {
		return nil, fmt.Errorf("initialize %s websocket: %w", serverName, err)
	}

	params, err := json.Marshal(map[string]any{})
	if err != nil {
		return nil, fmt.Errorf("marshal tools/list params: %w", err)
	}
	if err := conn.WriteJSON(rpcMessage{
		JSONRPC: jsonRPCVersion,
		ID:      1,
		Method:  "tools/list",
		Params:  params,
	}); err != nil {
		return nil, fmt.Errorf("send tools/list request for %s: %w", serverName, err)
	}

	var resp rpcMessage
	if err := conn.ReadJSON(&resp); err != nil {
		return nil, fmt.Errorf("receive tools/list response for %s: %w", serverName, err)
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("hub tools/list error for %s (%d): %s", serverName, resp.Error.Code, resp.Error.Message)
	}

	var result toolListResult
	if len(resp.Result) > 0 {
		if err := json.Unmarshal(resp.Result, &result); err != nil {
			return nil, fmt.Errorf("decode tools/list response for %s: %w", serverName, err)
		}
	}

	tools := make([]Tool, 0, len(result.Tools))
	for _, item := range result.Tools {
		localName := strings.TrimSpace(item.Name)
		if localName == "" {
			continue
		}
		tools = append(tools, Tool{
			Name:        serverName + "__" + localName,
			Description: strings.TrimSpace(item.Description),
			Server:      serverName,
			InputSchema: cloneMap(item.InputSchema),
		})
	}
	return tools, nil
}

func (c *Client) initialize(ctx context.Context, conn *websocket.Conn) error {
	params, err := json.Marshal(initializeParams{
		ProtocolVersion: protocolVersion,
		Capabilities:    map[string]any{},
		ClientInfo:      c.cfg.ClientInfo,
	})
	if err != nil {
		return fmt.Errorf("marshal initialize params: %w", err)
	}

	if err := conn.WriteJSON(rpcMessage{
		JSONRPC: jsonRPCVersion,
		ID:      1,
		Method:  "initialize",
		Params:  params,
	}); err != nil {
		return fmt.Errorf("send initialize request: %w", err)
	}

	var initResp rpcMessage
	if err := conn.ReadJSON(&initResp); err != nil {
		return fmt.Errorf("receive initialize response: %w", err)
	}
	if initResp.Error != nil {
		return fmt.Errorf("initialize error (%d): %s", initResp.Error.Code, initResp.Error.Message)
	}

	var payload initializeResult
	if len(initResp.Result) > 0 {
		if err := json.Unmarshal(initResp.Result, &payload); err != nil {
			return fmt.Errorf("decode initialize response: %w", err)
		}
	}
	if strings.TrimSpace(payload.ProtocolVersion) == "" {
		return fmt.Errorf("initialize response missing protocolVersion")
	}

	if err := conn.WriteJSON(rpcMessage{
		JSONRPC: jsonRPCVersion,
		Method:  "notifications/initialized",
	}); err != nil {
		return fmt.Errorf("send initialized notification: %w", err)
	}

	return nil
}

func (c *Client) httpHeaders() map[string]string {
	headers := make(map[string]string)
	if strings.TrimSpace(c.cfg.Token) != "" {
		headers["Authorization"] = "Bearer " + strings.TrimSpace(c.cfg.Token)
	}
	if strings.TrimSpace(c.cfg.CFAccessClientID) != "" && strings.TrimSpace(c.cfg.CFAccessClientSecret) != "" {
		headers["CF-Access-Client-Id"] = strings.TrimSpace(c.cfg.CFAccessClientID)
		headers["CF-Access-Client-Secret"] = strings.TrimSpace(c.cfg.CFAccessClientSecret)
	}
	return headers
}

func splitToolName(toolName string) (serverName string, localToolName string, err error) {
	parts := strings.SplitN(strings.TrimSpace(toolName), "__", 2)
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", "", fmt.Errorf("tool %q is not namespaced as server__tool", toolName)
	}
	return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1]), nil
}

func discoverServerNames(catalog map[string]any) []string {
	paths, _ := catalog["paths"].(map[string]any)
	serverSet := make(map[string]struct{})
	for path := range paths {
		trimmed := strings.Trim(path, "/")
		parts := strings.Split(trimmed, "/")
		if len(parts) != 2 {
			continue
		}
		if parts[1] != "openapi.json" && parts[1] != "docs" {
			continue
		}
		if parts[0] == "" {
			continue
		}
		serverSet[parts[0]] = struct{}{}
	}

	serverNames := make([]string, 0, len(serverSet))
	for name := range serverSet {
		serverNames = append(serverNames, name)
	}
	sort.Strings(serverNames)
	return serverNames
}

func serverOpenAPIURL(catalogURL, serverName string) (string, error) {
	u, err := url.Parse(catalogURL)
	if err != nil {
		return "", err
	}
	u.Path = "/" + strings.Trim(serverName, "/") + "/openapi.json"
	u.RawQuery = ""
	u.Fragment = ""
	return u.String(), nil
}

func toolsFromServerSpec(serverName string, spec map[string]any) []Tool {
	paths, _ := spec["paths"].(map[string]any)
	tools := make([]Tool, 0, len(paths))
	for path, rawPathItem := range paths {
		pathItem, ok := rawPathItem.(map[string]any)
		if !ok {
			continue
		}
		post, ok := pathItem["post"].(map[string]any)
		if !ok {
			continue
		}

		localName := strings.Trim(strings.Trim(path, "/"), " ")
		if localName == "" {
			continue
		}
		localName = strings.ReplaceAll(localName, "/", "_")
		tool := Tool{
			Name:        serverName + "__" + localName,
			Server:      serverName,
			Description: firstNonEmptyString(post["summary"], post["description"]),
			InputSchema: extractInputSchema(post),
		}
		tools = append(tools, tool)
	}
	sort.Slice(tools, func(i, j int) bool { return tools[i].Name < tools[j].Name })
	return tools
}

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		if s, ok := value.(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func extractInputSchema(post map[string]any) map[string]interface{} {
	requestBody, _ := post["requestBody"].(map[string]any)
	content, _ := requestBody["content"].(map[string]any)
	jsonContent, _ := content["application/json"].(map[string]any)
	schema, _ := jsonContent["schema"].(map[string]any)
	if schema == nil {
		return nil
	}
	return cloneMap(schema)
}

func cloneMap(in map[string]any) map[string]interface{} {
	if in == nil {
		return nil
	}
	out := make(map[string]interface{}, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func parseCallToolResult(raw json.RawMessage) (interface{}, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}

	var result callToolResult
	if err := json.Unmarshal(raw, &result); err != nil {
		var generic any
		if directErr := json.Unmarshal(raw, &generic); directErr == nil {
			return generic, nil
		}
		return nil, fmt.Errorf("decode call result: %w", err)
	}
	if result.IsError {
		return nil, errors.New(extractErrorText(result))
	}
	if len(result.Content) == 0 {
		return map[string]any{}, nil
	}

	if len(result.Content) == 1 {
		return parseContentValue(result.Content[0]), nil
	}

	values := make([]any, 0, len(result.Content))
	for _, item := range result.Content {
		values = append(values, parseContentValue(item))
	}
	return values, nil
}

func parseContentValue(content toolContent) any {
	if strings.TrimSpace(content.Text) == "" {
		return map[string]any{"type": content.Type}
	}
	var decoded any
	if err := json.Unmarshal([]byte(content.Text), &decoded); err == nil {
		return decoded
	}
	return map[string]any{
		"type": content.Type,
		"text": content.Text,
	}
}

func extractErrorText(result callToolResult) string {
	parts := make([]string, 0, len(result.Content))
	for _, content := range result.Content {
		if strings.TrimSpace(content.Text) != "" {
			parts = append(parts, strings.TrimSpace(content.Text))
		}
	}
	if len(parts) == 0 {
		return "remote MCP tool returned an error"
	}
	return strings.Join(parts, "; ")
}

func toAnyMap(values map[string]interface{}) map[string]any {
	if len(values) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}
