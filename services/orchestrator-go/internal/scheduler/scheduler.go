// Package scheduler provides DAG execution for orchestrator runs.
package scheduler

import (
	"context"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/driver"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// CommandResolver resolves a NodeSpec to a command line to execute.
type CommandResolver func(node *types.NodeSpec) []string

// runContext holds the runtime state for a single run.
type runContext struct {
	runID          string
	name           string
	nodeSpecs      map[string]*types.NodeSpec
	dependents     map[string]map[string]bool // node_id -> set of downstream ids
	remainingPreds map[string]int             // node_id -> count of predecessors not yet succeeded
	tasks          map[string]context.CancelFunc
	tasksMu        sync.Mutex
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
}

// Config holds scheduler configuration.
type Config struct {
	// MaxParallelism limits concurrent node executions (0 = unlimited)
	MaxParallelism int

	// DefaultMaxRetries is the default retry count for nodes (0 = no retries)
	DefaultMaxRetries int

	// DefaultBackoffSecs is the initial backoff duration in seconds
	DefaultBackoffSecs int
}

// DefaultConfig returns sensible defaults.
func DefaultConfig() *Config {
	return &Config{
		MaxParallelism:     0,
		DefaultMaxRetries:  0,
		DefaultBackoffSecs: 2,
	}
}

// New creates a new scheduler.
func New(store runstore.RunStore, drv driver.Driver, resolveCmd CommandResolver, cfg *Config) *Scheduler {
	if cfg == nil {
		cfg = DefaultConfig()
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
		nodeSpecs:      nodeSpecs,
		dependents:     dependents,
		remainingPreds: remainingPreds,
		tasks:          make(map[string]context.CancelFunc),
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
	s.runsMu.Lock()
	rctx, exists := s.runs[runID]
	s.runsMu.Unlock()

	if !exists {
		return fmt.Errorf("run %s not enqueued", runID)
	}

	// Mark run as running
	startedAt := utcISO()
	if err := s.store.UpdateRunStatus(ctx, runID, types.RunStatusRunning, &startedAt, nil); err != nil {
		return fmt.Errorf("update run status: %w", err)
	}

	// Emit hello and status events
	s.emitEvent(ctx, runID, "hello", map[string]interface{}{"runId": runID}, "", "")
	s.emitRunStatus(ctx, runID, "running")

	// Start the run loop in a goroutine
	go s.runLoop(ctx, rctx)

	return nil
}

// CancelRun cancels a running run.
func (s *Scheduler) CancelRun(ctx context.Context, runID string) error {
	s.runsMu.Lock()
	rctx, exists := s.runs[runID]
	s.runsMu.Unlock()

	// Mark cancelled in store
	if err := s.store.CancelRun(ctx, runID); err != nil && err != runstore.ErrRunNotFound {
		log.Printf("cancel run store error: %v", err)
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
		log.Printf("update run status error: %v", err)
	}
	s.emitRunStatus(ctx, runID, "failed")

	return nil
}

// runLoop is the main execution loop for a run.
func (s *Scheduler) runLoop(ctx context.Context, rctx *runContext) {
	defer close(rctx.done)

	// Initial scheduling
	s.maybeScheduleReady(ctx, rctx)

	for {
		// Check cancellation
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
				time.Sleep(50 * time.Millisecond)
				continue
			}
		}

		// Wait for task completion or timeout
		select {
		case <-ctx.Done():
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
		log.Printf("update node state error: %v", err)
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

		// Resolve command
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
			log.Printf("driver error for node %s: %v", nodeID, err)
			exitCode = 1
		}

		s.onNodeFinished(ctx, rctx, nodeID, exitCode)
	}()
}

// onNodeFinished handles node completion - success, failure, or retry.
func (s *Scheduler) onNodeFinished(ctx context.Context, rctx *runContext, nodeID string, exitCode int) {
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
		}
		s.store.UpdateNodeState(ctx, rctx.runID, nodeID, newState)

		// Unlock downstream nodes
		for downstream := range rctx.dependents[nodeID] {
			rctx.remainingPreds[downstream]--
		}
	} else {
		// Failure - check if we should retry
		maxRetries := spec.Retries
		if attempts < maxRetries {
			// Schedule retry with exponential backoff
			backoff := float64(s.defaultBackoffSecs) * math.Pow(2, float64(attempts))
			if backoff > 60 {
				backoff = 60 // Cap at 60 seconds
			}

			// Update state back to pending for retry
			newState := &types.NodeState{
				NodeID:     nodeID,
				Status:     types.NodeStatusPending,
				FinishedAt: &finishedAt,
				ExitCode:   &exitCode,
				Retries:    attempts + 1,
				Error:      fmt.Sprintf("exit_code=%d, retry in %.0fs", exitCode, backoff),
			}
			s.store.UpdateNodeState(ctx, rctx.runID, nodeID, newState)

			// Emit queued status with retry info
			s.emitNodeStatus(ctx, rctx.runID, nodeID, "queued", map[string]interface{}{
				"attempts": attempts + 1,
				"retryIn":  backoff,
			})

			// Schedule retry after backoff
			go func() {
				time.Sleep(time.Duration(backoff) * time.Second)
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
			}
			s.store.UpdateNodeState(ctx, rctx.runID, nodeID, newState)
		}
	}
}

// checkRunCompletion determines if the run is complete and emits final status.
func (s *Scheduler) checkRunCompletion(ctx context.Context, rctx *runContext) bool {
	// Check cancelled
	rctx.cancelledMu.Lock()
	cancelled := rctx.cancelled
	rctx.cancelledMu.Unlock()

	rctx.tasksMu.Lock()
	activeTasks := len(rctx.tasks)
	rctx.tasksMu.Unlock()

	if cancelled && activeTasks == 0 {
		finishedAt := utcISO()
		s.store.UpdateRunStatus(ctx, rctx.runID, types.RunStatusFailed, nil, &finishedAt)
		s.emitRunStatus(ctx, rctx.runID, "failed")
		return true
	}

	// Check all node states
	var running, pending, failed, succeeded int
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
		}
	}

	total := len(rctx.nodeSpecs)

	// All succeeded
	if succeeded == total {
		finishedAt := utcISO()
		s.store.UpdateRunStatus(ctx, rctx.runID, types.RunStatusSucceeded, nil, &finishedAt)
		s.emitRunStatus(ctx, rctx.runID, "succeeded")
		return true
	}

	// Failed with no hope of completion
	if failed > 0 && running == 0 && pending == 0 {
		finishedAt := utcISO()
		s.store.UpdateRunStatus(ctx, rctx.runID, types.RunStatusFailed, nil, &finishedAt)
		s.emitRunStatus(ctx, rctx.runID, "failed")
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
		log.Printf("emit event error: %v", err)
	}
}

func (s *Scheduler) emitRunStatus(ctx context.Context, runID, status string) {
	s.emitEvent(ctx, runID, "status", map[string]interface{}{
		"runId":  runID,
		"status": status,
	}, "", "")
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

func utcISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
