package runstore

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// TestSubscribeCleanupNoPanicOnReconnect is a regression test for the
// "send on closed channel" panic that crashed the whole orchestrator when an
// SSE client disconnected and reconnected: cleanup() closed the subscriber
// channel while the streamReader goroutine (and notifySubscribers) could still
// be sending to it. Run with -race to catch the data race as well.
//
// Mirrors the HTTP lifecycle: each "connection" gets its own cancelable ctx
// that is canceled before cleanup, exactly as the SSE handler does on return.
func TestSubscribeCleanupNoPanicOnReconnect(t *testing.T) {
	store, _ := newTestRedisStore(t)
	bg := context.Background()

	runID, err := store.CreateRun(bg, "sse-reconnect", &types.Plan{
		Nodes: []types.NodeSpec{{ID: "n"}},
	}, "")
	if err != nil {
		t.Fatalf("CreateRun: %v", err)
	}

	// Continuously append events so notifySubscribers + streamReader both have
	// traffic to deliver to the (closing) subscriber channels.
	stopProducer := make(chan struct{})
	var producer sync.WaitGroup
	producer.Add(1)
	go func() {
		defer producer.Done()
		for {
			select {
			case <-stopProducer:
				return
			default:
			}
			_, _ = store.AppendEvent(bg, runID, &types.EventInput{
				Type:   types.EventTypeLog,
				NodeID: "n",
				Data:   map[string]interface{}{"type": "log", "message": "tick"},
			})
		}
	}()

	// Churn subscribe -> read a little -> cancel -> cleanup, many times.
	for i := 0; i < 40; i++ {
		ctx, cancel := context.WithCancel(bg)
		ch, cleanup, err := store.Subscribe(ctx, runID)
		if err != nil {
			cancel()
			t.Fatalf("Subscribe[%d]: %v", i, err)
		}
		// Drain whatever is buffered briefly to exercise the send path.
		drain := time.After(2 * time.Millisecond)
	drainLoop:
		for {
			select {
			case <-ch:
			case <-drain:
				break drainLoop
			}
		}
		cancel()  // mirror request-context cancellation on client disconnect
		cleanup() // must not panic and must not race the reader
	}

	close(stopProducer)
	producer.Wait()
}
