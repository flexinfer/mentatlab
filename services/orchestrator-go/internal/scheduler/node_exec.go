package scheduler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/metrics"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// scheduleNode starts execution of a single node.
func (s *Scheduler) scheduleNode(ctx context.Context, rctx *runContext, nodeID string, spec *types.NodeSpec, attempts int, startTime time.Time) {
	_, span := tracer.Start(ctx, "scheduler.scheduleNode",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
			attribute.String("node_id", nodeID),
			attribute.Int("attempt", attempts+1),
		),
	)
	defer span.End()

	// Create cancellable context for this node
	nodeCtx, cancel := context.WithCancel(ctx)

	rctx.tasksMu.Lock()
	rctx.tasks[nodeID] = cancel
	rctx.tasksMu.Unlock()

	// Update node state to running
	startedAt := startTime
	state := &types.NodeState{
		NodeID:    nodeID,
		Status:    types.NodeStatusRunning,
		StartedAt: &startedAt,
		Retries:   attempts,
	}
	if err := s.store.UpdateNodeState(ctx, rctx.runID, nodeID, state); err != nil {
		s.logger.Error("failed to update node state", slog.String("run_id", rctx.runID), slog.String("node_id", nodeID), slog.Any("error", err))
	}

	// Execute in goroutine
	go func() {
		defer func() {
			rctx.tasksMu.Lock()
			delete(rctx.tasks, nodeID)
			rctx.tasksMu.Unlock()
		}()

		// Acquire semaphore if parallelism limited
		if s.sem != nil {
			select {
			case s.sem <- struct{}{}:
				defer func() { <-s.sem }()
			case <-nodeCtx.Done():
				return
			}
		}

		releaseAgentSlot, err := s.acquireAgentSlot(nodeCtx, spec)
		if err != nil {
			return
		}
		defer releaseAgentSlot()

		// Resolve executor
		nodeType := "agent"
		if spec.Gate != nil {
			nodeType = "gate"
		} else if spec.Conditional != nil {
			nodeType = "conditional"
		} else if spec.ForEach != nil {
			nodeType = "foreach"
		}

		executor, ok := s.executors[nodeType]
		if !ok {
			s.logger.Error("unknown node type", slog.String("node_id", nodeID), slog.String("type", nodeType))
			s.onNodeFinished(ctx, rctx, nodeID, 1)
			return
		}

		exitCode, err := executor.Execute(nodeCtx, s, rctx, nodeID, spec)
		if err != nil {
			s.logger.Error("node execution failed",
				slog.String("run_id", rctx.runID),
				slog.String("node_id", nodeID),
				slog.String("type", nodeType),
				slog.Any("error", err))
			// Ensure we have a non-zero exit code if error occurred
			if exitCode == 0 {
				exitCode = 1
			}
		}

		s.onNodeFinished(ctx, rctx, nodeID, exitCode)
	}()
}

// onNodeFinished handles node completion - success, failure, or retry.
func (s *Scheduler) onNodeFinished(ctx context.Context, rctx *runContext, nodeID string, exitCode int) {
	_, span := tracer.Start(ctx, "scheduler.onNodeFinished",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
			attribute.String("node_id", nodeID),
			attribute.Int("exit_code", exitCode),
		),
	)
	defer span.End()

	spec := rctx.nodeSpecs[nodeID]
	finishedAt := time.Now().UTC()

	// Get current state for attempt count
	state, _ := s.store.GetNodeState(ctx, rctx.runID, nodeID)
	attempts := 0
	if state != nil {
		attempts = state.Retries
	}

	if exitCode == 0 {
		// Success - update state and unlock downstream
		newState := &types.NodeState{
			NodeID:     nodeID,
			Status:     types.NodeStatusSucceeded,
			FinishedAt: &finishedAt,
			ExitCode:   &exitCode,
			Retries:    attempts,
		}
		if state != nil && state.StartedAt != nil {
			newState.StartedAt = state.StartedAt
			duration := finishedAt.Sub(*state.StartedAt).Seconds()
			metrics.NodeDuration.WithLabelValues("succeeded").Observe(duration)
		}
		s.store.UpdateNodeState(ctx, rctx.runID, nodeID, newState)
		metrics.NodesTotal.WithLabelValues("succeeded").Inc()
		metrics.NodeRetries.WithLabelValues("succeeded").Observe(float64(attempts))
		s.addNodeUpdate(ctx, rctx, nodeID, types.NodeStatusSucceeded, exitCode)

		// Unlock downstream nodes
		for downstream := range rctx.dependents[nodeID] {
			rctx.remainingPreds[downstream]--
		}
	} else {
		// Failure - check if we should retry.
		// Exit code 3 is the "retryable" convention: agents emit this for
		// transient failures (e.g. model loading). It enables automatic
		// retry even when no explicit retry_policy is configured.
		maxRetries, backoffSec := s.resolveRetryPolicy(spec, attempts)
		if exitCode == 3 && maxRetries < 3 {
			maxRetries = 3 // ensure at least 3 retries for transient failures
		}
		willRetry := attempts < maxRetries
		span.SetAttributes(attribute.Bool("will_retry", willRetry))
		if willRetry {
			// Update state back to pending for retry
			newState := &types.NodeState{
				NodeID:     nodeID,
				Status:     types.NodeStatusPending,
				FinishedAt: &finishedAt,
				ExitCode:   &exitCode,
				Retries:    attempts + 1,
				Error:      fmt.Sprintf("exit_code=%d, retry in %.0fs", exitCode, backoffSec),
			}
			s.store.UpdateNodeState(ctx, rctx.runID, nodeID, newState)

			// Emit queued status with retry info
			s.emitNodeStatus(ctx, rctx.runID, nodeID, "queued", map[string]interface{}{
				"attempts": attempts + 1,
				"retryIn":  backoffSec,
			})

			// Schedule retry after backoff
			go func() {
				time.Sleep(time.Duration(backoffSec) * time.Second)
				// Re-check if still should retry
				rctx.cancelledMu.Lock()
				cancelled := rctx.cancelled
				rctx.cancelledMu.Unlock()
				if !cancelled {
					s.maybeScheduleReady(ctx, rctx)
				}
			}()
		} else {
			// Permanent failure
			newState := &types.NodeState{
				NodeID:     nodeID,
				Status:     types.NodeStatusFailed,
				FinishedAt: &finishedAt,
				ExitCode:   &exitCode,
				Retries:    attempts,
				Error:      fmt.Sprintf("exit_code=%d", exitCode),
			}
			if state != nil && state.StartedAt != nil {
				newState.StartedAt = state.StartedAt
				duration := finishedAt.Sub(*state.StartedAt).Seconds()
				metrics.NodeDuration.WithLabelValues("failed").Observe(duration)
			}
			s.store.UpdateNodeState(ctx, rctx.runID, nodeID, newState)
			metrics.NodesTotal.WithLabelValues("failed").Inc()
			metrics.NodeRetries.WithLabelValues("failed").Observe(float64(attempts))
			s.addNodeUpdate(ctx, rctx, nodeID, types.NodeStatusFailed, exitCode)
		}
	}
}

// resolveRetryPolicy returns the max retries and backoff seconds for a node.
func (s *Scheduler) resolveRetryPolicy(spec *types.NodeSpec, attempt int) (maxRetries int, backoffSec float64) {
	if spec.RetryPolicy != nil {
		rp := spec.RetryPolicy
		maxRetries = rp.MaxRetries

		base := rp.BackoffBase.Seconds()
		if base <= 0 {
			base = float64(s.defaultBackoffSecs)
		}
		maxBackoff := rp.BackoffMax.Seconds()
		if maxBackoff <= 0 {
			maxBackoff = 60
		}

		switch rp.BackoffType {
		case types.BackoffFixed:
			backoffSec = base
		case types.BackoffLinear:
			backoffSec = base * float64(attempt+1)
		default: // exponential (default)
			backoffSec = base * math.Pow(2, float64(attempt))
		}

		if backoffSec > maxBackoff {
			backoffSec = maxBackoff
		}
		return maxRetries, backoffSec
	}

	// Fallback to legacy Retries field / global defaults
	maxRetries = spec.Retries
	backoffSec = float64(s.defaultBackoffSecs) * math.Pow(2, float64(attempt))
	if backoffSec > 60 {
		backoffSec = 60
	}
	return maxRetries, backoffSec
}

// nodeExecutor implementations

type agentExecutor struct{}

func (e *agentExecutor) Execute(ctx context.Context, s *Scheduler, rctx *runContext, nodeID string, spec *types.NodeSpec) (int, error) {
	cmd := s.resolveCmd(spec)
	if len(cmd) == 0 {
		err := fmt.Errorf("command resolution failed for node %q: no command configured", nodeID)
		s.emitNodeStatus(ctx, rctx.runID, nodeID, "failed", map[string]interface{}{
			"reason": "command_resolution_failed",
			"error":  err.Error(),
		})
		return 1, err
	}

	// Build env
	env := make(map[string]string)
	for k, v := range spec.Env {
		env[k] = v
	}

	// ATTEMPT is handled via state lookup in onNodeFinished, but we pass it for the agent to know
	state, _ := s.store.GetNodeState(ctx, rctx.runID, nodeID)
	attempts := 0
	if state != nil {
		attempts = state.Retries
	}
	env["ATTEMPT"] = fmt.Sprintf("%d", attempts+1)

	rctx.sessionMu.Lock()
	sessionID := rctx.sessionID
	rctx.sessionMu.Unlock()
	if sessionID != "" {
		env["LOOM_SESSION_ID"] = sessionID
	}

	if spec.Image != "" {
		env["AGENT_IMAGE"] = spec.Image
	}
	if spec.HeartbeatTimeout > 0 {
		env["MENTAT_HEARTBEAT_TIMEOUT"] = spec.HeartbeatTimeout.String()
	}

	// Serialize MCP config into INPUT_SPEC if present and not already set
	if spec.MCP != nil && spec.MCP.ToolName != "" && env["INPUT_SPEC"] == "" {
		mcpSpec := map[string]any{
			"tool_name": spec.MCP.ToolName,
		}
		if spec.MCP.Server != "" {
			mcpSpec["mcp_server"] = spec.MCP.Server
		}
		if len(spec.MCP.ToolArgs) > 0 {
			mcpSpec["tool_args"] = spec.MCP.ToolArgs
		}
		if b, err := json.Marshal(mcpSpec); err == nil {
			env["INPUT_SPEC"] = string(b)
		}
	}

	// Populate global run and predecessor context into INPUT_CONTEXT
	if env["INPUT_CONTEXT"] == "" {
		evalEnv := s.buildExprEnvironment(ctx, rctx, spec)
		if b, err := json.Marshal(evalEnv); err == nil {
			env["INPUT_CONTEXT"] = string(b)
		}
	}

	timeout := 0.0
	if spec.Timeout > 0 {
		timeout = spec.Timeout.Seconds()
	}

	// [NEW] Fast-Path Native Execution for FlexInfer inferences
	if spec.MCP != nil && spec.MCP.ToolName == "flexinfer__inference_chat" {
		exitCode, err := s.runFlexInferNode(ctx, rctx, nodeID, spec, env)
		if err != nil {
			return exitCode, err
		}
		if exitCode == 0 {
			s.captureNodeOutputs(ctx, rctx.runID, nodeID)
		}
		return exitCode, nil
	}

	exitCode, err := s.driver.RunNode(ctx, rctx.runID, nodeID, cmd, env, timeout)
	if err != nil {
		return exitCode, err
	}

	if exitCode == 0 {
		s.captureNodeOutputs(ctx, rctx.runID, nodeID)
	}

	return exitCode, nil
}

func (s *Scheduler) acquireAgentSlot(ctx context.Context, spec *types.NodeSpec) (func(), error) {
	if spec == nil || spec.AgentID == "" || spec.Resources == nil || spec.Resources.MaxConcurrent <= 0 {
		return func() {}, nil
	}

	sem := s.agentSemaphore(spec.AgentID, spec.Resources.MaxConcurrent)
	select {
	case sem <- struct{}{}:
		return func() { <-sem }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *Scheduler) agentSemaphore(agentID string, limit int) chan struct{} {
	s.agentSemsMu.Lock()
	defer s.agentSemsMu.Unlock()

	if sem, ok := s.agentSems[agentID]; ok {
		return sem
	}

	sem := make(chan struct{}, limit)
	s.agentSems[agentID] = sem
	return sem
}

type gateExecutor struct{}

func (e *gateExecutor) Execute(ctx context.Context, s *Scheduler, rctx *runContext, nodeID string, spec *types.NodeSpec) (int, error) {
	return s.executeGate(ctx, rctx, nodeID, spec), nil
}

type conditionalExecutor struct{}

func (e *conditionalExecutor) Execute(ctx context.Context, s *Scheduler, rctx *runContext, nodeID string, spec *types.NodeSpec) (int, error) {
	err := s.executeConditional(ctx, rctx, spec)
	if err != nil {
		return 1, err
	}
	return 0, nil
}

type forEachExecutor struct{}

func (e *forEachExecutor) Execute(ctx context.Context, s *Scheduler, rctx *runContext, nodeID string, spec *types.NodeSpec) (int, error) {
	err := s.executeForEach(ctx, rctx, spec)
	if err != nil {
		return 1, err
	}
	return 0, nil
}

// runFlexInferNode executes a flexinfer__inference_chat node natively via HTTP, bypassing pod scheduling.
func (s *Scheduler) runFlexInferNode(ctx context.Context, rctx *runContext, nodeID string, spec *types.NodeSpec, env map[string]string) (int, error) {
	proxyURL := strings.TrimSpace(os.Getenv("FLEXINFER_PROXY_URL"))
	model := strings.TrimSpace(os.Getenv("FLEXINFER_MODEL"))
	apiKey := strings.TrimSpace(os.Getenv("FLEXINFER_API_KEY"))

	if spec.MCP != nil && len(spec.MCP.ToolArgs) > 0 {
		if rawURL, ok := spec.MCP.ToolArgs["proxy_url"].(string); ok && strings.TrimSpace(rawURL) != "" {
			proxyURL = strings.TrimSpace(rawURL)
		}
		if rawModel, ok := spec.MCP.ToolArgs["model"].(string); ok && strings.TrimSpace(rawModel) != "" {
			model = strings.TrimSpace(rawModel)
		}
		if rawKey, ok := spec.MCP.ToolArgs["api_key"].(string); ok && strings.TrimSpace(rawKey) != "" {
			apiKey = strings.TrimSpace(rawKey)
		}
	}

	if proxyURL == "" || model == "" {
		err := fmt.Errorf("missing flexinfer configuration: proxy_url and model must be set")
		s.emitNodeStatus(ctx, rctx.runID, nodeID, "failed", map[string]interface{}{
			"reason": "flexinfer_config_missing",
			"error":  err.Error(),
		})
		return 1, err
	}

	var messages interface{}
	if spec.MCP != nil {
		if msg, hasMsg := spec.MCP.ToolArgs["messages"]; hasMsg {
			messages = msg
		} else if prompt, ok := spec.MCP.ToolArgs["prompt"].(string); ok && prompt != "" {
			messages = []map[string]string{{"role": "user", "content": prompt}}
		}
	}
	if messages == nil {
		prompt := strings.TrimSpace(os.Getenv("FLEXINFER_PROMPT"))
		if prompt != "" {
			messages = []map[string]string{{"role": "user", "content": prompt}}
		} else {
			err := fmt.Errorf("missing messages or prompt for flexinfer inference")
			s.emitNodeStatus(ctx, rctx.runID, nodeID, "failed", map[string]interface{}{"error": err.Error()})
			return 1, err
		}
	}

	bodyMap := map[string]interface{}{
		"model":    model,
		"messages": messages,
	}
	if spec.MCP != nil {
		if temp, ok := spec.MCP.ToolArgs["temperature"]; ok {
			bodyMap["temperature"] = temp
		}
		if mt, ok := spec.MCP.ToolArgs["max_tokens"]; ok {
			bodyMap["max_tokens"] = mt
		}
	}

	bodyBytes, err := json.Marshal(bodyMap)
	if err != nil {
		return 1, err
	}

	endpoint := strings.TrimRight(proxyURL, "/") + "/v1/chat/completions"
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return 1, err
	}

	req.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}

	start := time.Now()
	client := &http.Client{Timeout: 30 * time.Second}
	if spec.Timeout > 0 {
		client.Timeout = spec.Timeout
	}

	resp, err := client.Do(req)
	durationSeconds := time.Since(start).Seconds()

	if err != nil {
		s.emitEvent(ctx, rctx.runID, "output", map[string]interface{}{
			"key": "error",
			"value": map[string]interface{}{
				"error":     "flexinfer HTTP call failed",
				"tool_name": "flexinfer__inference_chat",
				"details":   err.Error(),
			},
		}, nodeID, "error")
		return 1, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var parsedResult interface{}
	if err := json.Unmarshal(respBody, &parsedResult); err != nil {
		parsedResult = map[string]string{"raw": string(respBody)}
	}

	payload := map[string]interface{}{
		"tool_name": "flexinfer__inference_chat",
		"tool_args": spec.MCP.ToolArgs,
		"result":    parsedResult,
		"mentat_meta": map[string]interface{}{
			"seconds": durationSeconds,
			"model":   "orchestrator-native/1.0",
		},
	}
	if spec.MCP != nil {
		payload["mcp_server"] = spec.MCP.Server
	}
	if resp.StatusCode >= 400 {
		payload["stderr"] = fmt.Sprintf("HTTP ERROR %d: %s", resp.StatusCode, string(respBody))
	}

	s.emitEvent(ctx, rctx.runID, "output", map[string]interface{}{
		"key":   "result",
		"value": payload,
	}, nodeID, "")

	if resp.StatusCode >= 400 {
		return 1, fmt.Errorf("flexinfer returned status %d", resp.StatusCode)
	}

	return 0, nil
}
