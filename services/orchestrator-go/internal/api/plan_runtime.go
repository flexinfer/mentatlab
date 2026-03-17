package api

import (
	"context"
	"fmt"
	"time"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/registry"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/validator"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

func (h *Handlers) preparePlanForExecution(ctx context.Context, plan *types.Plan) *validator.ValidationResult {
	if plan == nil {
		return &validator.ValidationResult{Valid: true}
	}
	if err := h.enrichPlanWithAgentMetadata(ctx, plan); err != nil {
		return &validator.ValidationResult{
			Valid: false,
			Errors: []validator.ValidationError{
				{Path: "$.nodes", Message: err.Error()},
			},
		}
	}
	if result := validator.ValidatePlanGraph(plan); !result.Valid {
		return result
	}
	return validator.ValidatePlanCapabilities(plan)
}

func (h *Handlers) enrichPlanWithAgentMetadata(ctx context.Context, plan *types.Plan) error {
	if h.registry == nil || plan == nil {
		return nil
	}

	for i := range plan.Nodes {
		node := &plan.Nodes[i]
		if node.AgentID == "" {
			continue
		}

		agent, err := h.registry.Get(ctx, node.AgentID)
		if err != nil {
			if err == registry.ErrAgentNotFound && (len(node.Command) > 0 || node.Image != "" || node.Capabilities != nil || node.Resources != nil) {
				continue
			}
			return fmt.Errorf("agent %q metadata unavailable: %w", node.AgentID, err)
		}

		if len(node.Command) == 0 && len(agent.Command) > 0 {
			node.Command = append([]string(nil), agent.Command...)
		}
		if node.Image == "" && agent.Image != "" {
			node.Image = agent.Image
		}
		if node.Capabilities == nil && agent.CapabilitySpec != nil {
			caps := *agent.CapabilitySpec
			if len(caps.Actions) > 0 {
				caps.Actions = append([]string(nil), caps.Actions...)
			}
			node.Capabilities = &caps
		}
		if node.Resources == nil && agent.Resources != nil {
			res := *agent.Resources
			node.Resources = &res
		}
		if node.Timeout == 0 && node.Resources != nil && node.Resources.TimeoutSeconds > 0 {
			node.Timeout = time.Duration(node.Resources.TimeoutSeconds) * time.Second
		}
	}

	return nil
}

func parseManifestCapabilities(manifest map[string]interface{}) *types.CapabilityDeclaration {
	raw, ok := manifest["capabilities"].(map[string]interface{})
	if !ok || len(raw) == 0 {
		return nil
	}

	caps := &types.CapabilityDeclaration{}
	if actions, ok := raw["actions"].([]interface{}); ok {
		for _, action := range actions {
			if s, ok := action.(string); ok && s != "" {
				caps.Actions = append(caps.Actions, s)
			}
		}
	}
	if v, ok := raw["supports_progress"].(bool); ok {
		caps.SupportsProgress = v
	}
	if v, ok := raw["supports_heartbeat"].(bool); ok {
		caps.SupportsHeartbeat = v
	}
	if v, ok := raw["gpu"].(bool); ok {
		caps.GPU = v
	}
	if v, ok := raw["network"].(bool); ok {
		caps.Network = v
	}
	if v, ok := raw["storage"].(bool); ok {
		caps.Storage = v
	}
	if v, ok := raw["secrets"].(bool); ok {
		caps.Secrets = v
	}
	return caps
}

func parseManifestResources(manifest map[string]interface{}) *types.ResourceRequirements {
	raw, ok := manifest["resources"].(map[string]interface{})
	if !ok || len(raw) == 0 {
		return nil
	}

	res := &types.ResourceRequirements{}
	if v, ok := raw["cpu"].(string); ok {
		res.CPU = v
	}
	if v, ok := raw["memory"].(string); ok {
		res.Memory = v
	}
	if v, ok := raw["gpu"].(string); ok {
		res.GPU = v
	} else if v, ok := raw["gpu"].(bool); ok && v {
		res.GPU = "1"
	}
	if v, ok := raw["timeout_seconds"].(float64); ok {
		res.TimeoutSeconds = int(v)
	}
	if v, ok := raw["max_concurrent"].(float64); ok {
		res.MaxConcurrent = int(v)
	}
	return res
}
