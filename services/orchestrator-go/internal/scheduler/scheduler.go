// Package scheduler provides DAG execution for orchestrator runs.
package scheduler

import (
	"context"
	"fmt"
	"log/slog"
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
	sessionMu      sync.Mutex
	sessionID      string
	sessionClosed  bool
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
	agentSems          map[string]chan struct{}
	agentSemsMu        sync.Mutex
	defaultMaxRetries  int
	defaultBackoffSecs int
	defaultRunTimeout  time.Duration
	logger             *slog.Logger
	exprEval           *ExprEvaluator // Expression evaluator for control flow
	executors          map[string]nodeExecutor
	runSessionManager  RunSessionManager
}

// nodeExecutor defines the strategy for executing a specific type of node.
type nodeExecutor interface {
	Execute(ctx context.Context, s *Scheduler, rctx *runContext, nodeID string, spec *types.NodeSpec) (int, error)
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

// Option is a functional option for configuring the Scheduler.
type Option func(*Scheduler)

// WithMaxParallelism sets the maximum number of concurrent node executions.
func WithMaxParallelism(n int) Option {
	return func(s *Scheduler) {
		if n > 0 {
			s.sem = make(chan struct{}, n)
		} else {
			s.sem = nil
		}
	}
}

// WithDefaultMaxRetries sets the default maximum retry count for nodes.
func WithDefaultMaxRetries(n int) Option {
	return func(s *Scheduler) {
		s.defaultMaxRetries = n
	}
}

// WithDefaultBackoffSecs sets the initial backoff duration in seconds.
func WithDefaultBackoffSecs(n int) Option {
	return func(s *Scheduler) {
		s.defaultBackoffSecs = n
	}
}

// WithDefaultRunTimeout sets the default timeout for runs.
func WithDefaultRunTimeout(d time.Duration) Option {
	return func(s *Scheduler) {
		s.defaultRunTimeout = d
	}
}

// WithLogger sets the logger for the scheduler.
func WithLogger(logger *slog.Logger) Option {
	return func(s *Scheduler) {
		if logger != nil {
			s.logger = logger
		}
	}
}

// WithRunSessionManager sets a run session lifecycle manager integration.
func WithRunSessionManager(manager RunSessionManager) Option {
	return func(s *Scheduler) {
		s.runSessionManager = manager
	}
}

// NewScheduler creates a new scheduler with the provided options.
func NewScheduler(store runstore.RunStore, drv driver.Driver, resolveCmd CommandResolver, opts ...Option) *Scheduler {
	s := &Scheduler{
		store:              store,
		driver:             drv,
		resolveCmd:         resolveCmd,
		runs:               make(map[string]*runContext),
		agentSems:          make(map[string]chan struct{}),
		defaultMaxRetries:  0,
		defaultBackoffSecs: 2,
		defaultRunTimeout:  0,
		logger:             slog.Default(),
		exprEval:           NewExprEvaluator(),
	}

	for _, opt := range opts {
		opt(s)
	}

	// Initialize default executors
	s.executors = map[string]nodeExecutor{
		"gate":        &gateExecutor{},
		"conditional": &conditionalExecutor{},
		"foreach":     &forEachExecutor{},
		"agent":       &agentExecutor{},
	}

	return s
}

// New creates a new scheduler using the legacy Config struct.
// Deprecated: Use NewScheduler with Options instead.
func New(store runstore.RunStore, drv driver.Driver, resolveCmd CommandResolver, cfg *Config, logger *slog.Logger) *Scheduler {
	var opts []Option
	if cfg != nil {
		opts = append(opts, WithMaxParallelism(cfg.MaxParallelism))
		opts = append(opts, WithDefaultMaxRetries(cfg.DefaultMaxRetries))
		opts = append(opts, WithDefaultBackoffSecs(cfg.DefaultBackoffSecs))
		opts = append(opts, WithDefaultRunTimeout(cfg.DefaultRunTimeout))
	}
	if logger != nil {
		opts = append(opts, WithLogger(logger))
	}

	return NewScheduler(store, drv, resolveCmd, opts...)
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
		if node.Timeout == 0 && node.Resources != nil && node.Resources.TimeoutSeconds > 0 {
			node.Timeout = time.Duration(node.Resources.TimeoutSeconds) * time.Second
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
	s.startRunSession(ctx, rctx)

	// Determine run timeout: plan-level overrides default
	runTimeout := s.defaultRunTimeout
	if rctx.planTimeout > 0 {
		runTimeout = rctx.planTimeout
	}

	// Detach from the caller (HTTP request) context so the run survives
	// after the response is sent.  Propagate the OTel span for tracing.
	detached := context.WithoutCancel(ctx)

	// Create timeout context if configured
	runCtx := detached
	var cancelTimeout context.CancelFunc
	if runTimeout > 0 {
		runCtx, cancelTimeout = context.WithTimeout(detached, runTimeout)
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
	if exists {
		s.finalizeRunSession(ctx, rctx, types.RunStatusFailed, "cancelled")
	}

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

func utcISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}
