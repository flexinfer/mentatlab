package driver

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"sync"
	"time"
)

// LocalSubprocessDriver executes nodes as local subprocesses.
// It parses NDJSON from stdout for structured events and emits log events for stderr.
type LocalSubprocessDriver struct {
	emitter        EventEmitter
	envPassthrough map[string]string
	cwd            string
	mu             sync.Mutex
}

// SubprocessConfig holds configuration for the subprocess driver.
type SubprocessConfig struct {
	// EnvPassthrough contains environment variables to pass to all subprocesses
	EnvPassthrough map[string]string

	// CWD is the working directory for subprocesses (empty = inherit)
	CWD string
}

// NewLocalSubprocessDriver creates a new subprocess driver.
func NewLocalSubprocessDriver(emitter EventEmitter, cfg *SubprocessConfig) *LocalSubprocessDriver {
	if cfg == nil {
		cfg = &SubprocessConfig{}
	}
	return &LocalSubprocessDriver{
		emitter:        emitter,
		envPassthrough: cfg.EnvPassthrough,
		cwd:            cfg.CWD,
	}
}

// RunNode executes the command as a subprocess and returns the exit code.
func (d *LocalSubprocessDriver) RunNode(ctx context.Context, runID, nodeID string, cmd []string, env map[string]string, timeout float64) (int, error) {
	if len(cmd) == 0 {
		return 1, fmt.Errorf("empty command")
	}

	// Emit node running status
	d.emitEvent(ctx, runID, "node_status", map[string]interface{}{
		"status": "running",
		"runId":  runID,
		"nodeId": nodeID,
	}, nodeID, "")

	// Build merged environment
	mergedEnv := os.Environ()
	for k, v := range d.envPassthrough {
		mergedEnv = append(mergedEnv, fmt.Sprintf("%s=%s", k, v))
	}
	for k, v := range env {
		mergedEnv = append(mergedEnv, fmt.Sprintf("%s=%s", k, v))
	}
	// Always pass run and node IDs
	mergedEnv = append(mergedEnv,
		fmt.Sprintf("RUN_ID=%s", runID),
		fmt.Sprintf("NODE_ID=%s", nodeID),
	)

	// Create context with timeout if specified
	execCtx := ctx
	var cancel context.CancelFunc
	if timeout > 0 {
		execCtx, cancel = context.WithTimeout(ctx, time.Duration(timeout*float64(time.Second)))
		defer cancel()
	}

	// Create command
	c := exec.CommandContext(execCtx, cmd[0], cmd[1:]...)
	c.Env = mergedEnv
	if d.cwd != "" {
		c.Dir = d.cwd
	}

	// Set up pipes
	stdout, err := c.StdoutPipe()
	if err != nil {
		return 1, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := c.StderrPipe()
	if err != nil {
		return 1, fmt.Errorf("stderr pipe: %w", err)
	}

	// Start the process
	if err := c.Start(); err != nil {
		d.emitEvent(ctx, runID, "node_status", map[string]interface{}{
			"status":   "failed",
			"runId":    runID,
			"nodeId":   nodeID,
			"reason":   "start_failed",
			"exitCode": -1,
		}, nodeID, "")
		return 1, fmt.Errorf("start: %w", err)
	}

	// Read stdout and stderr concurrently
	var wg sync.WaitGroup
	wg.Add(2)

	// Stdout reader - parse NDJSON
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stdout)
		// Increase buffer size for long lines
		buf := make([]byte, 64*1024)
		scanner.Buffer(buf, 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				continue
			}
			d.processStdoutLine(ctx, runID, nodeID, line)
		}
	}()

	// Stderr reader - emit as error logs
	go func() {
		defer wg.Done()
		scanner := bufio.NewScanner(stderr)
		buf := make([]byte, 64*1024)
		scanner.Buffer(buf, 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if line == "" {
				continue
			}
			d.emitEvent(ctx, runID, "log", map[string]interface{}{
				"message": line,
				"level":   "error",
				"runId":   runID,
				"nodeId":  nodeID,
			}, nodeID, "error")
		}
	}()

	// Wait for readers to finish
	wg.Wait()

	// Wait for process to exit
	err = c.Wait()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else if execCtx.Err() == context.DeadlineExceeded {
			// Timeout
			exitCode = 124 // Standard timeout exit code
			d.emitEvent(ctx, runID, "log", map[string]interface{}{
				"message": fmt.Sprintf("node %s timed out after %.1fs", nodeID, timeout),
				"level":   "error",
				"runId":   runID,
				"nodeId":  nodeID,
			}, nodeID, "error")
			d.emitEvent(ctx, runID, "node_status", map[string]interface{}{
				"status": "failed",
				"reason": "timeout",
				"runId":  runID,
				"nodeId": nodeID,
			}, nodeID, "")
			return exitCode, nil
		} else if execCtx.Err() == context.Canceled {
			// Cancelled
			exitCode = 130 // Standard interrupt exit code
			d.emitEvent(ctx, runID, "node_status", map[string]interface{}{
				"status": "failed",
				"reason": "cancelled",
				"runId":  runID,
				"nodeId": nodeID,
			}, nodeID, "")
			return exitCode, nil
		} else {
			exitCode = 1
		}
	}

	// Emit final node status
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

// processStdoutLine attempts to parse NDJSON and emit structured events.
func (d *LocalSubprocessDriver) processStdoutLine(ctx context.Context, runID, nodeID, line string) {
	var obj map[string]interface{}
	if err := json.Unmarshal([]byte(line), &obj); err != nil {
		// Not valid JSON - emit as plain log
		d.emitEvent(ctx, runID, "log", map[string]interface{}{
			"message": line,
			"level":   "info",
			"runId":   runID,
			"nodeId":  nodeID,
		}, nodeID, "info")
		return
	}

	// Extract event type (default: "log")
	eventType := "log"
	if t, ok := obj["type"].(string); ok && t != "" {
		eventType = t
	}

	// Extract level if present
	level := ""
	if l, ok := obj["level"].(string); ok {
		level = l
	}

	// Ensure run/node IDs are present
	if _, ok := obj["runId"]; !ok {
		obj["runId"] = runID
	}
	if _, ok := obj["nodeId"]; !ok {
		obj["nodeId"] = nodeID
	}

	d.emitEvent(ctx, runID, eventType, obj, nodeID, level)
}

// emitEvent sends an event through the emitter interface.
func (d *LocalSubprocessDriver) emitEvent(ctx context.Context, runID, eventType string, data map[string]interface{}, nodeID, level string) {
	if d.emitter == nil {
		return
	}
	if err := d.emitter.EmitEvent(ctx, runID, eventType, data, nodeID, level); err != nil {
		slog.Error("failed to emit event", slog.String("run_id", runID), slog.String("event_type", eventType), slog.Any("error", err))
	}
}
