// Package k8s provides Kubernetes integration for running agents as Jobs.
package k8s

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// Client wraps the Kubernetes clientset with orchestrator-specific methods.
type Client struct {
	clientset *kubernetes.Clientset
	namespace string
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

	return &Client{
		clientset: clientset,
		namespace: namespace,
	}, nil
}

// Namespace returns the configured namespace.
func (c *Client) Namespace() string {
	return c.namespace
}

// Clientset returns the underlying clientset for advanced operations.
func (c *Client) Clientset() *kubernetes.Clientset {
	return c.clientset
}

// CreateJob creates a new Job in the configured namespace.
func (c *Client) CreateJob(ctx context.Context, job *batchv1.Job) (*batchv1.Job, error) {
	return c.clientset.BatchV1().Jobs(c.namespace).Create(ctx, job, metav1.CreateOptions{})
}

// GetJob retrieves a Job by name.
func (c *Client) GetJob(ctx context.Context, name string) (*batchv1.Job, error) {
	return c.clientset.BatchV1().Jobs(c.namespace).Get(ctx, name, metav1.GetOptions{})
}

// DeleteJob deletes a Job by name.
func (c *Client) DeleteJob(ctx context.Context, name string) error {
	propagation := metav1.DeletePropagationBackground
	return c.clientset.BatchV1().Jobs(c.namespace).Delete(ctx, name, metav1.DeleteOptions{
		PropagationPolicy: &propagation,
	})
}

// ListJobs lists Jobs with the given label selector.
func (c *Client) ListJobs(ctx context.Context, labelSelector string) (*batchv1.JobList, error) {
	return c.clientset.BatchV1().Jobs(c.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector,
	})
}

// GetPodLogs retrieves logs from a pod.
func (c *Client) GetPodLogs(ctx context.Context, podName string, opts *corev1.PodLogOptions) (string, error) {
	req := c.clientset.CoreV1().Pods(c.namespace).GetLogs(podName, opts)
	result, err := req.DoRaw(ctx)
	if err != nil {
		return "", err
	}
	return string(result), nil
}

// ListPods lists pods with the given label selector.
func (c *Client) ListPods(ctx context.Context, labelSelector string) (*corev1.PodList, error) {
	return c.clientset.CoreV1().Pods(c.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: labelSelector,
	})
}

// HealthCheck verifies connectivity to the K8s API.
func (c *Client) HealthCheck(ctx context.Context) error {
	_, err := c.clientset.Discovery().ServerVersion()
	return err
}
