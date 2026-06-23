// Package k8s provides Kubernetes integration for running agents as Jobs.
package k8s

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/sony/gobreaker"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/metrics"
)

// Client wraps the Kubernetes clientset with orchestrator-specific methods.
type Client struct {
	clientset kubernetes.Interface
	namespace string
	breaker   *gobreaker.TwoStepCircuitBreaker
}

// Config holds K8s client configuration.
type Config struct {
	// InCluster indicates whether to use in-cluster config
	InCluster bool

	// Kubeconfig path (used when not in-cluster)
	Kubeconfig string

	// Namespace for orchestrator resources
	Namespace string
}

// DefaultConfig returns sensible defaults.
func DefaultConfig() *Config {
	// Try to find kubeconfig
	kubeconfig := os.Getenv("KUBECONFIG")
	if kubeconfig == "" {
		home, _ := os.UserHomeDir()
		if home != "" {
			kubeconfig = filepath.Join(home, ".kube", "config")
		}
	}

	return &Config{
		InCluster:  false,
		Kubeconfig: kubeconfig,
		Namespace:  "mentatlab",
	}
}

// NewClient creates a new K8s client.
func NewClient(cfg *Config) (*Client, error) {
	if cfg == nil {
		cfg = DefaultConfig()
	}

	var restConfig *rest.Config
	var err error

	if cfg.InCluster {
		restConfig, err = rest.InClusterConfig()
		if err != nil {
			return nil, fmt.Errorf("in-cluster config: %w", err)
		}
	} else {
		restConfig, err = clientcmd.BuildConfigFromFlags("", cfg.Kubeconfig)
		if err != nil {
			return nil, fmt.Errorf("kubeconfig: %w", err)
		}
	}

	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("create clientset: %w", err)
	}

	namespace := cfg.Namespace
	if namespace == "" {
		namespace = "mentatlab"
	}

	cb := gobreaker.NewTwoStepCircuitBreaker(gobreaker.Settings{
		Name:        "k8s",
		MaxRequests: 1,
		Timeout:     30 * time.Second,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= 5
		},
		OnStateChange: func(name string, from, to gobreaker.State) {
			metrics.CircuitBreakerState.WithLabelValues(name).Set(float64(to))
		},
	})

	return &Client{
		clientset: clientset,
		namespace: namespace,
		breaker:   cb,
	}, nil
}

// breakerGuard checks the circuit breaker and returns a done callback.
func (c *Client) breakerGuard() (func(bool), error) {
	if c.breaker == nil {
		return func(bool) {}, nil
	}
	done, err := c.breaker.Allow()
	if err != nil {
		return nil, fmt.Errorf("k8s circuit breaker open: %w", err)
	}
	return done, nil
}

// Namespace returns the configured namespace.
func (c *Client) Namespace() string {
	return c.namespace
}

// Clientset returns the underlying clientset for advanced operations.
func (c *Client) Clientset() kubernetes.Interface {
	return c.clientset
}

// NewClientForTesting creates a Client from a kubernetes.Interface for testing.
func NewClientForTesting(cs kubernetes.Interface, namespace string) *Client {
	return &Client{clientset: cs, namespace: namespace}
}

// CreateJob creates a new Job in the configured namespace.
func (c *Client) CreateJob(ctx context.Context, job *batchv1.Job) (_ *batchv1.Job, retErr error) {
	cbDone, cbErr := c.breakerGuard()
	if cbErr != nil {
		return nil, cbErr
	}
	defer func() { cbDone(retErr == nil) }()

	return c.clientset.BatchV1().Jobs(c.namespace).Create(ctx, job, metav1.CreateOptions{})
}

// GetJob retrieves a Job by name.
func (c *Client) GetJob(ctx context.Context, name string) (_ *batchv1.Job, retErr error) {
	cbDone, cbErr := c.breakerGuard()
	if cbErr != nil {
		return nil, cbErr
	}
	defer func() { cbDone(retErr == nil) }()

	return c.clientset.BatchV1().Jobs(c.namespace).Get(ctx, name, metav1.GetOptions{})
}

// DeleteJob deletes a Job by name.
func (c *Client) DeleteJob(ctx context.Context, name string) (retErr error) {
	cbDone, cbErr := c.breakerGuard()
	if cbErr != nil {
		return cbErr
	}
	defer func() { cbDone(retErr == nil) }()

	propagation := metav1.DeletePropagationBackground
	return c.clientset.BatchV1().Jobs(c.namespace).Delete(ctx, name, metav1.DeleteOptions{
		PropagationPolicy: &propagation,
	})
}

// ListJobs lists Jobs with the given label selector.
func (c *Client) ListJobs(ctx context.Context, labelSelector string) (_ *batchv1.JobList, retErr error) {
	cbDone, cbErr := c.breakerGuard()
	if cbErr != nil {
		return nil, cbErr
	}
	defer func() { cbDone(retErr == nil) }()

	return c.clientset.BatchV1().Jobs(c.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector,
	})
}

// GetPodLogs retrieves logs from a pod.
func (c *Client) GetPodLogs(ctx context.Context, podName string, opts *corev1.PodLogOptions) (_ string, retErr error) {
	cbDone, cbErr := c.breakerGuard()
	if cbErr != nil {
		return "", cbErr
	}
	defer func() { cbDone(retErr == nil) }()

	req := c.clientset.CoreV1().Pods(c.namespace).GetLogs(podName, opts)
	result, err := req.DoRaw(ctx)
	if err != nil {
		return "", err
	}
	return string(result), nil
}

// ListPods lists pods with the given label selector.
func (c *Client) ListPods(ctx context.Context, labelSelector string) (_ *corev1.PodList, retErr error) {
	cbDone, cbErr := c.breakerGuard()
	if cbErr != nil {
		return nil, cbErr
	}
	defer func() { cbDone(retErr == nil) }()

	return c.clientset.CoreV1().Pods(c.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector,
	})
}

// HealthCheck verifies connectivity to the K8s API.
func (c *Client) HealthCheck(ctx context.Context) (retErr error) {
	cbDone, cbErr := c.breakerGuard()
	if cbErr != nil {
		return cbErr
	}
	defer func() { cbDone(retErr == nil) }()

	_, err := c.clientset.Discovery().ServerVersion()
	return err
}
