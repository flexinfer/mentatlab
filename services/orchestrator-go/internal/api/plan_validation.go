package api

import (
	"context"
	"fmt"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/validator"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

// validateExecutablePlan performs the full set of pre-execution checks that
// require both plan structure and hydrated agent metadata.
func (h *Handlers) validateExecutablePlan(ctx context.Context, plan *types.Plan) (string, error) {
	if plan == nil {
		return "", nil
	}

	if result := validator.ValidatePlanGraph(plan); !result.Valid {
		return graphValidationMessage(result), nil
	}
	if err := h.hydrateRunPlan(ctx, plan); err != nil {
		return "", err
	}
	if result := h.validateCapabilityPairings(ctx, plan); !result.Valid {
		return graphValidationMessage(result), nil
	}

	return "", nil
}

func (h *Handlers) validateCapabilityPairings(ctx context.Context, plan *types.Plan) *validator.ValidationResult {
	if plan == nil || h.registry == nil {
		return &validator.ValidationResult{Valid: true}
	}

	type cachedLookup struct {
		found              bool
		supportsHeartbeat  bool
		capabilityDeclared bool
	}

	cache := make(map[string]cachedLookup)
	var errs []validator.ValidationError

	for i, node := range plan.Nodes {
		if node.AgentID == "" || node.HeartbeatTimeout <= 0 {
			continue
		}

		lookup, ok := cache[node.AgentID]
		if !ok {
			agent, err := h.registry.Get(ctx, node.AgentID)
			if err != nil || agent == nil || agent.CapabilitySpec == nil {
				cache[node.AgentID] = cachedLookup{}
				continue
			}
			lookup = cachedLookup{
				found:              true,
				supportsHeartbeat:  agent.CapabilitySpec.SupportsHeartbeat,
				capabilityDeclared: true,
			}
			cache[node.AgentID] = lookup
		}

		if !lookup.found || !lookup.capabilityDeclared || lookup.supportsHeartbeat {
			continue
		}

		errs = append(errs, validator.ValidationError{
			Path:    fmt.Sprintf("$.nodes[%d].heartbeat_timeout", i),
			Message: fmt.Sprintf("node %q sets heartbeat_timeout but agent %q declares supports_heartbeat=false", node.ID, node.AgentID),
		})
	}

	if len(errs) == 0 {
		return &validator.ValidationResult{Valid: true}
	}

	return &validator.ValidationResult{
		Valid:  false,
		Errors: errs,
	}
}
