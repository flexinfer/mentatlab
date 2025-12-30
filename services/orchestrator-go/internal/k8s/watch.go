package k8s

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/watch"
)

// JobWatcher watches a Job and reports status changes and logs.
type JobWatcher struct {
	client    *Client
	jobName   string
	runID     string
	nodeID    string
	onLog     func(line string, isStderr bool)
	onStatus  func(status *JobStatus)
	onComplete func(exitCode int, err error)
}

// WatchConfig holds configuration for job watching.
type WatchConfig struct {
	// OnLog is called for each log line
	OnLog func(line string, isStderr bool)

	// OnStatus is called on status changes
	OnStatus func(status *JobStatus)

	// OnComplete is called when the job finishes
	OnComplete func(exitCode int, err error)
}

// NewJobWatcher creates a new watcher for a job.
func NewJobWatcher(client *Client, jobName, runID, nodeID string, cfg *WatchConfig) *JobWatcher {
	w := &JobWatcher{
		client:  client,
		jobName: jobName,
		runID:   runID,
		nodeID:  nodeID,
	}
	if cfg != nil {
		w.onLog = cfg.OnLog
		w.onStatus = cfg.OnStatus
		w.onComplete = cfg.OnComplete
	}
	return w
}

// Watch starts watching the job until completion.
func (w *JobWatcher) Watch(ctx context.Context) error {
	// Start watching the job
	go w.watchJob(ctx)

	// Wait for pod to be ready, then stream logs
	go w.streamLogs(ctx)

	// Wait for context cancellation (caller controls lifetime)
	<-ctx.Done()
	return ctx.Err()
}

// watchJob watches the Job resource for status changes.
func (w *JobWatcher) watchJob(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		watcher, err := w.client.clientset.BatchV1().Jobs(w.client.namespace).Watch(ctx, metav1.ListOptions{
			FieldSelector: fmt.Sprintf("metadata.name=%s", w.jobName),
		})
		if err != nil {
			log.Printf("watch job error: %v", err)
			time.Sleep(time.Second)
			continue
		}

		for event := range watcher.ResultChan() {
			select {
			case <-ctx.Done():
				watcher.Stop()
				return
			default:
			}

			if event.Type == watch.Error {
				continue
			}

			job, ok := event.Object.(*batchv1.Job)
			if !ok {
				continue
			}

			status := GetJobStatus(job)

			if w.onStatus != nil {
				w.onStatus(status)
			}

			// Check for completion
			if status.Phase == "succeeded" || status.Phase == "failed" {
				exitCode := 0
				if status.Phase == "failed" {
					exitCode = 1
				}
				if w.onComplete != nil {
					w.onComplete(exitCode, nil)
				}
				watcher.Stop()
				return
			}
		}
	}
}

// streamLogs streams logs from the job's pod.
func (w *JobWatcher) streamLogs(ctx context.Context) {
	// Wait for pod to be created
	podName, err := w.waitForPod(ctx)
	if err != nil {
		log.Printf("wait for pod error: %v", err)
		return
	}

	// Wait for container to be running
	if err := w.waitForContainer(ctx, podName); err != nil {
		log.Printf("wait for container error: %v", err)
		return
	}

	// Stream logs
	if err := w.followPodLogs(ctx, podName); err != nil {
		log.Printf("follow logs error: %v", err)
	}
}

// waitForPod waits for a pod to be created for the job.
func (w *JobWatcher) waitForPod(ctx context.Context) (string, error) {
	labelSelector := fmt.Sprintf("job-name=%s", w.jobName)

	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(time.Second):
		}

		pods, err := w.client.ListPods(ctx, labelSelector)
		if err != nil {
			continue
		}

		if len(pods.Items) > 0 {
			return pods.Items[0].Name, nil
		}
	}
}

// waitForContainer waits for the container to be running.
func (w *JobWatcher) waitForContainer(ctx context.Context, podName string) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}

		pod, err := w.client.clientset.CoreV1().Pods(w.client.namespace).Get(ctx, podName, metav1.GetOptions{})
		if err != nil {
			continue
		}

		// Check container status
		for _, cs := range pod.Status.ContainerStatuses {
			if cs.Name == "agent" {
				if cs.State.Running != nil || cs.State.Terminated != nil {
					return nil
				}
			}
		}

		// Also check phase
		if pod.Status.Phase == corev1.PodRunning ||
			pod.Status.Phase == corev1.PodSucceeded ||
			pod.Status.Phase == corev1.PodFailed {
			return nil
		}
	}
}

// followPodLogs streams logs from the pod.
func (w *JobWatcher) followPodLogs(ctx context.Context, podName string) error {
	req := w.client.clientset.CoreV1().Pods(w.client.namespace).GetLogs(podName, &corev1.PodLogOptions{
		Container: "agent",
		Follow:    true,
	})

	stream, err := req.Stream(ctx)
	if err != nil {
		return fmt.Errorf("get log stream: %w", err)
	}
	defer stream.Close()

	reader := bufio.NewReader(stream)
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				// Stream ended
				return nil
			}
			return err
		}

		line = strings.TrimSuffix(line, "\n")
		if line == "" {
			continue
		}

		if w.onLog != nil {
			w.onLog(line, false)
		}
	}
}

// WaitForJobCompletion blocks until the job completes.
func (c *Client) WaitForJobCompletion(ctx context.Context, jobName string, timeout time.Duration) (*JobStatus, error) {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}

		job, err := c.GetJob(ctx, jobName)
		if err != nil {
			continue
		}

		status := GetJobStatus(job)
		if status.Phase == "succeeded" || status.Phase == "failed" {
			return status, nil
		}
	}

	return nil, fmt.Errorf("timeout waiting for job %s", jobName)
}

// GetJobLogs retrieves all logs from a job's pod.
func (c *Client) GetJobLogs(ctx context.Context, jobName string) (string, error) {
	// Find the pod for this job
	labelSelector := fmt.Sprintf("job-name=%s", jobName)
	pods, err := c.ListPods(ctx, labelSelector)
	if err != nil {
		return "", fmt.Errorf("list pods: %w", err)
	}

	if len(pods.Items) == 0 {
		return "", fmt.Errorf("no pods found for job %s", jobName)
	}

	podName := pods.Items[0].Name
	return c.GetPodLogs(ctx, podName, &corev1.PodLogOptions{
		Container: "agent",
	})
}
