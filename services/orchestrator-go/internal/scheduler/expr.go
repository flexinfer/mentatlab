// Package scheduler provides DAG execution for orchestrator runs.
package scheduler

import (
	"fmt"
	"sync"

	"github.com/expr-lang/expr"
	"github.com/expr-lang/expr/vm"
)

// ExprEvaluator provides safe expression evaluation with caching.
// Expressions are compiled once and cached for reuse.
type ExprEvaluator struct {
	compiled map[string]*vm.Program
	mu       sync.RWMutex

	// MaxExpressionLength limits expression size for security (default: 4096)
	MaxExpressionLength int
}

// NewExprEvaluator creates a new expression evaluator.
func NewExprEvaluator() *ExprEvaluator {
	return &ExprEvaluator{
		compiled:            make(map[string]*vm.Program),
		MaxExpressionLength: 4096,
	}
}

// Evaluate evaluates an expression against an environment.
// The environment should contain maps like:
//   - inputs: outputs from predecessor nodes
//   - context: run-level context (run_id, iteration variables, etc.)
func (e *ExprEvaluator) Evaluate(expression string, env map[string]interface{}) (interface{}, error) {
	// Security check: limit expression length
	if len(expression) > e.MaxExpressionLength {
		return nil, fmt.Errorf("expression exceeds maximum length of %d characters", e.MaxExpressionLength)
	}

	// Check cache
	e.mu.RLock()
	prog, ok := e.compiled[expression]
	e.mu.RUnlock()

	if !ok {
		// Compile expression
		var err error
		prog, err = expr.Compile(expression, expr.Env(env))
		if err != nil {
			return nil, fmt.Errorf("compile expression %q: %w", expression, err)
		}

		// Cache compiled program
		e.mu.Lock()
		e.compiled[expression] = prog
		e.mu.Unlock()
	}

	// Run the expression
	result, err := expr.Run(prog, env)
	if err != nil {
		return nil, fmt.Errorf("evaluate expression %q: %w", expression, err)
	}

	return result, nil
}

// EvaluateBool evaluates an expression and returns a boolean result.
// Returns an error if the expression does not return a boolean.
func (e *ExprEvaluator) EvaluateBool(expression string, env map[string]interface{}) (bool, error) {
	result, err := e.Evaluate(expression, env)
	if err != nil {
		return false, err
	}

	switch v := result.(type) {
	case bool:
		return v, nil
	case int:
		return v != 0, nil
	case int64:
		return v != 0, nil
	case float64:
		return v != 0, nil
	case string:
		return v != "", nil
	case nil:
		return false, nil
	default:
		return false, fmt.Errorf("expression %q returned %T, expected bool", expression, result)
	}
}

// EvaluateString evaluates an expression and returns a string result.
// Non-string results are converted using fmt.Sprint.
func (e *ExprEvaluator) EvaluateString(expression string, env map[string]interface{}) (string, error) {
	result, err := e.Evaluate(expression, env)
	if err != nil {
		return "", err
	}

	if s, ok := result.(string); ok {
		return s, nil
	}

	return fmt.Sprint(result), nil
}

// EvaluateSlice evaluates an expression and returns a slice result.
// Returns an error if the expression does not return a slice-like type.
func (e *ExprEvaluator) EvaluateSlice(expression string, env map[string]interface{}) ([]interface{}, error) {
	result, err := e.Evaluate(expression, env)
	if err != nil {
		return nil, err
	}

	return toSlice(result)
}

// toSlice converts various collection types to []interface{}.
func toSlice(v interface{}) ([]interface{}, error) {
	switch val := v.(type) {
	case []interface{}:
		return val, nil
	case []string:
		result := make([]interface{}, len(val))
		for i, s := range val {
			result[i] = s
		}
		return result, nil
	case []int:
		result := make([]interface{}, len(val))
		for i, n := range val {
			result[i] = n
		}
		return result, nil
	case []float64:
		result := make([]interface{}, len(val))
		for i, n := range val {
			result[i] = n
		}
		return result, nil
	case []map[string]interface{}:
		result := make([]interface{}, len(val))
		for i, m := range val {
			result[i] = m
		}
		return result, nil
	case nil:
		return []interface{}{}, nil
	default:
		return nil, fmt.Errorf("cannot convert %T to slice", v)
	}
}

// BuildEnvironment creates an evaluation environment from node outputs.
// The returned map has structure:
//
//	{
//	  "inputs": { "node_id": { "output_name": value, ... }, ... },
//	  "context": { "run_id": "...", "iteration": {...}, ... }
//	}
func BuildEnvironment(nodeOutputs map[string]map[string]interface{}, contextVars map[string]interface{}) map[string]interface{} {
	env := make(map[string]interface{})

	// Flatten inputs for convenient access: inputs.node_id.field
	if nodeOutputs != nil {
		env["inputs"] = nodeOutputs
	} else {
		env["inputs"] = make(map[string]interface{})
	}

	// Add context variables
	if contextVars != nil {
		env["context"] = contextVars
	} else {
		env["context"] = make(map[string]interface{})
	}

	// For convenience, also add top-level access to common context vars
	if contextVars != nil {
		for k, v := range contextVars {
			// Don't overwrite inputs/context
			if k != "inputs" && k != "context" {
				env[k] = v
			}
		}
	}

	return env
}
