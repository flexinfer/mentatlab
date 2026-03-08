package scheduler

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoomRunSessionManagerLifecycleCalls(t *testing.T) {
	tmpDir := t.TempDir()
	callsFile := filepath.Join(tmpDir, "calls.log")
	loomScript := filepath.Join(tmpDir, "loom")

	script := `#!/bin/sh
echo "$@" >> "` + callsFile + `"
tool="$3"
if [ "$tool" = "agent_context__agent_session_start" ]; then
  echo '{"content":[{"text":"ok: true\nsession_id: test-session-123","type":"text"}]}'
  exit 0
fi
if [ "$tool" = "agent_context__agent_context_add" ]; then
  echo '{"content":[{"text":"ok: true","type":"text"}]}'
  exit 0
fi
if [ "$tool" = "agent_context__agent_session_end" ]; then
  echo '{"content":[{"text":"ok: true\nsummarized: true","type":"text"}]}'
  exit 0
fi
echo '{"content":[{"text":"ok: false","type":"text"}]}'
exit 1
`
	if err := os.WriteFile(loomScript, []byte(script), 0755); err != nil {
		t.Fatalf("write loom script: %v", err)
	}

	m := NewLoomRunSessionManager(LoomRunSessionManagerConfig{
		LoomBin: loomScript,
		Logger:  slog.Default(),
	})

	sessionID, err := m.StartRunSession(context.Background(), "run-1", "test", "", "owner@example.com")
	if err != nil {
		t.Fatalf("StartRunSession: %v", err)
	}
	if sessionID != "test-session-123" {
		t.Fatalf("expected session_id test-session-123, got %q", sessionID)
	}

	if err := m.AddRunUpdate(context.Background(), sessionID, "run-1", "running", "started", nil); err != nil {
		t.Fatalf("AddRunUpdate: %v", err)
	}
	if err := m.EndRunSession(context.Background(), sessionID); err != nil {
		t.Fatalf("EndRunSession: %v", err)
	}

	data, err := os.ReadFile(callsFile)
	if err != nil {
		t.Fatalf("read calls log: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 3 {
		t.Fatalf("expected 3 loom calls, got %d (%v)", len(lines), lines)
	}
	if !strings.Contains(lines[0], "agent_context__agent_session_start") {
		t.Fatalf("expected first call to start session, got %q", lines[0])
	}
	if !strings.Contains(lines[1], "agent_context__agent_context_add") {
		t.Fatalf("expected second call to add context, got %q", lines[1])
	}
	if !strings.Contains(lines[2], "agent_context__agent_session_end") {
		t.Fatalf("expected third call to end session, got %q", lines[2])
	}
}

func TestExtractSessionIDMissing(t *testing.T) {
	raw := `{"content":[{"text":"ok: true","type":"text"}]}`
	if _, err := extractSessionID(raw); err == nil {
		t.Fatal("expected error when session_id is missing")
	}
}
