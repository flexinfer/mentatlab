package validator

import (
	"fmt"
	"strings"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

const maxForEachParallel = types.MaxForEachParallelSafetyCap

// ValidatePlanGraph performs structural validation of the plan's DAG beyond
// what JSON schema can express: duplicate node IDs, dangling edge references,
// and cycle detection.
func ValidatePlanGraph(plan *types.Plan) *ValidationResult {
	if plan == nil || len(plan.Nodes) == 0 {
		return &ValidationResult{Valid: true}
	}

	var errs []ValidationError

	// 1. Check for duplicate node IDs
	nodeSet := make(map[string]int) // id → first index
	for i, node := range plan.Nodes {
		if prev, exists := nodeSet[node.ID]; exists {
			errs = append(errs, ValidationError{
				Path:    fmt.Sprintf("$.nodes[%d].id", i),
				Message: fmt.Sprintf("duplicate node ID %q (first at index %d)", node.ID, prev),
			})
		} else {
			nodeSet[node.ID] = i
		}
	}

	// 2. Check for dangling edge references
	for i, edge := range plan.Edges {
		if _, ok := nodeSet[edge.From]; !ok {
			errs = append(errs, ValidationError{
				Path:    fmt.Sprintf("$.edges[%d].from", i),
				Message: fmt.Sprintf("edge references non-existent node %q", edge.From),
			})
		}
		if _, ok := nodeSet[edge.To]; !ok {
			errs = append(errs, ValidationError{
				Path:    fmt.Sprintf("$.edges[%d].to", i),
				Message: fmt.Sprintf("edge references non-existent node %q", edge.To),
			})
		}
	}

	// 3. Check for dangling Inputs references
	for i, node := range plan.Nodes {
		for _, inputID := range node.Inputs {
			if _, ok := nodeSet[inputID]; !ok {
				errs = append(errs, ValidationError{
					Path:    fmt.Sprintf("$.nodes[%d].inputs", i),
					Message: fmt.Sprintf("node %q references non-existent input %q", node.ID, inputID),
				})
			}
		}
	}

	// 4. Validate control-flow configuration references and safety bounds.
	errs = append(errs, validateControlFlowNodes(plan, nodeSet)...)

	// 5. Detect cycles using DFS topological sort (Kahn's would also work,
	//    but DFS gives us the cycle path for a better error message).
	if cycleErr := detectCycle(plan); cycleErr != nil {
		errs = append(errs, *cycleErr)
	}

	if len(errs) > 0 {
		return &ValidationResult{Valid: false, Errors: errs}
	}
	return &ValidationResult{Valid: true}
}

// detectCycle uses DFS with white/gray/black coloring to find cycles.
// Returns a ValidationError with the cycle path, or nil if acyclic.
func detectCycle(plan *types.Plan) *ValidationError {
	// Build adjacency list from both Edges and Inputs
	nodeIDs := make(map[string]bool)
	adj := make(map[string][]string)

	for _, node := range plan.Nodes {
		nodeIDs[node.ID] = true
		adj[node.ID] = nil // ensure entry exists
	}

	addEdge := func(from, to string) {
		if nodeIDs[from] && nodeIDs[to] {
			adj[from] = append(adj[from], to)
		}
	}

	for _, edge := range plan.Edges {
		addEdge(edge.From, edge.To)
	}
	for _, node := range plan.Nodes {
		for _, inputID := range node.Inputs {
			addEdge(inputID, node.ID)
		}
	}

	// DFS coloring: 0=white (unvisited), 1=gray (in current path), 2=black (done)
	color := make(map[string]int)
	parent := make(map[string]string)

	var dfs func(node string) []string
	dfs = func(node string) []string {
		color[node] = 1 // gray
		for _, next := range adj[node] {
			if color[next] == 1 {
				// Found cycle — reconstruct path
				cycle := []string{next, node}
				cur := node
				for cur != next {
					cur = parent[cur]
					if cur == "" {
						break
					}
					cycle = append(cycle, cur)
				}
				// Reverse to get forward order
				for i, j := 0, len(cycle)-1; i < j; i, j = i+1, j-1 {
					cycle[i], cycle[j] = cycle[j], cycle[i]
				}
				return cycle
			}
			if color[next] == 0 {
				parent[next] = node
				if cycle := dfs(next); cycle != nil {
					return cycle
				}
			}
		}
		color[node] = 2 // black
		return nil
	}

	for id := range nodeIDs {
		if color[id] == 0 {
			if cycle := dfs(id); cycle != nil {
				return &ValidationError{
					Path:    "$.edges",
					Message: fmt.Sprintf("cycle detected: %s", strings.Join(cycle, " → ")),
				}
			}
		}
	}

	return nil
}

func validateControlFlowNodes(plan *types.Plan, nodeSet map[string]int) []ValidationError {
	var errs []ValidationError

	for i, node := range plan.Nodes {
		if node.Type == types.NodeTypeConditional && node.Conditional == nil {
			errs = append(errs, ValidationError{
				Path:    fmt.Sprintf("$.nodes[%d].conditional", i),
				Message: fmt.Sprintf("conditional node %q requires conditional config", node.ID),
			})
		}
		if node.Type == types.NodeTypeForEach && node.ForEach == nil {
			errs = append(errs, ValidationError{
				Path:    fmt.Sprintf("$.nodes[%d].for_each", i),
				Message: fmt.Sprintf("for_each node %q requires for_each config", node.ID),
			})
		}
		if node.Conditional != nil {
			errs = append(errs, validateConditionalNode(node, i, nodeSet)...)
		}
		if node.ForEach != nil {
			errs = append(errs, validateForEachNode(node, i, nodeSet)...)
		}
	}

	return errs
}

func validateConditionalNode(node types.NodeSpec, nodeIndex int, nodeSet map[string]int) []ValidationError {
	var errs []ValidationError
	cfg := node.Conditional

	if strings.TrimSpace(cfg.Expression) == "" {
		errs = append(errs, ValidationError{
			Path:    fmt.Sprintf("$.nodes[%d].conditional.expression", nodeIndex),
			Message: fmt.Sprintf("conditional node %q requires a non-empty expression", node.ID),
		})
	}

	switch cfg.Type {
	case "if":
		if _, ok := cfg.Branches["true"]; !ok {
			errs = append(errs, ValidationError{
				Path:    fmt.Sprintf("$.nodes[%d].conditional.branches", nodeIndex),
				Message: fmt.Sprintf("conditional node %q with type \"if\" requires \"true\" branch", node.ID),
			})
		}
		if _, ok := cfg.Branches["false"]; !ok {
			errs = append(errs, ValidationError{
				Path:    fmt.Sprintf("$.nodes[%d].conditional.branches", nodeIndex),
				Message: fmt.Sprintf("conditional node %q with type \"if\" requires \"false\" branch", node.ID),
			})
		}
	case "switch":
		if cfg.Default != "" {
			if _, ok := cfg.Branches[cfg.Default]; !ok {
				errs = append(errs, ValidationError{
					Path:    fmt.Sprintf("$.nodes[%d].conditional.default", nodeIndex),
					Message: fmt.Sprintf("conditional node %q default branch %q is not defined", node.ID, cfg.Default),
				})
			}
		}
	default:
		errs = append(errs, ValidationError{
			Path:    fmt.Sprintf("$.nodes[%d].conditional.type", nodeIndex),
			Message: fmt.Sprintf("conditional node %q has unsupported type %q", node.ID, cfg.Type),
		})
	}

	if len(cfg.Branches) == 0 {
		errs = append(errs, ValidationError{
			Path:    fmt.Sprintf("$.nodes[%d].conditional.branches", nodeIndex),
			Message: fmt.Sprintf("conditional node %q must define at least one branch", node.ID),
		})
	}

	for branchID, branch := range cfg.Branches {
		for targetIndex, targetID := range branch.Targets {
			if _, ok := nodeSet[targetID]; !ok {
				errs = append(errs, ValidationError{
					Path:    fmt.Sprintf("$.nodes[%d].conditional.branches[%q].targets[%d]", nodeIndex, branchID, targetIndex),
					Message: fmt.Sprintf("conditional node %q branch %q references non-existent target %q", node.ID, branchID, targetID),
				})
			}
		}
	}

	return errs
}

func validateForEachNode(node types.NodeSpec, nodeIndex int, nodeSet map[string]int) []ValidationError {
	var errs []ValidationError
	cfg := node.ForEach

	if strings.TrimSpace(cfg.Collection) == "" {
		errs = append(errs, ValidationError{
			Path:    fmt.Sprintf("$.nodes[%d].for_each.collection", nodeIndex),
			Message: fmt.Sprintf("for_each node %q requires a non-empty collection expression", node.ID),
		})
	}
	if strings.TrimSpace(cfg.ItemVar) == "" {
		errs = append(errs, ValidationError{
			Path:    fmt.Sprintf("$.nodes[%d].for_each.item_var", nodeIndex),
			Message: fmt.Sprintf("for_each node %q requires a non-empty item_var", node.ID),
		})
	}
	if cfg.MaxParallel < 0 {
		errs = append(errs, ValidationError{
			Path:    fmt.Sprintf("$.nodes[%d].for_each.max_parallel", nodeIndex),
			Message: fmt.Sprintf("for_each node %q max_parallel must be >= 0", node.ID),
		})
	}
	if cfg.MaxParallel > maxForEachParallel {
		errs = append(errs, ValidationError{
			Path:    fmt.Sprintf("$.nodes[%d].for_each.max_parallel", nodeIndex),
			Message: fmt.Sprintf("for_each node %q max_parallel %d exceeds safety cap %d", node.ID, cfg.MaxParallel, maxForEachParallel),
		})
	}

	for bodyIndex, bodyNodeID := range cfg.Body {
		if _, ok := nodeSet[bodyNodeID]; !ok {
			errs = append(errs, ValidationError{
				Path:    fmt.Sprintf("$.nodes[%d].for_each.body[%d]", nodeIndex, bodyIndex),
				Message: fmt.Sprintf("for_each node %q body references non-existent node %q", node.ID, bodyNodeID),
			})
		}
	}

	return errs
}
