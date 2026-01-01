// Package metrics provides Prometheus metrics for the orchestrator service.
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// RunsTotal counts total runs by status.
	RunsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "runs_total",
			Help:      "Total number of runs by final status",
		},
		[]string{"status"}, // "succeeded", "failed", "cancelled"
	)

	// RunsActive tracks currently active runs.
	RunsActive = promauto.NewGauge(
		prometheus.GaugeOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "runs_active",
			Help:      "Number of currently running runs",
		},
	)

	// RunDuration tracks run execution duration.
	RunDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "run_duration_seconds",
			Help:      "Run execution duration in seconds",
			Buckets:   []float64{1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600},
		},
		[]string{"status"},
	)

	// NodesTotal counts total nodes executed by status.
	NodesTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "nodes_total",
			Help:      "Total number of nodes executed by status",
		},
		[]string{"status"}, // "succeeded", "failed", "skipped"
	)

	// NodeDuration tracks node execution duration.
	NodeDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "node_duration_seconds",
			Help:      "Node execution duration in seconds",
			Buckets:   prometheus.DefBuckets,
		},
		[]string{"status"},
	)

	// NodeRetries tracks node retry attempts.
	NodeRetries = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "node_retries",
			Help:      "Number of retry attempts per node",
			Buckets:   []float64{0, 1, 2, 3, 4, 5},
		},
		[]string{"final_status"},
	)

	// EventsTotal counts events emitted by type.
	EventsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "events_total",
			Help:      "Total number of events emitted",
		},
		[]string{"type"},
	)

	// HTTPRequestsTotal counts HTTP requests by method, path, and status.
	HTTPRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "http_requests_total",
			Help:      "Total number of HTTP requests",
		},
		[]string{"method", "path", "status"},
	)

	// HTTPRequestDuration tracks request latency.
	HTTPRequestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "http_request_duration_seconds",
			Help:      "HTTP request duration in seconds",
			Buckets:   prometheus.DefBuckets,
		},
		[]string{"method", "path"},
	)

	// K8sJobsTotal counts K8s jobs by status.
	K8sJobsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "k8s_jobs_total",
			Help:      "Total number of K8s jobs created",
		},
		[]string{"status"},
	)

	// K8sJobDuration tracks K8s job duration.
	K8sJobDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "k8s_job_duration_seconds",
			Help:      "K8s job execution duration in seconds",
			Buckets:   []float64{1, 5, 10, 30, 60, 120, 300, 600},
		},
		[]string{"status"},
	)

	// RunStoreOperations counts runstore operations.
	RunStoreOperations = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "runstore_operations_total",
			Help:      "Total number of runstore operations",
		},
		[]string{"operation", "result"}, // operation: create, update, get; result: success, error
	)

	// SchedulerQueueDepth tracks pending nodes in scheduler.
	SchedulerQueueDepth = promauto.NewGauge(
		prometheus.GaugeOpts{
			Namespace: "mentatlab",
			Subsystem: "orchestrator",
			Name:      "scheduler_queue_depth",
			Help:      "Number of nodes pending execution",
		},
	)
)
