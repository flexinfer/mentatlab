package driver

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/k8s"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// K8sDriver executes nodes as Kubernetes Jobs.
type K8sDriver struct {
	client     *k8s.Client
	jobBuilder *k8s.JobBuilder
	emitter    EventEmitter
}

// K8sDriverConfig holds configuration for the K8s driver.
type K8sDriverConfig struct {
	// K8s client configuration
	K8sConfig *k8s.Config

	// Job configuration
	JobConfig *k8s.JobConfig
}

// NewK8sDriver creates a new K8s driver.
func NewK8sDriver(emitter EventEmitter, cfg *K8sDriverConfig) (*K8sDriver, error) {
	if cfg == nil {
		cfg = &K8sDriverConfig{}
	}

	client, err := k8s.NewClient(cfg.K8sConfig)
	if err != nil {
		return nil, fmt.Errorf("create k8s client: %w", err)
	}

	jobCfg := cfg.JobConfig
	if jobCfg == nil {
		jobCfg = k8s.DefaultJobConfig()
	}
	jobCfg.Namespace = client.Namespace()

	return &K8sDriver{
		client:     client,
		jobBuilder: k8s.NewJobBuilder(jobCfg),
		emitter:    emitter,
	}, nil
}

// RunNode creates a K8s Job and waits for completion.
func (d *K8sDriver) RunNode(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
	// Build node spec from parameters
	nodeSpec := &types.NodeSpec{
		ID:      nodeID,
		Command: cmd,
		Env:     env,
	}

	// Try to find image from env (passed by scheduler)
	if img, ok := env["AGENT_IMAGE"]; ok {
		nodeSpec.Image = img
	}

	// Use a default image if none specified
	if nodeSpec.Image == "" {
		// This shouldn't happen in production - scheduler should provide image
		log.Printf("warning: no image specified for node %s, using default", nodeID)
		nodeSpec.Image = "python:3.12-slim"
	}

	// Set timeout
	if timeout > 0 {
		nodeSpec.Timeout = time.Duration(timeout * float64(time.Second))
	}

	// Emit node running status
	d.emitEvent(ctx, runID, "node_status", map[string]interface{}{
		"status": "running",
		"runId":  runID,
		"nodeId": nodeID,
	}, nodeID, "")

	// Build the Job
	job, err := d.jobBuilder.BuildJob(runID, nodeID, nodeSpec)
	if err != nil {
		d.emitEvent(ctx, runID, "node_status", map[string]interface{}{
			"status": "failed",
			"reason": "build_job_failed",
			"error":  err.Error(),
			"runId":  runID,
			"nodeId": nodeID,
		}, nodeID, "")
		return 1, fmt.Errorf("build job: %w", err)
	}

	// Create the Job
	createdJob, err := d.client.CreateJob(ctx, job)
	if err != nil {
		d.emitEvent(ctx, runID, "node_status", map[string]interface{}{
			"status": "failed",
			"reason": "create_job_failed",
			"error":  err.Error(),
			"runId":  runID,
			"nodeId": nodeID,
		}, nodeID, "")
		return 1, fmt.Errorf("create job: %w", err)
	}

	jobName := createdJob.Name
	log.Printf("created k8s job %s for run %s node %s", jobName, runID, nodeID)

	// Set up log streaming
	watchCtx, watchCancel := context.WithCancel(ctx)
	defer watchCancel()

	exitCode := 0
	exitErr := error(nil)
	done := make(chan struct{})

	watcher := k8s.NewJobWatcher(d.client, jobName, runID, nodeID, &k8s.WatchConfig{
		OnLog: func(line string, isStderr bool) {
			d.processLogLine(ctx, runID, nodeID, line, isStderr)
		},
		OnStatus: func(status *k8s.JobStatus) {
			log.Printf("job %s status: %s", jobName, status.Phase)
		},
		OnComplete: func(code int, err error) {
			exitCode = code
			exitErr = err
			close(done)
			watchCancel()
		},
	})

	// Start watching in background
	go watcher.Watch(watchCtx)

	// Wait for completion or context cancellation
	select {
	case <-done:
		// Job completed
	case <-ctx.Done():
		// Context cancelled - delete the job
		if err := d.client.DeleteJob(context.Background(), jobName); err != nil {
			log.Printf("failed to delete job %s: %v", jobName, err)
		}
		d.emitEvent(ctx, runID, "node_status", map[string]interface{}{
			"status": "failed",
			"reason": "cancelled",
			"runId":  runID,
			"nodeId": nodeID,
		}, nodeID, "")
		return 130, ctx.Err()
	}

	// Handle errors
	if exitErr != nil {
		d.emitEvent(ctx, runID, "node_status", map[string]interface{}{
			"status":   "failed",
			"exitCode": exitCode,
			"error":    exitErr.Error(),
			"runId":    runID,
			"nodeId":   nodeID,
		}, nodeID, "")
		return exitCode, exitErr
	}

	// Emit final status
	if exitCode == 0 {
		d.emitEvent(ctx, runID, "node_status", map[string]interface{}{
			"status": "succeeded",
			"runId":  runID,
			"nodeId": nodeID,
		}, nodeID, "")
	} else {
		d.emitEvent(ctx, runID, "node_status", map[string]interface{}{
			"status":   "failed",
			"exitCode": exitCode,
			"runId":    runID,
			"nodeId":   nodeID,
		}, nodeID, "")
	}

	return exitCode, nil
}

// processLogLine handles a log line from the pod.
func (d *K8sDriver) processLogLine(ctx context.Context, runID, nodeID, line string, isStderr bool) {
	// Try to parse as NDJSON
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(line), &obj); err == nil {
		// Valid JSON - extract event type
		eventType := "log"
		if t, ok := obj["type"].(string); ok && t != "" {
			eventType = t
		}

		level := ""
		if l, ok := obj["level"].(string); ok {
			level = l
		}

		// Ensure run/node IDs
		if _, ok := obj["runId"]; !ok {
			obj["runId"] = runID
		}
		if _, ok := obj["nodeId"]; !ok {
			obj["nodeId"] = nodeID
		}

		d.emitEvent(ctx, runID, eventType, obj, nodeID, level)
	} else {
		// Plain text log
		level := "info"
		if isStderr {
			level = "error"
		}
		d.emitEvent(ctx, runID, "log", map[string]interface{}{
			"message": line,
			"level":   level,
			"runId":   runID,
			"nodeId":  nodeID,
		}, nodeID, level)
	}
}

// emitEvent sends an event through the emitter.
func (d *K8sDriver) emitEvent(ctx context.Context, runID, eventType string, data map[string]interface{}, nodeID, level string) {
	if d.emitter == nil {
		return
	}
	if err := d.emitter.EmitEvent(ctx, runID, eventType, data, nodeID, level); err != nil {
		log.Printf("emit event error: %v", err)
	}
}

// HealthCheck verifies K8s connectivity.
func (d *K8sDriver) HealthCheck(ctx context.Context) error {
	return d.client.HealthCheck(ctx)
}

// Ensure K8sDriver implements Driver
var _ Driver = (*K8sDriver)(nil)
