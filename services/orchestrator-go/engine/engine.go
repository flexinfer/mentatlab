package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type Engine struct {
	runs        map[string]*Run
	runsMu      sync.RWMutex
	redisClient *redis.Client
}

func NewEngine(redisAddr string) *Engine {
	rdb := redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	return &Engine{
		runs:        make(map[string]*Run),
		redisClient: rdb,
	}
}

func (e *Engine) StartRun(graph Graph) (*Run, error) {
	run := &Run{
		ID:        fmt.Sprintf("run-%d", time.Now().UnixNano()),
		GraphID:   graph.ID,
		Status:    RunStatusPending,
		StartTime: time.Now(),
	}

	e.runsMu.Lock()
	e.runs[run.ID] = run
	e.runsMu.Unlock()

	// Start execution in background
	go e.executeRun(run, graph)

	return run, nil
}

func (e *Engine) GetRun(runID string) (*Run, bool) {
	e.runsMu.RLock()
	defer e.runsMu.RUnlock()
	run, ok := e.runs[runID]
	return run, ok
}

func (e *Engine) executeRun(run *Run, graph Graph) {
	e.updateRunStatus(run, RunStatusRunning)
	e.publishEvent(run.ID, "stream_start", map[string]interface{}{
		"run_id": run.ID,
		"graph":  graph,
	})

	// Topological sort or simple sequence for now
	// Assuming nodes are in order for MVP
	for _, node := range graph.Nodes {
		e.publishEvent(run.ID, "stream_data", map[string]interface{}{
			"type": "node:exec",
			"node": node.ID,
			"step": 1,
		})

		// Simulate work
		time.Sleep(1 * time.Second)

		e.publishEvent(run.ID, "stream_data", map[string]interface{}{
			"type": "log",
			"node": node.ID,
			"msg":  fmt.Sprintf("Executed node %s", node.ID),
		})

		// Simulate output/edge
		if len(node.Inputs) > 0 {
			e.publishEvent(run.ID, "stream_data", map[string]interface{}{
				"type": "edge:transmit",
				"from": node.Inputs[0], // simplified
				"to":   node.ID,
				"size": 1024,
			})
		}
	}

	run.EndTime = time.Now()
	e.updateRunStatus(run, RunStatusCompleted)
	e.publishEvent(run.ID, "stream_end", map[string]interface{}{
		"run_id": run.ID,
		"status": "completed",
	})
}

func (e *Engine) updateRunStatus(run *Run, status RunStatus) {
	e.runsMu.Lock()
	run.Status = status
	e.runsMu.Unlock()
}

func (e *Engine) publishEvent(streamID string, eventType string, data interface{}) {
	msg := map[string]interface{}{
		"type":      eventType,
		"stream_id": streamID,
		"data":      data,
		"timestamp": time.Now().UnixMilli(),
	}

	bytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Failed to marshal event: %v", err)
		return
	}

	// Publish to global channel "stream:events"
	err = e.redisClient.Publish(context.Background(), "stream:events", bytes).Err()
	if err != nil {
		log.Printf("Failed to publish event to Redis: %v", err)
	}
}
