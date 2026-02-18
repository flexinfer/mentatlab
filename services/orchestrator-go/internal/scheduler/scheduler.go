// Package scheduler provides DAG execution for orchestrator runs.
package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"sync"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/driver"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/metrics"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

var tracer = otel.Tracer("mentatlab/scheduler")

// CommandResolver resolves a NodeSpec to a command line to execute.
type CommandResolver func(node *types.NodeSpec) []string

// runContext holds the runtime state for a single run.
type runContext struct {
	runID          string
	name           string
	planTimeout    time.Duration
	nodeSpecs      map[string]*types.NodeSpec
	dependents     map[string]map[string]bool // node_id -> set of downstream ids
	remainingPreds map[string]int             // node_id -> count of predecessors not yet succeeded
	tasks          map[string]context.CancelFunc
	tasksMu        sync.Mutex
	gates          map[string]chan string // node_id -> channel receiving "approve" or "reject"
	gatesMu        sync.Mutex
	done           chan struct{}
	cancelled      bool
	cancelledMu    sync.Mutex
}

// Scheduler manages DAG execution for runs.
type Scheduler struct {
	store              runstore.RunStore
	driver             driver.Driver
	resolveCmd         CommandResolver
	runs               map[string]*runContext
	runsMu             sync.Mutex
	sem                chan struct{} // Parallelism limiter
	defaultMaxRetries  int
	defaultBackoffSecs int
	defaultRunTimeout  time.Duration
	logger             *slog.Logger
	exprEval           *ExprEvaluator // Expression evaluator for control flow
}

// Config holds scheduler configuration.
type Config struct {
	// MaxParallelism limits concurrent node executions (0 = unlimited)
	MaxParallelism int

	// DefaultMaxRetries is the default retry count for nodes (0 = no retries)
	DefaultMaxRetries int

	// DefaultBackoffSecs is the initial backoff duration in seconds
	DefaultBackoffSecs int

	// DefaultRunTimeout is the default timeout for runs (0 = no timeout)
	DefaultRunTimeout time.Duration
}

// DefaultConfig returns sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		MaxParallelism:     0,
		DefaultMaxRetries:  0,
		DefaultBackoffSecs: 2,
		DefaultRunTimeout:  0,
	}
}

// New creates a new scheduler.
func New(store runstore.RunStore, drv driver.Driver, resolveCmd CommandResolver, cfg *Config, logger *slog.Logger) *Scheduler {
	if cfg == nil {
		cfg = DefaultConfig()
	}
	if logger == nil {
		logger = slog.Default()
	}

	var sem chan struct{}
	if cfg.MaxParallelism > 0 {
		sem = make(chan struct{}, cfg.MaxParallelism)
	}

	return &Scheduler{
		store:              store,
		driver:             drv,
		resolveCmd:         resolveCmd,
		runs:               make(map[string]*runContext),
		sem:                sem,
		defaultMaxRetries:  cfg.DefaultMaxRetries,
		defaultBackoffSecs: cfg.DefaultBackoffSecs,
		defaultRunTimeout:  cfg.DefaultRunTimeout,
		logger:             logger,
		exprEval:           NewExprEvaluator(),
	}
}

// EnqueueRun registers a run with the scheduler. The run must already exist in the RunStore.
func (s *Scheduler) EnqueueRun(ctx context.Context, runID, name string, plan *types.Plan) error {
	s.runsMu.Lock()
	defer s.runsMu.Unlock()

	if _, exists := s.runs[runID]; exists {
		return nil // Already enqueued
	}

	// Build node specs map
	nodeSpecs := make(map[string]*types.NodeSpec)
	for i := range plan.Nodes {
		node := &plan.Nodes[i]
		// Apply defaults if not set
		if node.Retries == 0 {
			node.Retries = s.defaultMaxRetries
		}
		nodeSpecs[node.ID] = node
	}

	// Build dependency graph
	dependents := make(map[string]map[string]bool)
	remainingPreds := make(map[string]int)
	for id := range nodeSpecs {
		dependents[id] = make(map[string]bool)
		remainingPreds[id] = 0
	}

	for _, edge := range plan.Edges {
		if _, ok := nodeSpecs[edge.From]; !ok {
			continue
		}
		if _, ok := nodeSpecs[edge.To]; !ok {
			continue
		}
		dependents[edge.From][edge.To] = true
		remainingPreds[edge.To]++
	}

	// Also handle Inputs field on nodes as implicit edges
	for id, node := range nodeSpecs {
		for _, inputID := range node.Inputs {
			if _, ok := nodeSpecs[inputID]; ok {
				dependents[inputID][id] = true
				remainingPreds[id]++
			}
		}
	}

	rctx := &runContext{
		runID:          runID,
		name:           name,
		planTimeout:    plan.Timeout,
		nodeSpecs:      nodeSpecs,
		dependents:     dependents,
		remainingPreds: remainingPreds,
		tasks:          make(map[string]context.CancelFunc),
		gates:          make(map[string]chan string),
		done:           make(chan struct{}),
	}
	s.runs[runID] = rctx

	// Emit node_status queued for all nodes
	for nodeID := range nodeSpecs {
		s.emitNodeStatus(ctx, runID, nodeID, "queued", nil)
	}

	// Emit run status queued
	s.emitRunStatus(ctx, runID, "queued")

	return nil
}

// StartRun transitions the run to running and begins execution.
func (s *Scheduler) StartRun(ctx context.Context, runID string) error {
	ctx, span := tracer.Start(ctx, "scheduler.StartRun",
		trace.WithAttributes(attribute.String("run_id", runID)),
	)
	defer span.End()

	// Capture OTel trace ID and store on the run for correlation
	if traceID := span.SpanContext().TraceID(); traceID.IsValid() {
		if err := s.store.SetRunTraceID(ctx, runID, traceID.String()); err != nil {
			s.logger.Warn("failed to set trace ID on run", slog.String("run_id", runID), slog.Any("error", err))
		}
	}

	s.runsMu.Lock()
	rctx, exists := s.runs[runID]
	s.runsMu.Unlock()

	if !exists {
		return fmt.Errorf("run %s not enqueued", runID)
	}

	metrics.RunsActive.Inc()

	// Mark run as running
	startedAt := utcISO()
	if err := s.store.UpdateRunStatus(ctx, runID, types.RunStatusRunning, &startedAt, nil); err != nil {
		return fmt.Errorf("update run status: %w", err)
	}

	// Emit hello and status events
	s.emitEvent(ctx, runID, "hello", map[string]interface{}{"runId": runID}, "", "")
	s.emitRunStatus(ctx, runID, "running")

	// Determine run timeout: plan-level overrides default
	runTimeout := s.defaultRunTimeout
	if rctx.planTimeout > 0 {
		runTimeout = rctx.planTimeout
	}

	// Create timeout context if configured
	runCtx := ctx
	var cancelTimeout context.CancelFunc
	if runTimeout > 0 {
		runCtx, cancelTimeout = context.WithTimeout(ctx, runTimeout)
	}

	// Start the run loop in a goroutine
	go func() {
		if cancelTimeout != nil {
			defer cancelTimeout()
		}
		s.runLoop(runCtx, rctx)
	}()

	return nil
}

// CancelRun cancels a running run.
func (s *Scheduler) CancelRun(ctx context.Context, runID string) error {
	s.runsMu.Lock()
	rctx, exists := s.runs[runID]
	s.runsMu.Unlock()

	// Mark cancelled in store
	if err := s.store.CancelRun(ctx, runID); err != nil && err != runstore.ErrRunNotFound {
		s.logger.Error("failed to cancel run in store", slog.String("run_id", runID), slog.Any("error", err))
	}

	if exists {
		rctx.cancelledMu.Lock()
		rctx.cancelled = true
		rctx.cancelledMu.Unlock()

		// Cancel all active tasks
		rctx.tasksMu.Lock()
		for _, cancel := range rctx.tasks {
			cancel()
		}
		rctx.tasksMu.Unlock()
	}

	// Emit run failed (cancellation = failure per spec)
	finishedAt := utcISO()
	if err := s.store.UpdateRunStatus(ctx, runID, types.RunStatusFailed, nil, &finishedAt); err != nil {
		s.logger.Error("failed to update run status", slog.String("run_id", runID), slog.Any("error", err))
	}
	s.emitRunStatus(ctx, runID, "failed")

	metrics.RunsActive.Dec()
	metrics.RunsTotal.WithLabelValues("cancelled").Inc()

	return nil
}

// runLoop is the main execution loop for a run.
func (s *Scheduler) runLoop(ctx context.Context, rctx *runContext) {
	defer close(rctx.done)

	// Initial scheduling
	s.maybeScheduleReady(ctx, rctx)

	for {
		// Check context timeout/cancellation
		if err := ctx.Err(); err != nil {
			s.handleRunTimeout(ctx, rctx, err)
			return
		}

		// Check explicit cancellation
		rctx.cancelledMu.Lock()
		cancelled := rctx.cancelled
		rctx.cancelledMu.Unlock()

		rctx.tasksMu.Lock()
		activeTasks := len(rctx.tasks)
		rctx.tasksMu.Unlock()

		if cancelled && activeTasks == 0 {
			break
		}

		// If no active tasks, try to schedule more
		if activeTasks == 0 {
			scheduled := s.maybeScheduleReady(ctx, rctx)
			if !scheduled {
				// Check if run is complete
				if s.checkRunCompletion(ctx, rctx) {
					break
				}
				// Wait a bit before retrying
				select {
				case <-ctx.Done():
					s.handleRunTimeout(ctx, rctx, ctx.Err())
					return
				case <-time.After(50 * time.Millisecond):
				}
				continue
			}
		}

		// Wait for task completion or timeout
		select {
		case <-ctx.Done():
			s.handleRunTimeout(ctx, rctx, ctx.Err())
			return
		case <-time.After(250 * time.Millisecond):
			// Periodic check for retry windows and scheduling
			s.maybeScheduleReady(ctx, rctx)
			if s.checkRunCompletion(ctx, rctx) {
				return
			}
		}
	}
}

// handleRunTimeout cancels active tasks and marks the run as failed due to timeout.
func (s *Scheduler) handleRunTimeout(ctx context.Context, rctx *runContext, err error) {
	_, span := tracer.Start(context.Background(), "scheduler.handleRunTimeout",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
		),
	)
	defer span.End()

	reason := "timeout"
	if err == context.Canceled {
		reason = "cancelled"
	}
	span.SetAttributes(attribute.String("reason", reason))
	if rctx.planTimeout > 0 {
		span.SetAttributes(attribute.String("timeout_duration", rctx.planTimeout.String()))
	}

	s.logger.Warn("run terminated",
		slog.String("run_id", rctx.runID),
		slog.String("reason", reason),
	)

	// Cancel all active node tasks
	rctx.tasksMu.Lock()
	for _, cancel := range rctx.tasks {
		cancel()
	}
	rctx.tasksMu.Unlock()

	// Close all gate channels
	rctx.gatesMu.Lock()
	for nodeID, ch := range rctx.gates {
		close(ch)
		delete(rctx.gates, nodeID)
	}
	rctx.gatesMu.Unlock()

	// Use background context since the run context may be expired
	bgCtx := context.Background()

	finishedAt := utcISO()
	s.store.UpdateRunStatus(bgCtx, rctx.runID, types.RunStatusFailed, nil, &finishedAt)
	s.emitEvent(bgCtx, rctx.runID, "status", map[string]interface{}{
		"runId":  rctx.runID,
		"status": "failed",
		"reason": reason,
	}, "", "")

	metrics.RunsActive.Dec()
	metrics.RunsTotal.WithLabelValues("failed").Inc()

	// Cleanup
	s.runsMu.Lock()
	delete(s.runs, rctx.runID)
	s.runsMu.Unlock()
}

// maybeScheduleReady finds nodes ready to execute and starts them.
func (s *Scheduler) maybeScheduleReady(ctx context.Context, rctx *runContext) bool {
	scheduled := false
	now := time.Now().UTC()

	for nodeID, spec := range rctx.nodeSpecs {
		// Skip if already running
		rctx.tasksMu.Lock()
		_, isRunning := rctx.tasks[nodeID]
		rctx.tasksMu.Unlock()
		if isRunning {
			continue
		}

		// Must have no remaining predecessors
		if rctx.remainingPreds[nodeID] > 0 {
			continue
		}

		// Check node state in store
		state, err := s.store.GetNodeState(ctx, rctx.runID, nodeID)
		if err != nil {
			// Node state might not exist yet - treat as queued
			state = &types.NodeState{
				NodeID:  nodeID,
				Status:  types.NodeStatusPending,
				Retries: 0,
			}
		}

		// Only schedule if pending/queued
		if state.Status != types.NodeStatusPending && state.Status != "queued" {
			continue
		}

		// Check retry window
		// For simplicity, we'll use the retry count to calculate backoff
		// In production, this would be stored as next_earliest_start_at
		scheduled = true
		s.scheduleNode(ctx, rctx, nodeID, spec, state.Retries, now)
	}

	return scheduled
}

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

		// Dispatch based on node type
		if spec.IsControlFlow() {
			// Gate nodes have special handling — they block until approval
			if spec.Gate != nil {
				s.executeGate(nodeCtx, rctx, nodeID, spec)
				return
			}

			var err error
			switch {
			case spec.Conditional != nil:
				err = s.executeConditional(ctx, rctx, spec)
			case spec.ForEach != nil:
				err = s.executeForEach(ctx, rctx, spec)
			// Subflow not yet implemented
			default:
				err = fmt.Errorf("unknown control flow type for node %s", nodeID)
			}

			exitCode := 0
			if err != nil {
				s.logger.Error("control flow execution failed",
					slog.String("run_id", rctx.runID),
					slog.String("node_id", nodeID),
					slog.Any("error", err))
				exitCode = 1
			}
			s.onNodeFinished(ctx, rctx, nodeID, exitCode)
			return
		}

		// Regular agent node - resolve command
		cmd := s.resolveCmd(spec)
		if len(cmd) == 0 {
			// No command - skip this node
			s.onNodeFinished(ctx, rctx, nodeID, 0)
			return
		}

		// Build env
		env := make(map[string]string)
		for k, v := range spec.Env {
			env[k] = v
		}
		env["ATTEMPT"] = fmt.Sprintf("%d", attempts+1)

		// Calculate timeout
		timeout := 0.0
		if spec.Timeout > 0 {
			timeout = spec.Timeout.Seconds()
		}

		// Run via driver
		exitCode, err := s.driver.RunNode(nodeCtx, rctx.runID, nodeID, cmd, env, timeout)
		if err != nil {
			s.logger.Error("driver execution failed", slog.String("run_id", rctx.runID), slog.String("node_id", nodeID), slog.Any("error", err))
			exitCode = 1
		}

		// Capture agent outputs for downstream data flow
		if exitCode == 0 {
			s.captureNodeOutputs(ctx, rctx.runID, nodeID)
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

		// Unlock downstream nodes
		for downstream := range rctx.dependents[nodeID] {
			rctx.remainingPreds[downstream]--
		}
	} else {
		// Failure - check if we should retry
		maxRetries, backoffSec := s.resolveRetryPolicy(spec, attempts)
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
		}
	}
}

// resolveRetryPolicy returns the max retries and backoff seconds for a node.
// Per-node RetryPolicy takes precedence over the legacy Retries field and global defaults.
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

// checkRunCompletion determines if the run is complete and emits final status.
func (s *Scheduler) checkRunCompletion(ctx context.Context, rctx *runContext) bool {
	_, span := tracer.Start(ctx, "scheduler.checkRunCompletion",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
			attribute.Int("node_count", len(rctx.nodeSpecs)),
		),
	)
	defer span.End()

	// Check cancelled
	rctx.cancelledMu.Lock()
	cancelled := rctx.cancelled
	rctx.cancelledMu.Unlock()

	rctx.tasksMu.Lock()
	activeTasks := len(rctx.tasks)
	rctx.tasksMu.Unlock()

	if cancelled && activeTasks == 0 {
		span.SetAttributes(attribute.String("final_status", "cancelled"))
		finishedAt := utcISO()
		s.store.UpdateRunStatus(ctx, rctx.runID, types.RunStatusFailed, nil, &finishedAt)
		s.emitRunStatus(ctx, rctx.runID, "failed")
		s.fireWebhookCallback(ctx, rctx.runID)
		// Note: metrics for cancelled runs are recorded in CancelRun
		return true
	}

	// Check all node states
	var running, pending, failed, succeeded, waiting, skipped int
	for nodeID := range rctx.nodeSpecs {
		state, err := s.store.GetNodeState(ctx, rctx.runID, nodeID)
		if err != nil {
			pending++
			continue
		}
		switch state.Status {
		case types.NodeStatusRunning:
			running++
		case types.NodeStatusPending, "queued":
			pending++
		case types.NodeStatusFailed:
			failed++
		case types.NodeStatusSucceeded:
			succeeded++
		case types.NodeStatusSkipped:
			skipped++
		case types.NodeStatusWaitingApproval:
			waiting++
		}
	}

	total := len(rctx.nodeSpecs)

	// All nodes resolved (succeeded + skipped)
	if succeeded+skipped == total {
		span.SetAttributes(attribute.String("final_status", "succeeded"))
		finishedAt := utcISO()
		s.store.UpdateRunStatus(ctx, rctx.runID, types.RunStatusSucceeded, nil, &finishedAt)
		s.emitRunStatus(ctx, rctx.runID, "succeeded")
		s.fireWebhookCallback(ctx, rctx.runID)
		metrics.RunsActive.Dec()
		metrics.RunsTotal.WithLabelValues("succeeded").Inc()
		return true
	}

	// Failed with no hope of completion (no running, pending, or waiting nodes)
	if failed > 0 && running == 0 && pending == 0 && waiting == 0 {
		span.SetAttributes(attribute.String("final_status", "failed"))
		finishedAt := utcISO()
		s.store.UpdateRunStatus(ctx, rctx.runID, types.RunStatusFailed, nil, &finishedAt)
		s.emitRunStatus(ctx, rctx.runID, "failed")
		s.fireWebhookCallback(ctx, rctx.runID)
		metrics.RunsActive.Dec()
		metrics.RunsTotal.WithLabelValues("failed").Inc()
		return true
	}

	return false
}

// Event emission helpers
func (s *Scheduler) emitEvent(ctx context.Context, runID, eventType string, data map[string]interface{}, nodeID, level string) {
	// Include level in data if provided
	if level != "" {
		data["level"] = level
	}
	input := &types.EventInput{
		Type:   types.EventType(eventType),
		NodeID: nodeID,
		Data:   data,
	}
	if _, err := s.store.AppendEvent(ctx, runID, input); err != nil {
		s.logger.Error("failed to emit event", slog.String("run_id", runID), slog.String("event_type", eventType), slog.Any("error", err))
	}
	metrics.EventsTotal.WithLabelValues(eventType).Inc()
}

func (s *Scheduler) emitRunStatus(ctx context.Context, runID, status string) {
	data := map[string]interface{}{
		"runId":  runID,
		"status": status,
	}
	// Include trace_id in status events for frontend correlation
	if traceID := trace.SpanContextFromContext(ctx).TraceID(); traceID.IsValid() {
		data["trace_id"] = traceID.String()
	}
	s.emitEvent(ctx, runID, "status", data, "", "")
}

func (s *Scheduler) emitNodeStatus(ctx context.Context, runID, nodeID, status string, extra map[string]interface{}) {
	data := map[string]interface{}{
		"runId":  runID,
		"nodeId": nodeID,
		"status": status,
	}
	for k, v := range extra {
		data[k] = v
	}
	s.emitEvent(ctx, runID, "node_status", data, nodeID, "")
}

// captureNodeOutputs scans the run's event stream for output events from the
// given node and stores them via runstore.SetNodeOutputs. This enables
// downstream nodes to access predecessor outputs through the expression
// environment (e.g., inputs.node_id.field).
func (s *Scheduler) captureNodeOutputs(ctx context.Context, runID, nodeID string) {
	_, span := tracer.Start(ctx, "scheduler.captureNodeOutputs",
		trace.WithAttributes(
			attribute.String("run_id", runID),
			attribute.String("node_id", nodeID),
		),
	)
	defer span.End()

	events, err := s.store.GetEventsSince(ctx, runID, "")
	if err != nil {
		s.logger.Warn("failed to read events for output capture",
			slog.String("run_id", runID),
			slog.String("node_id", nodeID),
			slog.Any("error", err))
		return
	}

	// Collect outputs from "output" events emitted by this node's agent.
	// Agents produce NDJSON lines with {"type": "output", "key": "...", "value": ...}
	// We merge all output events into a single outputs map.
	outputs := make(map[string]interface{})
	for _, ev := range events {
		if ev.NodeID != nodeID {
			continue
		}
		if string(ev.Type) != "output" {
			continue
		}
		if len(ev.Data) == 0 {
			continue
		}
		// Unmarshal the raw JSON data
		var data map[string]interface{}
		if err := json.Unmarshal(ev.Data, &data); err != nil {
			s.logger.Warn("failed to unmarshal output event data",
				slog.String("run_id", runID),
				slog.String("node_id", nodeID),
				slog.Any("error", err))
			continue
		}
		// Extract key/value pairs from the event data
		if key, ok := data["key"].(string); ok {
			outputs[key] = data["value"]
		} else {
			// If no explicit key, merge all data fields (except metadata)
			for k, v := range data {
				if k == "type" || k == "runId" || k == "nodeId" || k == "level" {
					continue
				}
				outputs[k] = v
			}
		}
	}

	span.SetAttributes(attribute.Int("output_count", len(outputs)))

	if len(outputs) == 0 {
		return
	}

	if err := s.store.SetNodeOutputs(ctx, runID, nodeID, outputs); err != nil {
		s.logger.Warn("failed to store node outputs",
			slog.String("run_id", runID),
			slog.String("node_id", nodeID),
			slog.Any("error", err))
	}
}

// executeGate blocks a node until external approval or rejection (or timeout).
func (s *Scheduler) executeGate(ctx context.Context, rctx *runContext, nodeID string, spec *types.NodeSpec) {
	ctx, span := tracer.Start(ctx, "scheduler.executeGate",
		trace.WithAttributes(
			attribute.String("run_id", rctx.runID),
			attribute.String("node_id", nodeID),
		),
	)
	defer span.End()

	gate := spec.Gate
	if gate.Timeout > 0 {
		span.SetAttributes(attribute.String("gate_timeout", gate.Timeout.String()))
	}

	// Create a channel for approval signals
	ch := make(chan string, 1)
	rctx.gatesMu.Lock()
	rctx.gates[nodeID] = ch
	rctx.gatesMu.Unlock()

	defer func() {
		rctx.gatesMu.Lock()
		delete(rctx.gates, nodeID)
		rctx.gatesMu.Unlock()

		rctx.tasksMu.Lock()
		delete(rctx.tasks, nodeID)
		rctx.tasksMu.Unlock()
	}()

	// Update node state to waiting_approval
	now := time.Now().UTC()
	waitState := &types.NodeState{
		NodeID:    nodeID,
		Status:    types.NodeStatusWaitingApproval,
		StartedAt: &now,
	}
	s.store.UpdateNodeState(ctx, rctx.runID, nodeID, waitState)
	s.emitNodeStatus(ctx, rctx.runID, nodeID, "waiting_approval", map[string]interface{}{
		"description": gate.Description,
	})

	// Set up gate timeout if configured
	var timeoutCh <-chan time.Time
	if gate.Timeout > 0 {
		timer := time.NewTimer(gate.Timeout)
		defer timer.Stop()
		timeoutCh = timer.C
	}

	// Wait for signal
	var decision string
	select {
	case decision = <-ch:
		// Received approve or reject
	case <-timeoutCh:
		if gate.AutoReject {
			decision = "reject"
		} else {
			decision = "approve"
		}
		s.logger.Info("gate timed out",
			slog.String("run_id", rctx.runID),
			slog.String("node_id", nodeID),
			slog.String("decision", decision),
		)
	case <-ctx.Done():
		// Run cancelled or timed out
		return
	}

	span.SetAttributes(attribute.String("decision", decision))

	exitCode := 0
	if decision == "reject" {
		exitCode = 1
	}

	s.emitEvent(ctx, rctx.runID, "gate_decision", map[string]interface{}{
		"nodeId":   nodeID,
		"decision": decision,
	}, nodeID, "")

	s.onNodeFinished(ctx, rctx, nodeID, exitCode)
}

// ApproveGate sends an approval signal to a waiting gate node.
func (s *Scheduler) ApproveGate(runID, nodeID string) error {
	return s.signalGate(runID, nodeID, "approve")
}

// RejectGate sends a rejection signal to a waiting gate node.
func (s *Scheduler) RejectGate(runID, nodeID string) error {
	return s.signalGate(runID, nodeID, "reject")
}

func (s *Scheduler) signalGate(runID, nodeID, decision string) error {
	s.runsMu.Lock()
	rctx, exists := s.runs[runID]
	s.runsMu.Unlock()

	if !exists {
		return fmt.Errorf("run %s not found", runID)
	}

	rctx.gatesMu.Lock()
	ch, ok := rctx.gates[nodeID]
	rctx.gatesMu.Unlock()

	if !ok {
		return fmt.Errorf("node %s is not a waiting gate", nodeID)
	}

	select {
	case ch <- decision:
		return nil
	default:
		return fmt.Errorf("gate %s already received a decision", nodeID)
	}
}

func utcISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
