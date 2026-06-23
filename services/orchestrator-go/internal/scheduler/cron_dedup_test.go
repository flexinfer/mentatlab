package scheduler

import (
	"context"
	"encoding/json"
	"log/slog"
	"testing"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
)

// A schedule must fire at most once per minute even if evaluate() runs twice
// for the same minute (e.g. the initial aligned evaluate plus the first ticker
// tick). This also pins the missed-tick policy: cronMatches only matches the
// current minute, so a tick missed during downtime is skipped, not caught up.
func TestCron_NoDuplicateTriggerWithinMinute(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	flows := flowstore.NewMemoryStore()
	sched := New(store, &mockDriver{}, testCommandResolver, nil, slog.Default())
	cr := NewCronRunner(sched, flows, store, slog.Default())

	ctx := context.Background()
	if _, err := flows.Create(ctx, &flowstore.CreateFlowRequest{
		ID:    "f1",
		Name:  "cronflow",
		Graph: json.RawMessage(`{"nodes":[{"id":"n","type":"agent","command":["x"]}]}`),
	}); err != nil {
		t.Fatalf("Create flow: %v", err)
	}
	if err := cr.AddSchedule(&Schedule{ID: "s1", FlowID: "f1", Cron: "* * * * *", Enabled: true}); err != nil {
		t.Fatalf("AddSchedule: %v", err)
	}

	now := time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)
	cr.evaluate(now)
	cr.evaluate(now) // same minute again — must be deduped

	ids, err := store.ListRuns(ctx)
	if err != nil {
		t.Fatalf("ListRuns: %v", err)
	}
	if len(ids) != 1 {
		t.Fatalf("schedule fired %d times in one minute, want exactly 1", len(ids))
	}

	// A new minute triggers again.
	cr.evaluate(now.Add(time.Minute))
	ids, _ = store.ListRuns(ctx)
	if len(ids) != 2 {
		t.Fatalf("after next minute, total runs = %d, want 2", len(ids))
	}
}

// A disabled schedule never fires.
func TestCron_DisabledScheduleDoesNotFire(t *testing.T) {
	store := runstore.NewMemoryStore(nil)
	flows := flowstore.NewMemoryStore()
	sched := New(store, &mockDriver{}, testCommandResolver, nil, slog.Default())
	cr := NewCronRunner(sched, flows, store, slog.Default())

	ctx := context.Background()
	_, _ = flows.Create(ctx, &flowstore.CreateFlowRequest{
		ID: "f1", Name: "f", Graph: json.RawMessage(`{"nodes":[{"id":"n","type":"agent","command":["x"]}]}`),
	})
	_ = cr.AddSchedule(&Schedule{ID: "s1", FlowID: "f1", Cron: "* * * * *", Enabled: false})

	cr.evaluate(time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC))
	ids, _ := store.ListRuns(ctx)
	if len(ids) != 0 {
		t.Fatalf("disabled schedule fired %d runs, want 0", len(ids))
	}
}
