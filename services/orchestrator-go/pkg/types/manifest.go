package types

// AgentManifest describes an agent's configuration for scheduling.
type AgentManifest struct {
	// Core identification
	ID          string `json:"id" yaml:"id"`
	Name        string `json:"name" yaml:"name"`
	Version     string `json:"version,omitempty" yaml:"version,omitempty"`
	Description string `json:"description,omitempty" yaml:"description,omitempty"`

	// Execution configuration
	Image   string   `json:"image,omitempty" yaml:"image,omitempty"`
	Command []string `json:"command,omitempty" yaml:"command,omitempty"`
	Args    []string `json:"args,omitempty" yaml:"args,omitempty"`

	// Environment variables
	Env []EnvVar `json:"env,omitempty" yaml:"env,omitempty"`

	// Resource requirements
	Resources ResourceRequirements `json:"resources,omitempty" yaml:"resources,omitempty"`

	// I/O configuration
	Inputs  []PinSpec `json:"inputs,omitempty" yaml:"inputs,omitempty"`
	Outputs []PinSpec `json:"outputs,omitempty" yaml:"outputs,omitempty"`

	// Lifecycle configuration
	TimeoutSeconds int `json:"timeout_seconds,omitempty" yaml:"timeout_seconds,omitempty"`
	Retries        int `json:"retries,omitempty" yaml:"retries,omitempty"`

	// Labels and annotations for K8s
	Labels      map[string]string `json:"labels,omitempty" yaml:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty" yaml:"annotations,omitempty"`
}

// EnvVar represents an environment variable.
type EnvVar struct {
	Name      string `json:"name" yaml:"name"`
	Value     string `json:"value,omitempty" yaml:"value,omitempty"`
	ValueFrom string `json:"value_from,omitempty" yaml:"value_from,omitempty"` // secret:name:key
}

// ResourceRequirements specifies compute resource requirements.
type ResourceRequirements struct {
	Requests ResourceList `json:"requests,omitempty" yaml:"requests,omitempty"`
	Limits   ResourceList `json:"limits,omitempty" yaml:"limits,omitempty"`
}

// ResourceList maps resource names to quantities.
type ResourceList struct {
	CPU    string `json:"cpu,omitempty" yaml:"cpu,omitempty"`       // e.g., "100m", "1"
	Memory string `json:"memory,omitempty" yaml:"memory,omitempty"` // e.g., "128Mi", "1Gi"
	GPU    string `json:"gpu,omitempty" yaml:"gpu,omitempty"`       // e.g., "1"
}

// PinSpec describes an input or output pin.
type PinSpec struct {
	Name        string `json:"name" yaml:"name"`
	Type        string `json:"type" yaml:"type"` // text, json, stream, file, image
	Description string `json:"description,omitempty" yaml:"description,omitempty"`
	Required    bool   `json:"required,omitempty" yaml:"required,omitempty"`
}

// AgentScheduleRequest is the request body for scheduling an agent.
type AgentScheduleRequest struct {
	AgentManifest  map[string]interface{} `json:"agent_manifest"`
	Inputs         map[string]interface{} `json:"inputs,omitempty"`
	ExecutionID    string                 `json:"execution_id,omitempty"`
	SkipValidation bool                   `json:"skip_validation,omitempty"`
}

// AgentScheduleResponse is the response body after scheduling an agent.
type AgentScheduleResponse struct {
	ResourceID string `json:"resource_id"`
	Status     string `json:"status"`
	StreamID   string `json:"stream_id,omitempty"`
	WSURL      string `json:"ws_url,omitempty"`
	SSEURL     string `json:"sse_url,omitempty"`
}
