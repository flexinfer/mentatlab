package api

import (
	"encoding/json"
	"fmt"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/validator"
)

func validateFlowGraph(graph json.RawMessage) error {
	plan, err := flowGraphToPlan(graph)
	if err != nil {
		return fmt.Errorf("invalid flow graph: %w", err)
	}
	if result := validator.ValidatePlanGraph(plan); !result.Valid {
		return fmt.Errorf("%s", graphValidationMessage(result))
	}
	return nil
}
