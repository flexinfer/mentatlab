package k8s

import (
	"testing"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func TestDefaultJobConfig(t *testing.T) {
	cfg := DefaultJobConfig()

	if cfg.Namespace != "mentatlab" {
		t.Errorf("expected namespace mentatlab, got %s", cfg.Namespace)
	}
	if cfg.DefaultCPULimit != "2" {
		t.Errorf("expected CPU limit 2, got %s", cfg.DefaultCPULimit)
	}
	if cfg.DefaultMemoryLimit != "2Gi" {
		t.Errorf("expected memory limit 2Gi, got %s", cfg.DefaultMemoryLimit)
	}
	if *cfg.BackoffLimit != 0 {
		t.Errorf("expected backoff limit 0, got %d", *cfg.BackoffLimit)
	}
	if *cfg.TTLSecondsAfterFinished != 3600 {
		t.Errorf("expected TTL 3600, got %d", *cfg.TTLSecondsAfterFinished)
	}
	if *cfg.ActiveDeadlineSeconds != 3600 {
		t.Errorf("expected deadline 3600, got %d", *cfg.ActiveDeadlineSeconds)
	}
}

func TestNewJobBuilder_NilConfig(t *testing.T) {
	builder := NewJobBuilder(nil)
	if builder == nil {
		t.Fatal("expected non-nil builder")
	}
	if builder.config.Namespace != "mentatlab" {
		t.Error("expected default config to be used")
	}
}

func TestBuildJob_BasicSpec(t *testing.T) {
	builder := NewJobBuilder(DefaultJobConfig())

	node := &types.NodeSpec{
		ID:      "echo-1",
		AgentID: "mentatlab.echo",
		Image:   "registry.harbor.lan/library/mentatlab-echoagent:latest",
	}

	job, err := builder.BuildJob("run-abcdef12-3456-7890", "echo-1", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Job name is sanitized
	if job.Name == "" {
		t.Error("expected non-empty job name")
	}
	if len(job.Name) > 63 {
		t.Errorf("job name exceeds 63 chars: %s", job.Name)
	}

	// Namespace
	if job.Namespace != "mentatlab" {
		t.Errorf("expected namespace mentatlab, got %s", job.Namespace)
	}

	// Labels
	labels := job.Labels
	if labels["mentatlab.io/run-id"] != "run-abcdef12-3456-7890" {
		t.Errorf("unexpected run-id label: %s", labels["mentatlab.io/run-id"])
	}
	if labels["mentatlab.io/node-id"] != "echo-1" {
		t.Errorf("unexpected node-id label: %s", labels["mentatlab.io/node-id"])
	}
	if labels["mentatlab.io/agent-id"] != "mentatlab.echo" {
		t.Errorf("unexpected agent-id label: %s", labels["mentatlab.io/agent-id"])
	}
	if labels["app.kubernetes.io/managed-by"] != "orchestrator" {
		t.Errorf("unexpected managed-by label: %s", labels["app.kubernetes.io/managed-by"])
	}

	// Container
	if len(job.Spec.Template.Spec.Containers) != 1 {
		t.Fatalf("expected 1 container, got %d", len(job.Spec.Template.Spec.Containers))
	}
	container := job.Spec.Template.Spec.Containers[0]
	if container.Name != "agent" {
		t.Errorf("expected container name agent, got %s", container.Name)
	}
	if container.Image != "registry.harbor.lan/library/mentatlab-echoagent:latest" {
		t.Errorf("unexpected image: %s", container.Image)
	}

	// RestartPolicy
	if job.Spec.Template.Spec.RestartPolicy != corev1.RestartPolicyNever {
		t.Errorf("expected RestartPolicyNever, got %s", job.Spec.Template.Spec.RestartPolicy)
	}

	// BackoffLimit
	if *job.Spec.BackoffLimit != 0 {
		t.Errorf("expected backoff limit 0, got %d", *job.Spec.BackoffLimit)
	}
}

func TestBuildJob_SecurityContext(t *testing.T) {
	builder := NewJobBuilder(DefaultJobConfig())

	node := &types.NodeSpec{
		ID:    "node-1",
		Image: "test:latest",
	}

	job, err := builder.BuildJob("run-12345678", "node-1", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Pod security context
	podSC := job.Spec.Template.Spec.SecurityContext
	if podSC == nil {
		t.Fatal("expected pod security context")
	}
	if *podSC.RunAsNonRoot != true {
		t.Error("expected RunAsNonRoot true")
	}
	if *podSC.RunAsUser != 1000 {
		t.Errorf("expected RunAsUser 1000, got %d", *podSC.RunAsUser)
	}
	if *podSC.FSGroup != 1000 {
		t.Errorf("expected FSGroup 1000, got %d", *podSC.FSGroup)
	}

	// Container security context
	container := job.Spec.Template.Spec.Containers[0]
	sc := container.SecurityContext
	if sc == nil {
		t.Fatal("expected container security context")
	}
	if *sc.AllowPrivilegeEscalation != false {
		t.Error("expected AllowPrivilegeEscalation false")
	}
	if *sc.ReadOnlyRootFilesystem != true {
		t.Error("expected ReadOnlyRootFilesystem true")
	}
	if *sc.RunAsNonRoot != true {
		t.Error("expected RunAsNonRoot true")
	}
	if *sc.RunAsUser != 1000 {
		t.Errorf("expected RunAsUser 1000, got %d", *sc.RunAsUser)
	}
	if len(sc.Capabilities.Drop) != 1 || sc.Capabilities.Drop[0] != "ALL" {
		t.Error("expected capabilities drop ALL")
	}
}

func TestBuildJob_WithCommand(t *testing.T) {
	builder := NewJobBuilder(DefaultJobConfig())

	node := &types.NodeSpec{
		ID:      "cmd-node",
		Image:   "python:3.12-slim",
		Command: []string{"python", "-c", "print('hello')"},
	}

	job, err := builder.BuildJob("run-12345678", "cmd-node", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	container := job.Spec.Template.Spec.Containers[0]
	if len(container.Command) != 1 || container.Command[0] != "python" {
		t.Errorf("unexpected command: %v", container.Command)
	}
	if len(container.Args) != 2 || container.Args[0] != "-c" || container.Args[1] != "print('hello')" {
		t.Errorf("unexpected args: %v", container.Args)
	}
}

func TestBuildJob_WithEnv(t *testing.T) {
	builder := NewJobBuilder(DefaultJobConfig())

	node := &types.NodeSpec{
		ID:    "env-node",
		Image: "test:latest",
		Env: map[string]string{
			"CUSTOM_VAR": "custom_value",
			"ANOTHER":    "val",
		},
	}

	job, err := builder.BuildJob("run-12345678", "env-node", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	container := job.Spec.Template.Spec.Containers[0]

	// Should have at least RUN_ID, NODE_ID, AGENT_ID + custom vars
	envMap := make(map[string]string)
	for _, ev := range container.Env {
		envMap[ev.Name] = ev.Value
	}
	if envMap["RUN_ID"] != "run-12345678" {
		t.Errorf("expected RUN_ID=run-12345678, got %s", envMap["RUN_ID"])
	}
	if envMap["NODE_ID"] != "env-node" {
		t.Errorf("expected NODE_ID=env-node, got %s", envMap["NODE_ID"])
	}
	if envMap["CUSTOM_VAR"] != "custom_value" {
		t.Errorf("expected CUSTOM_VAR=custom_value, got %s", envMap["CUSTOM_VAR"])
	}
	if envMap["ANOTHER"] != "val" {
		t.Errorf("expected ANOTHER=val, got %s", envMap["ANOTHER"])
	}
}

func TestBuildJob_WithTimeout(t *testing.T) {
	builder := NewJobBuilder(DefaultJobConfig())

	node := &types.NodeSpec{
		ID:      "timeout-node",
		Image:   "test:latest",
		Timeout: 120 * time.Second,
	}

	job, err := builder.BuildJob("run-12345678", "timeout-node", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if *job.Spec.ActiveDeadlineSeconds != 120 {
		t.Errorf("expected ActiveDeadlineSeconds 120, got %d", *job.Spec.ActiveDeadlineSeconds)
	}
}

func TestBuildJob_NoImage(t *testing.T) {
	builder := NewJobBuilder(DefaultJobConfig())

	node := &types.NodeSpec{
		ID: "no-image-node",
	}

	_, err := builder.BuildJob("run-12345678", "no-image-node", node)
	if err == nil {
		t.Fatal("expected error for missing image")
	}
}

func TestBuildJob_ImagePullSecrets(t *testing.T) {
	cfg := DefaultJobConfig()
	cfg.ImagePullSecrets = []string{"harbor-creds", "other-secret"}
	builder := NewJobBuilder(cfg)

	node := &types.NodeSpec{
		ID:    "pull-secret-node",
		Image: "registry.harbor.lan/library/agent:latest",
	}

	job, err := builder.BuildJob("run-12345678", "pull-secret-node", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	secrets := job.Spec.Template.Spec.ImagePullSecrets
	if len(secrets) != 2 {
		t.Fatalf("expected 2 image pull secrets, got %d", len(secrets))
	}
	if secrets[0].Name != "harbor-creds" {
		t.Errorf("expected harbor-creds, got %s", secrets[0].Name)
	}
	if secrets[1].Name != "other-secret" {
		t.Errorf("expected other-secret, got %s", secrets[1].Name)
	}
}

func TestBuildJob_ResourceLimits(t *testing.T) {
	cfg := DefaultJobConfig()
	cfg.DefaultCPULimit = "4"
	cfg.DefaultMemoryLimit = "4Gi"
	cfg.DefaultCPURequest = "500m"
	cfg.DefaultMemRequest = "256Mi"
	builder := NewJobBuilder(cfg)

	node := &types.NodeSpec{
		ID:    "resource-node",
		Image: "test:latest",
	}

	job, err := builder.BuildJob("run-12345678", "resource-node", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	container := job.Spec.Template.Spec.Containers[0]
	cpuLimit := container.Resources.Limits[corev1.ResourceCPU]
	if cpuLimit.String() != "4" {
		t.Errorf("expected CPU limit 4, got %s", cpuLimit.String())
	}
	memLimit := container.Resources.Limits[corev1.ResourceMemory]
	if memLimit.String() != "4Gi" {
		t.Errorf("expected memory limit 4Gi, got %s", memLimit.String())
	}
	cpuReq := container.Resources.Requests[corev1.ResourceCPU]
	if cpuReq.String() != "500m" {
		t.Errorf("expected CPU request 500m, got %s", cpuReq.String())
	}
	memReq := container.Resources.Requests[corev1.ResourceMemory]
	if memReq.String() != "256Mi" {
		t.Errorf("expected memory request 256Mi, got %s", memReq.String())
	}
}

func TestBuildJob_UsesNodeRuntimeHints(t *testing.T) {
	builder := NewJobBuilder(DefaultJobConfig())

	node := &types.NodeSpec{
		ID:    "gpu-node",
		Image: "test:latest",
		Capabilities: &types.CapabilityDeclaration{
			GPU: true,
		},
		Resources: &types.ResourceRequirements{
			CPU:            "750m",
			Memory:         "768Mi",
			GPU:            "1",
			TimeoutSeconds: 45,
		},
	}

	job, err := builder.BuildJob("run-12345678", "gpu-node", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	container := job.Spec.Template.Spec.Containers[0]
	cpuReq := container.Resources.Requests[corev1.ResourceCPU]
	if got := cpuReq.String(); got != "750m" {
		t.Fatalf("expected CPU request 750m, got %s", got)
	}
	memLimit := container.Resources.Limits[corev1.ResourceMemory]
	if got := memLimit.String(); got != "768Mi" {
		t.Fatalf("expected memory limit 768Mi, got %s", got)
	}
	if got := job.Spec.Template.Spec.NodeSelector["flexinfer.ai/gpu-present"]; got != "true" {
		t.Fatalf("expected GPU node selector, got %q", got)
	}
	if got := *job.Spec.ActiveDeadlineSeconds; got != 45 {
		t.Fatalf("expected deadline 45, got %d", got)
	}
}

// --- GetJobStatus tests ---

func TestGetJobStatus_Succeeded(t *testing.T) {
	job := &batchv1.Job{
		Status: batchv1.JobStatus{
			Succeeded: 1,
		},
	}

	status := GetJobStatus(job)
	if status.Phase != "succeeded" {
		t.Errorf("expected phase succeeded, got %s", status.Phase)
	}
	if status.Succeeded != 1 {
		t.Errorf("expected Succeeded 1, got %d", status.Succeeded)
	}
}

func TestGetJobStatus_Failed(t *testing.T) {
	job := &batchv1.Job{
		Status: batchv1.JobStatus{
			Failed: 2,
		},
	}

	status := GetJobStatus(job)
	if status.Phase != "failed" {
		t.Errorf("expected phase failed, got %s", status.Phase)
	}
}

func TestGetJobStatus_Running(t *testing.T) {
	job := &batchv1.Job{
		Status: batchv1.JobStatus{
			Active: 1,
		},
	}

	status := GetJobStatus(job)
	if status.Phase != "running" {
		t.Errorf("expected phase running, got %s", status.Phase)
	}
}

func TestGetJobStatus_Pending(t *testing.T) {
	job := &batchv1.Job{
		Status: batchv1.JobStatus{},
	}

	status := GetJobStatus(job)
	if status.Phase != "pending" {
		t.Errorf("expected phase pending, got %s", status.Phase)
	}
}

func TestGetJobStatus_ConditionComplete(t *testing.T) {
	job := &batchv1.Job{
		Status: batchv1.JobStatus{
			Active: 0,
			Conditions: []batchv1.JobCondition{
				{
					Type:   batchv1.JobComplete,
					Status: corev1.ConditionTrue,
				},
			},
		},
	}

	status := GetJobStatus(job)
	if status.Phase != "succeeded" {
		t.Errorf("expected phase succeeded from condition, got %s", status.Phase)
	}
}

func TestGetJobStatus_ConditionFailed(t *testing.T) {
	job := &batchv1.Job{
		Status: batchv1.JobStatus{
			Active: 0,
			Conditions: []batchv1.JobCondition{
				{
					Type:   batchv1.JobFailed,
					Status: corev1.ConditionTrue,
				},
			},
		},
	}

	status := GetJobStatus(job)
	if status.Phase != "failed" {
		t.Errorf("expected phase failed from condition, got %s", status.Phase)
	}
}

func TestGetJobStatus_WithTimes(t *testing.T) {
	now := metav1.Now()
	job := &batchv1.Job{
		Status: batchv1.JobStatus{
			Succeeded:      1,
			StartTime:      &now,
			CompletionTime: &now,
		},
	}

	status := GetJobStatus(job)
	if status.StartTime == nil {
		t.Error("expected non-nil StartTime")
	}
	if status.EndTime == nil {
		t.Error("expected non-nil EndTime")
	}
}

// --- Sanitize helpers ---

func TestSanitizeK8sName(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"run-abc-node-xyz", "run-abc-node-xyz"},
		{"Run_ABC.Node_XYZ", "run-abc-node-xyz"},
		{"--leading-trailing--", "leading-trailing"},
		{"name with spaces!", "namewithspaces"},
		{
			// 70 chars should be truncated to 63
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := sanitizeK8sName(tt.input)
			if got != tt.expected {
				t.Errorf("sanitizeK8sName(%q) = %q, want %q", tt.input, got, tt.expected)
			}
			if len(got) > 63 {
				t.Errorf("result exceeds 63 chars: %d", len(got))
			}
		})
	}
}

func TestSanitizeK8sLabel(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"mentatlab.echo", "mentatlab.echo"},
		{"valid-label_value", "valid-label_value"},
		{"has spaces!", "hasspaces"},
		{"MixedCase", "MixedCase"},
		{
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := sanitizeK8sLabel(tt.input)
			if got != tt.expected {
				t.Errorf("sanitizeK8sLabel(%q) = %q, want %q", tt.input, got, tt.expected)
			}
			if len(got) > 63 {
				t.Errorf("result exceeds 63 chars: %d", len(got))
			}
		})
	}
}

// --- Template label propagation ---

func TestBuildJob_LabelsOnPodTemplate(t *testing.T) {
	builder := NewJobBuilder(DefaultJobConfig())

	node := &types.NodeSpec{
		ID:      "label-test",
		Image:   "test:latest",
		AgentID: "mentatlab.echo",
	}

	job, err := builder.BuildJob("run-12345678", "label-test", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Pod template should carry the same labels as the job
	podLabels := job.Spec.Template.Labels
	if podLabels["mentatlab.io/run-id"] != "run-12345678" {
		t.Error("pod template missing run-id label")
	}
	if podLabels["mentatlab.io/node-id"] != "label-test" {
		t.Error("pod template missing node-id label")
	}
	if podLabels["mentatlab.io/agent-id"] != "mentatlab.echo" {
		t.Error("pod template missing agent-id label")
	}
}

func TestBuildJob_NoAgentID(t *testing.T) {
	builder := NewJobBuilder(DefaultJobConfig())

	node := &types.NodeSpec{
		ID:    "no-agent",
		Image: "test:latest",
	}

	job, err := builder.BuildJob("run-12345678", "no-agent", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, ok := job.Labels["mentatlab.io/agent-id"]; ok {
		t.Error("expected no agent-id label when AgentID is empty")
	}
}

func TestBuildJob_NoCommand(t *testing.T) {
	builder := NewJobBuilder(DefaultJobConfig())

	node := &types.NodeSpec{
		ID:    "no-cmd",
		Image: "test:latest",
	}

	job, err := builder.BuildJob("run-12345678", "no-cmd", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	container := job.Spec.Template.Spec.Containers[0]
	if len(container.Command) != 0 {
		t.Errorf("expected no command, got %v", container.Command)
	}
	if len(container.Args) != 0 {
		t.Errorf("expected no args, got %v", container.Args)
	}
}

func TestBuildJob_DefaultDeadline(t *testing.T) {
	builder := NewJobBuilder(DefaultJobConfig())

	node := &types.NodeSpec{
		ID:    "deadline-node",
		Image: "test:latest",
		// No Timeout set — should use config default
	}

	job, err := builder.BuildJob("run-12345678", "deadline-node", node)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if *job.Spec.ActiveDeadlineSeconds != 3600 {
		t.Errorf("expected default deadline 3600, got %d", *job.Spec.ActiveDeadlineSeconds)
	}
}
