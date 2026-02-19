package validator

import (
	"fmt"
	"strings"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

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

	// 4. Detect cycles using DFS topological sort (Kahn's would also work,
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
