package scheduler

import (
	"context"
	"log/slog"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/runstore"
)

func newTestScheduleStore(t *testing.T) (*RedisScheduleStore, *redis.Client) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return NewRedisScheduleStore(client), client
}

func TestRedisScheduleStore_RoundTrip(t *testing.T) {
	store, _ := newTestScheduleStore(t)
	ctx := context.Background()

	if err := store.Save(ctx, &Schedule{ID: "s1", FlowID: "f1", Cron: "* * * * *", Enabled: true}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := store.Save(ctx, &Schedule{ID: "s2", FlowID: "f2", Cron: "0 * * * *", Enabled: false}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	list, err := store.List(ctx)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("List len = %d, want 2", len(list))
	}

	if err := store.Delete(ctx, "s1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	list, _ = store.List(ctx)
	if len(list) != 1 || list[0].ID != "s2" {
		t.Fatalf("after delete: %+v, want only s2", list)
	}
}

// A schedule added to one runner must be reloaded by a fresh runner backed by
// the same store — i.e. it survives an orchestrator restart.
func TestCronRunner_SchedulesSurviveRestart(t *testing.T) {
	store, _ := newTestScheduleStore(t)
	ctx := context.Background()

	mkRunner := func() *CronRunner {
		s := runstore.NewMemoryStore(nil)
		cr := NewCronRunner(New(s, &mockDriver{}, testCommandResolver, nil, slog.Default()),
			flowstore.NewMemoryStore(), s, slog.Default())
		cr.SetScheduleStore(store)
		return cr
	}

	// First process: add a schedule (persisted via the store).
	r1 := mkRunner()
	if err := r1.AddSchedule(&Schedule{ID: "s1", FlowID: "f1", Cron: "*/5 * * * *", Enabled: true}); err != nil {
		t.Fatalf("AddSchedule: %v", err)
	}

	// Second process (restart): a brand-new runner loads from the same store.
	r2 := mkRunner()
	if got := len(r2.ListSchedules()); got != 0 {
		t.Fatalf("fresh runner should start empty, had %d", got)
	}
	n, err := r2.LoadSchedules(ctx)
	if err != nil {
		t.Fatalf("LoadSchedules: %v", err)
	}
	if n != 1 {
		t.Fatalf("loaded %d schedules, want 1", n)
	}
	got, err := r2.GetSchedule("s1")
	if err != nil {
		t.Fatalf("GetSchedule after reload: %v", err)
	}
	if got.FlowID != "f1" || got.Cron != "*/5 * * * *" {
		t.Errorf("reloaded schedule = %+v, want flow f1 cron */5", got)
	}

	// Removing on the second runner also clears persistence.
	if err := r2.RemoveSchedule("s1"); err != nil {
		t.Fatalf("RemoveSchedule: %v", err)
	}
	list, _ := store.List(ctx)
	if len(list) != 0 {
		t.Fatalf("after remove, store still has %d schedules", len(list))
	}
}

// Without a store, schedules remain in memory only (legacy behavior, no error).
func TestCronRunner_NoStoreIsInMemoryOnly(t *testing.T) {
	s := runstore.NewMemoryStore(nil)
	cr := NewCronRunner(New(s, &mockDriver{}, testCommandResolver, nil, slog.Default()),
		flowstore.NewMemoryStore(), s, slog.Default())
	if err := cr.AddSchedule(&Schedule{ID: "s1", FlowID: "f1", Cron: "* * * * *", Enabled: true}); err != nil {
		t.Fatalf("AddSchedule: %v", err)
	}
	if n, err := cr.LoadSchedules(context.Background()); err != nil || n != 0 {
		t.Fatalf("LoadSchedules with no store = (%d, %v), want (0, nil)", n, err)
	}
}
