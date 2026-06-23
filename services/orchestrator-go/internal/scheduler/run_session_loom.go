package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"regexp"
	"strings"
)

var sessionIDPattern = regexp.MustCompile(`session_id:\s*"?([A-Za-z0-9_-]+)"?`)

// LoomRunSessionManagerConfig configures the loom-backed run session manager.
type LoomRunSessionManagerConfig struct {
	LoomBin   string
	AgentID   string
	Namespace string
	Logger    *slog.Logger
}

// LoomRunSessionManager manages run sessions by calling loom agent_context tools.
type LoomRunSessionManager struct {
	loomBin   string
	agentID   string
	namespace string
	logger    *slog.Logger
}

// NewLoomRunSessionManager creates a loom-backed run session manager.
func NewLoomRunSessionManager(cfg LoomRunSessionManagerConfig) *LoomRunSessionManager {
	loomBin := strings.TrimSpace(cfg.LoomBin)
	if loomBin == "" {
		loomBin = "loom"
	}
	agentID := strings.TrimSpace(cfg.AgentID)
	if agentID == "" {
		agentID = "mentatlab-orchestrator"
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &LoomRunSessionManager{
		loomBin:   loomBin,
		agentID:   agentID,
		namespace: strings.TrimSpace(cfg.Namespace),
		logger:    logger,
	}
}

// StartRunSession creates an agent-context session and returns its session ID.
func (m *LoomRunSessionManager) StartRunSession(ctx context.Context, runID, runName, flowID, owner string) (string, error) {
	description := fmt.Sprintf("MentatLab run %s (%s)", runID, runName)
	if owner != "" {
		description = fmt.Sprintf("%s owner=%s", description, owner)
	}
	args := map[string]interface{}{
		"agent_id":    m.agentID,
		"description": description,
	}
	namespace := m.namespace
	if flowID != "" {
		namespace = fmt.Sprintf("mentatlab/%s", flowID)
	}
	if namespace != "" {
		args["namespace"] = namespace
	}

	raw, err := m.callTool(ctx, "agent_context__agent_session_start", args)
	if err != nil {
		return "", err
	}
	sessionID, err := extractSessionID(raw)
	if err != nil {
		return "", fmt.Errorf("parse session_id from loom response: %w", err)
	}
	return sessionID, nil
}

// AddRunUpdate appends a lifecycle update entry to the linked session.
func (m *LoomRunSessionManager) AddRunUpdate(ctx context.Context, sessionID, runID, status, content string, metadata map[string]interface{}) error {
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	metadata["run_id"] = runID
	metadata["status"] = status

	entry := map[string]interface{}{
		"entry_type": "task",
		"title":      fmt.Sprintf("Run %s", status),
		"content":    content,
		"metadata":   metadata,
		"tags":       []string{"mentatlab", "run", "lifecycle"},
	}
	args := map[string]interface{}{
		"session_id": sessionID,
		"entries":    []map[string]interface{}{entry},
	}
	_, err := m.callTool(ctx, "agent_context__agent_context_add", args)
	return err
}

// EndRunSession finalizes and summarizes the linked session.
func (m *LoomRunSessionManager) EndRunSession(ctx context.Context, sessionID string) error {
	args := map[string]interface{}{
		"session_id": sessionID,
		"cleanup":    true,
		"summarize":  true,
	}
	_, err := m.callTool(ctx, "agent_context__agent_session_end", args)
	return err
}

func (m *LoomRunSessionManager) callTool(ctx context.Context, tool string, args map[string]interface{}) (string, error) {
	argsJSON, err := json.Marshal(args)
	if err != nil {
		return "", fmt.Errorf("marshal args: %w", err)
	}

	cmd := exec.CommandContext(ctx, m.loomBin, "tools", "call", tool, "--json", "--args", string(argsJSON))
	out, err := cmd.CombinedOutput()
	trimmed := strings.TrimSpace(string(out))
	if err != nil {
		return "", fmt.Errorf("loom tools call %s failed: %w (output: %s)", tool, err, trimmed)
	}
	m.logger.Debug("loom tool call succeeded", "tool", tool, "output", trimmed)
	return trimmed, nil
}

func extractSessionID(raw string) (string, error) {
	type contentPart struct {
		Text string `json:"text"`
	}
	type loomResponse struct {
		Content []contentPart `json:"content"`
	}

	var resp loomResponse
	if err := json.Unmarshal([]byte(raw), &resp); err == nil {
		for _, c := range resp.Content {
			for _, line := range strings.Split(c.Text, "\n") {
				line = strings.TrimSpace(line)
				if !strings.HasPrefix(line, "session_id:") {
					continue
				}
				val := strings.TrimSpace(strings.TrimPrefix(line, "session_id:"))
				val = strings.Trim(val, "\"")
				if val != "" {
					return val, nil
				}
			}
		}
	}

	match := sessionIDPattern.FindStringSubmatch(raw)
	if len(match) < 2 {
		return "", fmt.Errorf("session_id not present")
	}
	return match[1], nil
}
