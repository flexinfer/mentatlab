package validator

import (
	"testing"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func TestValidatePlanCapabilitiesRejectsMCPNodeWithoutNetworkOrSecrets(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:      "mcp-1",
				Type:    "mcp:flexinfer-template-inference",
				AgentID: "loom-mcp-executor",
				Capabilities: &types.CapabilityDeclaration{
					Actions: []string{"call_tool"},
				},
				Env: map[string]string{
					"INPUT_SPEC": `{"runtime_contract":{"kind":"flexinfer_inference","required_env":["FLEXINFER_PROXY_URL"]}}`,
				},
			},
		},
	}

	result := ValidatePlanCapabilities(plan)
	if result.Valid {
		t.Fatal("expected validation failure")
	}
	if len(result.Errors) < 2 {
		t.Fatalf("expected multiple errors, got %+v", result.Errors)
	}
}

func TestValidatePlanCapabilitiesAllowsMatchingRuntimeContract(t *testing.T) {
	plan := &types.Plan{
		Nodes: []types.NodeSpec{
			{
				ID:      "mcp-1",
				Type:    "mcp:flexinfer-template-inference",
				AgentID: "loom-mcp-executor",
				Capabilities: &types.CapabilityDeclaration{
					Actions: []string{"call_tool"},
					Network: true,
					Secrets: true,
				},
				Env: map[string]string{
					"INPUT_SPEC": `{"runtime_contract":{"kind":"flexinfer_inference","required_env":["FLEXINFER_PROXY_URL"]}}`,
				},
			},
		},
	}

	result := ValidatePlanCapabilities(plan)
	if !result.Valid {
		t.Fatalf("expected valid plan, got %+v", result.Errors)
	}
}
