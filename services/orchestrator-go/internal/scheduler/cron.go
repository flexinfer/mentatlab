package scheduler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// Schedule represents a cron-based schedule for running flows.
type Schedule struct {
	ID          string                 `json:"id"`
	FlowID      string                 `json:"flow_id"`
	Cron        string                 `json:"cron"`
	InputParams map[string]interface{} `json:"input_params,omitempty"`
	Enabled     bool                   `json:"enabled"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
	LastRunAt   *time.Time             `json:"last_run_at,omitempty"`
	LastRunID   string                 `json:"last_run_id,omitempty"`
}

// CronRunner evaluates cron schedules every minute and triggers flow runs.
type CronRunner struct {
	scheduler  *Scheduler
	flowStore  flowstore.FlowStore
	runStore   runstore.RunStore
	schedules  map[string]*Schedule
	mu         sync.RWMutex
	logger     *slog.Logger
	stopCh     chan struct{}
}

// NewCronRunner creates a new cron runner.
func NewCronRunner(sched *Scheduler, fs flowstore.FlowStore, rs runstore.RunStore, logger *slog.Logger) *CronRunner {
	return &CronRunner{
		scheduler: sched,
		flowStore: fs,
		runStore:  rs,
		schedules: make(map[string]*Schedule),
		logger:    logger,
		stopCh:    make(chan struct{}),
	}
}

// Start begins the cron evaluation loop.
func (cr *CronRunner) Start() {
	go cr.loop()
	cr.logger.Info("cron runner started")
}

// Stop halts the cron runner.
func (cr *CronRunner) Stop() {
	close(cr.stopCh)
}

// AddSchedule adds or updates a schedule.
func (cr *CronRunner) AddSchedule(sched *Schedule) error {
	if _, err := parseCron(sched.Cron); err != nil {
		return fmt.Errorf("invalid cron expression: %w", err)
	}

	cr.mu.Lock()
	defer cr.mu.Unlock()
	cr.schedules[sched.ID] = sched
	return nil
}

// RemoveSchedule removes a schedule by ID.
func (cr *CronRunner) RemoveSchedule(id string) error {
	cr.mu.Lock()
	defer cr.mu.Unlock()

	if _, ok := cr.schedules[id]; !ok {
		return fmt.Errorf("schedule %s not found", id)
	}
	delete(cr.schedules, id)
	return nil
}

// GetSchedule returns a schedule by ID.
func (cr *CronRunner) GetSchedule(id string) (*Schedule, error) {
	cr.mu.RLock()
	defer cr.mu.RUnlock()

	s, ok := cr.schedules[id]
	if !ok {
		return nil, fmt.Errorf("schedule %s not found", id)
	}
	copy := *s
	return &copy, nil
}

// ListSchedules returns all schedules.
func (cr *CronRunner) ListSchedules() []*Schedule {
	cr.mu.RLock()
	defer cr.mu.RUnlock()

	result := make([]*Schedule, 0, len(cr.schedules))
	for _, s := range cr.schedules {
		copy := *s
		result = append(result, &copy)
	}
	return result
}

// loop runs every minute, checking each schedule.
func (cr *CronRunner) loop() {
	// Align to the next minute boundary for predictable timing
	now := time.Now()
	nextMinute := now.Truncate(time.Minute).Add(time.Minute)
	time.Sleep(time.Until(nextMinute))

	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	// Evaluate immediately at the first aligned minute
	cr.evaluate(time.Now())

	for {
		select {
		case <-cr.stopCh:
			return
		case t := <-ticker.C:
			cr.evaluate(t)
		}
	}
}

// evaluate checks all enabled schedules against the current time.
func (cr *CronRunner) evaluate(now time.Time) {
	cr.mu.RLock()
	var toRun []*Schedule
	for _, s := range cr.schedules {
		if !s.Enabled {
			continue
		}
		if cronMatches(s.Cron, now) {
			copy := *s
			toRun = append(toRun, &copy)
		}
	}
	cr.mu.RUnlock()

	for _, s := range toRun {
		cr.triggerRun(s, now)
	}
}

// triggerRun creates and starts a run from a scheduled flow.
func (cr *CronRunner) triggerRun(sched *Schedule, triggerTime time.Time) {
	ctx := context.Background()

	flow, err := cr.flowStore.Get(ctx, sched.FlowID)
	if err != nil {
		cr.logger.Error("cron: failed to get flow",
			slog.String("schedule_id", sched.ID),
			slog.String("flow_id", sched.FlowID),
			slog.Any("error", err),
		)
		return
	}

	// Convert flow graph to plan
	var plan types.Plan
	if err := json.Unmarshal(flow.Graph, &plan); err != nil {
		cr.logger.Error("cron: failed to parse flow graph",
			slog.String("schedule_id", sched.ID),
			slog.Any("error", err),
		)
		return
	}

	runName := fmt.Sprintf("%s (cron %s)", flow.Name, sched.Cron)
	runID, err := cr.runStore.CreateRun(ctx, runName, &plan)
	if err != nil {
		cr.logger.Error("cron: failed to create run",
			slog.String("schedule_id", sched.ID),
			slog.Any("error", err),
		)
		return
	}

	if err := cr.scheduler.EnqueueRun(ctx, runID, runName, &plan); err != nil {
		cr.logger.Error("cron: failed to enqueue run",
			slog.String("schedule_id", sched.ID),
			slog.String("run_id", runID),
			slog.Any("error", err),
		)
		return
	}

	if err := cr.scheduler.StartRun(ctx, runID); err != nil {
		cr.logger.Error("cron: failed to start run",
			slog.String("schedule_id", sched.ID),
			slog.String("run_id", runID),
			slog.Any("error", err),
		)
		return
	}

	// Update schedule metadata
	cr.mu.Lock()
	if s, ok := cr.schedules[sched.ID]; ok {
		s.LastRunAt = &triggerTime
		s.LastRunID = runID
		s.UpdatedAt = time.Now().UTC()
	}
	cr.mu.Unlock()

	cr.logger.Info("cron: triggered run",
		slog.String("schedule_id", sched.ID),
		slog.String("flow_id", sched.FlowID),
		slog.String("run_id", runID),
	)
}

// cronField represents a parsed cron field.
type cronField struct {
	values map[int]bool // set of matching values
	any    bool         // matches any value (*)
}

// parsedCron holds all five parsed fields.
type parsedCron struct {
	minute, hour, dom, month, dow cronField
}

// parseCron parses a standard 5-field cron expression.
func parseCron(expr string) (*parsedCron, error) {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return nil, fmt.Errorf("expected 5 fields, got %d", len(fields))
	}

	minute, err := parseCronField(fields[0], 0, 59)
	if err != nil {
		return nil, fmt.Errorf("minute: %w", err)
	}
	hour, err := parseCronField(fields[1], 0, 23)
	if err != nil {
		return nil, fmt.Errorf("hour: %w", err)
	}
	dom, err := parseCronField(fields[2], 1, 31)
	if err != nil {
		return nil, fmt.Errorf("day of month: %w", err)
	}
	month, err := parseCronField(fields[3], 1, 12)
	if err != nil {
		return nil, fmt.Errorf("month: %w", err)
	}
	dow, err := parseCronField(fields[4], 0, 6)
	if err != nil {
		return nil, fmt.Errorf("day of week: %w", err)
	}

	return &parsedCron{minute: minute, hour: hour, dom: dom, month: month, dow: dow}, nil
}

// parseCronField parses a single cron field (supports *, N, N-M, */N, N-M/S, and comma-separated).
func parseCronField(field string, min, max int) (cronField, error) {
	if field == "*" {
		return cronField{any: true}, nil
	}

	values := make(map[int]bool)

	for _, part := range strings.Split(field, ",") {
		part = strings.TrimSpace(part)

		// Handle */N (step from min)
		if strings.HasPrefix(part, "*/") {
			step, err := strconv.Atoi(part[2:])
			if err != nil || step <= 0 {
				return cronField{}, fmt.Errorf("invalid step: %s", part)
			}
			for i := min; i <= max; i += step {
				values[i] = true
			}
			continue
		}

		// Handle N-M or N-M/S
		if strings.Contains(part, "-") {
			rangeParts := strings.SplitN(part, "/", 2)
			bounds := strings.SplitN(rangeParts[0], "-", 2)
			start, err := strconv.Atoi(bounds[0])
			if err != nil {
				return cronField{}, fmt.Errorf("invalid range start: %s", part)
			}
			end, err := strconv.Atoi(bounds[1])
			if err != nil {
				return cronField{}, fmt.Errorf("invalid range end: %s", part)
			}
			step := 1
			if len(rangeParts) > 1 {
				step, err = strconv.Atoi(rangeParts[1])
				if err != nil || step <= 0 {
					return cronField{}, fmt.Errorf("invalid step: %s", part)
				}
			}
			for i := start; i <= end; i += step {
				values[i] = true
			}
			continue
		}

		// Plain number
		n, err := strconv.Atoi(part)
		if err != nil {
			return cronField{}, fmt.Errorf("invalid value: %s", part)
		}
		if n < min || n > max {
			return cronField{}, fmt.Errorf("value %d out of range [%d, %d]", n, min, max)
		}
		values[n] = true
	}

	return cronField{values: values}, nil
}

// cronMatches checks if the current time matches a cron expression.
func cronMatches(expr string, t time.Time) bool {
	parsed, err := parseCron(expr)
	if err != nil {
		return false
	}

	return fieldMatches(parsed.minute, t.Minute()) &&
		fieldMatches(parsed.hour, t.Hour()) &&
		fieldMatches(parsed.dom, t.Day()) &&
		fieldMatches(parsed.month, int(t.Month())) &&
		fieldMatches(parsed.dow, int(t.Weekday()))
}

func fieldMatches(f cronField, val int) bool {
	if f.any {
		return true
	}
	return f.values[val]
}
