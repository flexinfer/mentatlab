// Package types provides shared types for the orchestrator service.
package types

import (
	"time"
)

// RunStatus represents the current state of a run.
type RunStatus string

const (
	RunStatusQueued    RunStatus = "queued"
	RunStatusRunning   RunStatus = "running"
	RunStatusSucceeded RunStatus = "succeeded"
	RunStatusFailed    RunStatus = "failed"
	RunStatusCancelled RunStatus = "cancelled"
)

// NodeStatus represents the current state of a node within a run.
type NodeStatus string

const (
	NodeStatusPending         NodeStatus = "pending"
	NodeStatusRunning         NodeStatus = "running"
	NodeStatusSucceeded       NodeStatus = "succeeded"
	NodeStatusFailed          NodeStatus = "failed"
	NodeStatusSkipped         NodeStatus = "skipped"
	NodeStatusWaitingApproval NodeStatus = "waiting_approval"
)

// Run represents a single execution of a graph/flow.
type Run struct {
	ID            string            `json:"id"`
	Name          string            `json:"name,omitempty"`
	Owner         string            `json:"owner,omitempty"`    // User who created the run (email)
	TraceID       string            `json:"trace_id,omitempty"` // OpenTelemetry trace ID for distributed tracing
	Status        RunStatus         `json:"status"`
	Plan          *Plan             `json:"plan,omitempty"`
	FlowID        string            `json:"flow_id,omitempty"`       // Source flow ID for lineage
	ParentRunID   string            `json:"parent_run_id,omitempty"` // Cloned from this run
	StartedAt     *time.Time        `json:"started_at,omitempty"`
	FinishedAt    *time.Time        `json:"finished_at,omitempty"`
	Error         string            `json:"error,omitempty"`
	WebhookURL    string            `json:"webhook_url,omitempty"`    // URL to POST on completion
	WebhookSecret string            `json:"webhook_secret,omitempty"` // HMAC-SHA256 signing secret
	Metadata      map[string]string `json:"metadata,omitempty"`
	CreatedAt     time.Time         `json:"created_at"`
	UpdatedAt     time.Time         `json:"updated_at"`
}

// RunMeta is a lightweight representation of a run for listing.
type RunMeta struct {
	ID         string            `json:"id"`
	Name       string            `json:"name,omitempty"`
	Owner      string            `json:"owner,omitempty"`
	TraceID    string            `json:"trace_id,omitempty"`
	Status     RunStatus         `json:"status"`
	StartedAt  *time.Time        `json:"started_at,omitempty"`
	FinishedAt *time.Time        `json:"finished_at,omitempty"`
	Error      string            `json:"error,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
	CreatedAt  time.Time         `json:"created_at"`
	UpdatedAt  time.Time         `json:"updated_at"`
}

// Plan describes the execution plan for a run.
type Plan struct {
	Nodes   []NodeSpec    `json:"nodes"`
	Edges   []EdgeSpec    `json:"edges,omitempty"`
	Timeout time.Duration `json:"timeout,omitempty"` // Run-level timeout; 0 means no timeout
}

// BackoffType controls how retry delays are calculated.
type BackoffType string

const (
	BackoffFixed       BackoffType = "fixed"
	BackoffExponential BackoffType = "exponential"
	BackoffLinear      BackoffType = "linear"
)

// RetryPolicy configures per-node retry behavior.
type RetryPolicy struct {
	MaxRetries  int           `json:"max_retries"`
	BackoffType BackoffType   `json:"backoff_type,omitempty"` // fixed, exponential, linear (default: exponential)
	BackoffBase time.Duration `json:"backoff_base,omitempty"` // Base delay between retries (default: 2s)
	BackoffMax  time.Duration `json:"backoff_max,omitempty"`  // Maximum delay cap (default: 60s)
}

// MCPConfig holds MCP tool metadata for nodes that invoke MCP tools.
type MCPConfig struct {
	ToolName string         `json:"tool_name"`
	Server   string         `json:"server,omitempty"`
	ToolArgs map[string]any `json:"tool_args,omitempty"`
}

// NodeSpec describes a single node in the execution plan.
type NodeSpec struct {
	ID               string            `json:"id"`
	Type             string            `json:"type"`
	AgentID          string            `json:"agent_id,omitempty"`
	Command          []string          `json:"command,omitempty"`
	Image            string            `json:"image,omitempty"`
	Env              map[string]string `json:"env,omitempty"`
	Inputs           []string          `json:"inputs,omitempty"` // Node IDs this depends on
	Timeout          time.Duration     `json:"timeout,omitempty"`
	HeartbeatTimeout time.Duration     `json:"heartbeat_timeout,omitempty"`
	Retries          int               `json:"retries,omitempty"`

	// MCP tool configuration (populated from canvas MCP node data)
	MCP *MCPConfig `json:"mcp,omitempty"`

	// Per-node retry policy (overrides global defaults when set)
	RetryPolicy *RetryPolicy `json:"retry_policy,omitempty"`

	// Control flow configurations (only one should be set for control flow nodes)
	Conditional *ConditionalConfig `json:"conditional,omitempty"`
	ForEach     *ForEachConfig     `json:"for_each,omitempty"`
	Subflow     *SubflowConfig     `json:"subflow,omitempty"`
	Gate        *GateConfig        `json:"gate,omitempty"`
}

// IsControlFlow returns true if this node is a control flow node.
func (n *NodeSpec) IsControlFlow() bool {
	return n.Conditional != nil || n.ForEach != nil || n.Subflow != nil || n.Gate != nil
}

// GetControlFlowType returns the control flow type or empty string if not a control flow node.
func (n *NodeSpec) GetControlFlowType() string {
	switch {
	case n.Conditional != nil:
		return NodeTypeConditional
	case n.ForEach != nil:
		return NodeTypeForEach
	case n.Subflow != nil:
		return NodeTypeSubflow
	case n.Gate != nil:
		return NodeTypeGate
	default:
		return ""
	}
}

// EdgeSpec describes a data flow edge between nodes.
type EdgeSpec struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// NodeState tracks the runtime state of a node within a run.
type NodeState struct {
	NodeID     string     `json:"node_id"`
	Status     NodeStatus `json:"status"`
	StartedAt  *time.Time `json:"started_at,omitempty"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	ExitCode   *int       `json:"exit_code,omitempty"`
	Error      string     `json:"error,omitempty"`
	Retries    int        `json:"retries"`
}
