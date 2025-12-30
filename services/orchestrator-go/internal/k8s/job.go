package k8s

import (
	"fmt"
	"strings"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// JobConfig holds configuration for Job creation.
type JobConfig struct {
	// Namespace for the job
	Namespace string

	// ServiceAccountName for the pod
	ServiceAccountName string

	// ImagePullSecrets for private registries
	ImagePullSecrets []string

	// Default resource limits
	DefaultCPULimit    string
	DefaultMemoryLimit string
	DefaultCPURequest  string
	DefaultMemRequest  string

	// ActiveDeadlineSeconds for job timeout
	ActiveDeadlineSeconds *int64

	// TTLSecondsAfterFinished for cleanup
	TTLSecondsAfterFinished *int32

	// BackoffLimit for job retries
	BackoffLimit *int32
}

// DefaultJobConfig returns sensible defaults.
func DefaultJobConfig() *JobConfig {
	ttl := int32(3600)      // 1 hour
	backoff := int32(0)     // No automatic retries (scheduler handles retries)
	deadline := int64(3600) // 1 hour timeout

	return &JobConfig{
		Namespace:               "mentatlab",
		ServiceAccountName:      "default",
		DefaultCPULimit:         "2",
		DefaultMemoryLimit:      "2Gi",
		DefaultCPURequest:       "100m",
		DefaultMemRequest:       "128Mi",
		ActiveDeadlineSeconds:   &deadline,
		TTLSecondsAfterFinished: &ttl,
		BackoffLimit:            &backoff,
	}
}

// JobBuilder creates Kubernetes Jobs from NodeSpecs.
type JobBuilder struct {
	config *JobConfig
}

// NewJobBuilder creates a new JobBuilder.
func NewJobBuilder(cfg *JobConfig) *JobBuilder {
	if cfg == nil {
		cfg = DefaultJobConfig()
	}
	return &JobBuilder{config: cfg}
}

// BuildJob creates a K8s Job from a NodeSpec.
func (b *JobBuilder) BuildJob(runID, nodeID string, node *types.NodeSpec) (*batchv1.Job, error) {
	if node.Image == "" {
		return nil, fmt.Errorf("node %s has no image specified", nodeID)
	}

	// Generate unique job name
	jobName := sanitizeK8sName(fmt.Sprintf("run-%s-node-%s", runID[:8], nodeID))

	// Build labels
	labels := map[string]string{
		"app.kubernetes.io/name":       "mentatlab-agent",
		"app.kubernetes.io/component":  "agent",
		"app.kubernetes.io/managed-by": "orchestrator",
		"mentatlab.io/run-id":          runID,
		"mentatlab.io/node-id":         nodeID,
	}
	if node.AgentID != "" {
		labels["mentatlab.io/agent-id"] = sanitizeK8sLabel(node.AgentID)
	}

	// Build environment variables
	envVars := []corev1.EnvVar{
		{Name: "RUN_ID", Value: runID},
		{Name: "NODE_ID", Value: nodeID},
		{Name: "AGENT_ID", Value: node.AgentID},
	}
	for key, value := range node.Env {
		envVars = append(envVars, corev1.EnvVar{Name: key, Value: value})
	}

	// Build command
	var command []string
	var args []string
	if len(node.Command) > 0 {
		command = []string{node.Command[0]}
		if len(node.Command) > 1 {
			args = node.Command[1:]
		}
	}

	// Build resource requirements
	resources := corev1.ResourceRequirements{
		Limits: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse(b.config.DefaultCPULimit),
			corev1.ResourceMemory: resource.MustParse(b.config.DefaultMemoryLimit),
		},
		Requests: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse(b.config.DefaultCPURequest),
			corev1.ResourceMemory: resource.MustParse(b.config.DefaultMemRequest),
		},
	}

	// Build container
	container := corev1.Container{
		Name:            "agent",
		Image:           node.Image,
		Command:         command,
		Args:            args,
		Env:             envVars,
		Resources:       resources,
		ImagePullPolicy: corev1.PullIfNotPresent,
		// Security hardening
		SecurityContext: &corev1.SecurityContext{
			AllowPrivilegeEscalation: boolPtr(false),
			ReadOnlyRootFilesystem:   boolPtr(true),
			RunAsNonRoot:             boolPtr(true),
			RunAsUser:                int64Ptr(1000),
			Capabilities: &corev1.Capabilities{
				Drop: []corev1.Capability{"ALL"},
			},
		},
	}

	// Build pod spec
	podSpec := corev1.PodSpec{
		Containers:         []corev1.Container{container},
		RestartPolicy:      corev1.RestartPolicyNever, // Jobs handle restarts
		ServiceAccountName: b.config.ServiceAccountName,
		SecurityContext: &corev1.PodSecurityContext{
			RunAsNonRoot: boolPtr(true),
			RunAsUser:    int64Ptr(1000),
			FSGroup:      int64Ptr(1000),
		},
	}

	// Add image pull secrets
	for _, secret := range b.config.ImagePullSecrets {
		podSpec.ImagePullSecrets = append(podSpec.ImagePullSecrets,
			corev1.LocalObjectReference{Name: secret})
	}

	// Build job
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      jobName,
			Namespace: b.config.Namespace,
			Labels:    labels,
		},
		Spec: batchv1.JobSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: labels,
				},
				Spec: podSpec,
			},
			BackoffLimit:            b.config.BackoffLimit,
			ActiveDeadlineSeconds:   b.config.ActiveDeadlineSeconds,
			TTLSecondsAfterFinished: b.config.TTLSecondsAfterFinished,
		},
	}

	// Override deadline if node has timeout
	if node.Timeout > 0 {
		deadline := int64(node.Timeout.Seconds())
		job.Spec.ActiveDeadlineSeconds = &deadline
	}

	return job, nil
}

// JobStatus extracts status from a Job.
type JobStatus struct {
	Phase      string
	StartTime  *metav1.Time
	EndTime    *metav1.Time
	Succeeded  int32
	Failed     int32
	Active     int32
	Conditions []batchv1.JobCondition
}

// GetJobStatus extracts status from a Job object.
func GetJobStatus(job *batchv1.Job) *JobStatus {
	status := &JobStatus{
		Phase:      "unknown",
		StartTime:  job.Status.StartTime,
		EndTime:    job.Status.CompletionTime,
		Succeeded:  job.Status.Succeeded,
		Failed:     job.Status.Failed,
		Active:     job.Status.Active,
		Conditions: job.Status.Conditions,
	}

	// Determine phase
	if job.Status.Succeeded > 0 {
		status.Phase = "succeeded"
	} else if job.Status.Failed > 0 {
		status.Phase = "failed"
	} else if job.Status.Active > 0 {
		status.Phase = "running"
	} else {
		status.Phase = "pending"
	}

	// Check conditions for more detail
	for _, cond := range job.Status.Conditions {
		if cond.Type == batchv1.JobComplete && cond.Status == corev1.ConditionTrue {
			status.Phase = "succeeded"
		}
		if cond.Type == batchv1.JobFailed && cond.Status == corev1.ConditionTrue {
			status.Phase = "failed"
		}
	}

	return status
}

// Helper functions

func sanitizeK8sName(name string) string {
	// K8s names must be lowercase, alphanumeric, -, and max 63 chars
	name = strings.ToLower(name)
	var result strings.Builder
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' {
			result.WriteRune(r)
		} else if r == '_' || r == '.' {
			result.WriteRune('-')
		}
	}
	s := result.String()
	// Trim leading/trailing dashes
	s = strings.Trim(s, "-")
	// Max 63 chars
	if len(s) > 63 {
		s = s[:63]
	}
	return s
}

func sanitizeK8sLabel(value string) string {
	// Label values must be 63 chars or less, alphanumeric, -, _, .
	var result strings.Builder
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
			r == '-' || r == '_' || r == '.' {
			result.WriteRune(r)
		}
	}
	s := result.String()
	if len(s) > 63 {
		s = s[:63]
	}
	return s
}

func boolPtr(b bool) *bool {
	return &b
}

func int64Ptr(i int64) *int64 {
	return &i
}
