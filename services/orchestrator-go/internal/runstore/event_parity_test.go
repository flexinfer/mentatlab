package runstore

import (
	"context"
	"testing"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// The memory and redis stores must behave identically for the core run-loop
// operations the SSE path depends on: create, append events, full replay, and
// Last-Event-ID resumption.
func TestEventStreamParity_MemoryVsRedis(t *testing.T) {
	redisStore, _ := newTestRedisStore(t)
	stores := map[string]RunStore{
		"memory": NewMemoryStore(&Config{EventMaxLen: 1000, TTLSeconds: 3600}),
		"redis":  redisStore,
	}

	type result struct {
		full       int
		fullTypes  []string
		sinceFirst int
		fromZero   int
	}
	results := map[string]result{}

	ctx := context.Background()
	for name, store := range stores {
		runID, err := store.CreateRun(ctx, "parity", &types.Plan{Nodes: []types.NodeSpec{{ID: "n"}}}, "")
		if err != nil {
			t.Fatalf("[%s] CreateRun: %v", name, err)
		}
		for _, typ := range []types.EventType{types.EventTypeLog, types.EventTypeProgress, types.EventTypeLog} {
			if _, err := store.AppendEvent(ctx, runID, &types.EventInput{
				Type: typ, NodeID: "n", Data: map[string]interface{}{"type": string(typ)},
			}); err != nil {
				t.Fatalf("[%s] AppendEvent: %v", name, err)
			}
		}

		full, err := store.GetEventsSince(ctx, runID, "")
		if err != nil {
			t.Fatalf("[%s] GetEventsSince(all): %v", name, err)
		}
		typesSeen := make([]string, len(full))
		for i, e := range full {
			typesSeen[i] = string(e.Type)
		}

		// Resume after the first event.
		var sinceFirst int
		if len(full) > 0 {
			rest, err := store.GetEventsSince(ctx, runID, full[0].ID)
			if err != nil {
				t.Fatalf("[%s] GetEventsSince(first): %v", name, err)
			}
			sinceFirst = len(rest)
		}

		// "0" is the redis "from start" sentinel; both backends must replay all.
		fromZeroEvents, err := store.GetEventsSince(ctx, runID, "0")
		if err != nil {
			t.Fatalf("[%s] GetEventsSince(\"0\"): %v", name, err)
		}

		results[name] = result{full: len(full), fullTypes: typesSeen, sinceFirst: sinceFirst, fromZero: len(fromZeroEvents)}
	}

	m, r := results["memory"], results["redis"]
	if m.full != 3 || r.full != 3 {
		t.Errorf("full event counts differ/wrong: memory=%d redis=%d, want 3 each", m.full, r.full)
	}
	if !equalStrings(m.fullTypes, r.fullTypes) {
		t.Errorf("event type order differs: memory=%v redis=%v", m.fullTypes, r.fullTypes)
	}
	if m.sinceFirst != r.sinceFirst {
		t.Errorf("Last-Event-ID resumption differs: memory=%d redis=%d events after first", m.sinceFirst, r.sinceFirst)
	}
	if m.sinceFirst != 2 {
		t.Errorf("resumption after first event = %d, want 2", m.sinceFirst)
	}
	if m.fromZero != r.fromZero {
		t.Errorf("\"0\" from-start replay differs: memory=%d redis=%d", m.fromZero, r.fromZero)
	}
	if m.fromZero != 3 {
		t.Errorf("\"0\" from-start replay = %d, want 3 (replay all)", m.fromZero)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
