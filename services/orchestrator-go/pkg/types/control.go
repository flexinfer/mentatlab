// Package types provides shared types for the orchestrator service.
package types

// ConditionalConfig defines branching behavior for conditional nodes.
// Supports both "if" (boolean) and "switch" (multi-way) branching patterns.
type ConditionalConfig struct {
	// Type specifies the branching pattern: "if" for boolean or "switch" for multi-way.
	Type string `json:"type"`

	// Expression is evaluated to determine which branch to take.
	// For "if" type: should return a boolean (e.g., "inputs.score > 0.8")
	// For "switch" type: should return a value matching a branch key (e.g., "inputs.category")
	Expression string `json:"expression"`

	// Branches maps branch identifiers to their configuration.
	// For "if" type: expects "true" and "false" keys.
	// For "switch" type: keys are the expected expression results.
	Branches map[string]ConditionalBranch `json:"branches"`

	// Default specifies the branch to take if no match is found (for switch type).
	Default string `json:"default,omitempty"`
}

// ConditionalBranch represents a single branch in a conditional node.
type ConditionalBranch struct {
	// Condition is an optional expression for switch cases (for documentation/validation).
	Condition string `json:"condition,omitempty"`

	// Targets contains the IDs of downstream nodes to activate when this branch is taken.
	Targets []string `json:"targets"`
}

// ForEachConfig defines iteration behavior for loop nodes.
// Executes body nodes for each item in a collection.
type ForEachConfig struct {
	// Collection is an expression that yields an array (e.g., "inputs.items").
	Collection string `json:"collection"`

	// ItemVar is the variable name for the current item in each iteration.
	ItemVar string `json:"item_var"`

	// IndexVar is an optional variable name for the iteration index.
	IndexVar string `json:"index_var,omitempty"`

	// MaxParallel controls concurrency: 0 or 1 means sequential, >1 enables parallel execution.
	MaxParallel int `json:"max_parallel,omitempty"`

	// Body contains the IDs of nodes to execute for each iteration.
	Body []string `json:"body"`
}

// SubflowConfig defines nested DAG execution for subflow nodes.
// Allows composing complex workflows from reusable flow definitions.
type SubflowConfig struct {
	// FlowID identifies the flow definition to instantiate.
	FlowID string `json:"flow_id"`

	// InputMapping maps parent context variables to subflow input names.
	// Keys are parent variable names, values are subflow input parameter names.
	InputMapping map[string]string `json:"input_mapping,omitempty"`

	// OutputMapping maps subflow output names back to parent context variables.
	// Keys are subflow output names, values are parent variable names to populate.
	OutputMapping map[string]string `json:"output_mapping,omitempty"`
}

// NodeType constants for control flow nodes.
const (
	NodeTypeAgent       = "agent"
	NodeTypeConditional = "conditional"
	NodeTypeForEach     = "for_each"
	NodeTypeSubflow     = "subflow"
)

// IsControlFlowNode returns true if the node type is a control flow type.
func IsControlFlowNode(nodeType string) bool {
	switch nodeType {
	case NodeTypeConditional, NodeTypeForEach, NodeTypeSubflow:
		return true
	default:
		return false
	}
}
