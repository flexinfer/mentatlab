// Package scheduler provides DAG execution for orchestrator runs.
package scheduler

import (
	"testing"
)

func TestExprEvaluator_Evaluate(t *testing.T) {
	eval := NewExprEvaluator()

	tests := []struct {
		name       string
		expression string
		env        map[string]interface{}
		want       interface{}
		wantErr    bool
	}{
		{
			name:       "simple arithmetic",
			expression: "1 + 2",
			env:        map[string]interface{}{},
			want:       3,
			wantErr:    false,
		},
		{
			name:       "variable access",
			expression: "x + y",
			env:        map[string]interface{}{"x": 10, "y": 5},
			want:       15,
			wantErr:    false,
		},
		{
			name:       "comparison",
			expression: "score > 0.8",
			env:        map[string]interface{}{"score": 0.9},
			want:       true,
			wantErr:    false,
		},
		{
			name:       "nested map access",
			expression: "inputs.node1.result",
			env: map[string]interface{}{
				"inputs": map[string]interface{}{
					"node1": map[string]interface{}{
						"result": "success",
					},
				},
			},
			want:    "success",
			wantErr: false,
		},
		{
			name:       "string concatenation",
			expression: `name + " World"`,
			env:        map[string]interface{}{"name": "Hello"},
			want:       "Hello World",
			wantErr:    false,
		},
		{
			name:       "array length",
			expression: "len(items)",
			env:        map[string]interface{}{"items": []interface{}{1, 2, 3}},
			want:       3,
			wantErr:    false,
		},
		{
			name:       "ternary operator",
			expression: "enabled ? 'on' : 'off'",
			env:        map[string]interface{}{"enabled": true},
			want:       "on",
			wantErr:    false,
		},
		{
			name:       "complex condition",
			expression: "status == 'complete' && retries < 3",
			env:        map[string]interface{}{"status": "complete", "retries": 1},
			want:       true,
			wantErr:    false,
		},
		{
			name:       "invalid expression",
			expression: "invalid syntax !!!",
			env:        map[string]interface{}{},
			want:       nil,
			wantErr:    true,
		},
		{
			name:       "undefined variable",
			expression: "undefined_var",
			env:        map[string]interface{}{},
			want:       nil,
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := eval.Evaluate(tt.expression, tt.env)
			if (err != nil) != tt.wantErr {
				t.Errorf("Evaluate() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("Evaluate() = %v (%T), want %v (%T)", got, got, tt.want, tt.want)
			}
		})
	}
}

func TestExprEvaluator_EvaluateBool(t *testing.T) {
	eval := NewExprEvaluator()

	tests := []struct {
		name       string
		expression string
		env        map[string]interface{}
		want       bool
		wantErr    bool
	}{
		{
			name:       "true condition",
			expression: "x > 5",
			env:        map[string]interface{}{"x": 10},
			want:       true,
			wantErr:    false,
		},
		{
			name:       "false condition",
			expression: "x > 5",
			env:        map[string]interface{}{"x": 3},
			want:       false,
			wantErr:    false,
		},
		{
			name:       "boolean variable",
			expression: "enabled",
			env:        map[string]interface{}{"enabled": true},
			want:       true,
			wantErr:    false,
		},
		{
			name:       "int truthy (non-zero)",
			expression: "count",
			env:        map[string]interface{}{"count": 5},
			want:       true,
			wantErr:    false,
		},
		{
			name:       "int falsy (zero)",
			expression: "count",
			env:        map[string]interface{}{"count": 0},
			want:       false,
			wantErr:    false,
		},
		{
			name:       "string truthy (non-empty)",
			expression: "name",
			env:        map[string]interface{}{"name": "test"},
			want:       true,
			wantErr:    false,
		},
		{
			name:       "string falsy (empty)",
			expression: "name",
			env:        map[string]interface{}{"name": ""},
			want:       false,
			wantErr:    false,
		},
		{
			name:       "nil value",
			expression: "value",
			env:        map[string]interface{}{"value": nil},
			want:       false,
			wantErr:    false,
		},
		{
			name:       "float truthy",
			expression: "score",
			env:        map[string]interface{}{"score": 0.5},
			want:       true,
			wantErr:    false,
		},
		{
			name:       "float falsy",
			expression: "score",
			env:        map[string]interface{}{"score": 0.0},
			want:       false,
			wantErr:    false,
		},
		{
			name:       "complex boolean expression",
			expression: "(a && b) || c",
			env:        map[string]interface{}{"a": true, "b": false, "c": true},
			want:       true,
			wantErr:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := eval.EvaluateBool(tt.expression, tt.env)
			if (err != nil) != tt.wantErr {
				t.Errorf("EvaluateBool() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("EvaluateBool() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestExprEvaluator_EvaluateString(t *testing.T) {
	eval := NewExprEvaluator()

	tests := []struct {
		name       string
		expression string
		env        map[string]interface{}
		want       string
		wantErr    bool
	}{
		{
			name:       "string variable",
			expression: "name",
			env:        map[string]interface{}{"name": "test"},
			want:       "test",
			wantErr:    false,
		},
		{
			name:       "int to string",
			expression: "count",
			env:        map[string]interface{}{"count": 42},
			want:       "42",
			wantErr:    false,
		},
		{
			name:       "float to string",
			expression: "score",
			env:        map[string]interface{}{"score": 3.14},
			want:       "3.14",
			wantErr:    false,
		},
		{
			name:       "bool to string",
			expression: "enabled",
			env:        map[string]interface{}{"enabled": true},
			want:       "true",
			wantErr:    false,
		},
		{
			name:       "string concatenation",
			expression: `prefix + "_" + suffix`,
			env:        map[string]interface{}{"prefix": "hello", "suffix": "world"},
			want:       "hello_world",
			wantErr:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := eval.EvaluateString(tt.expression, tt.env)
			if (err != nil) != tt.wantErr {
				t.Errorf("EvaluateString() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && got != tt.want {
				t.Errorf("EvaluateString() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestExprEvaluator_EvaluateSlice(t *testing.T) {
	eval := NewExprEvaluator()

	tests := []struct {
		name       string
		expression string
		env        map[string]interface{}
		wantLen    int
		wantErr    bool
	}{
		{
			name:       "interface slice",
			expression: "items",
			env:        map[string]interface{}{"items": []interface{}{1, 2, 3}},
			wantLen:    3,
			wantErr:    false,
		},
		{
			name:       "string slice",
			expression: "names",
			env:        map[string]interface{}{"names": []string{"a", "b", "c"}},
			wantLen:    3,
			wantErr:    false,
		},
		{
			name:       "int slice",
			expression: "numbers",
			env:        map[string]interface{}{"numbers": []int{1, 2, 3, 4}},
			wantLen:    4,
			wantErr:    false,
		},
		{
			name:       "float64 slice",
			expression: "scores",
			env:        map[string]interface{}{"scores": []float64{1.1, 2.2}},
			wantLen:    2,
			wantErr:    false,
		},
		{
			name:       "map slice",
			expression: "objects",
			env: map[string]interface{}{
				"objects": []map[string]interface{}{
					{"id": 1},
					{"id": 2},
				},
			},
			wantLen: 2,
			wantErr: false,
		},
		{
			name:       "nil value",
			expression: "items",
			env:        map[string]interface{}{"items": nil},
			wantLen:    0,
			wantErr:    false,
		},
		{
			name:       "empty slice",
			expression: "items",
			env:        map[string]interface{}{"items": []interface{}{}},
			wantLen:    0,
			wantErr:    false,
		},
		{
			name:       "non-slice value",
			expression: "value",
			env:        map[string]interface{}{"value": "not a slice"},
			wantLen:    0,
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := eval.EvaluateSlice(tt.expression, tt.env)
			if (err != nil) != tt.wantErr {
				t.Errorf("EvaluateSlice() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && len(got) != tt.wantLen {
				t.Errorf("EvaluateSlice() len = %v, want %v", len(got), tt.wantLen)
			}
		})
	}
}

func TestExprEvaluator_Caching(t *testing.T) {
	eval := NewExprEvaluator()

	// First evaluation should compile
	result1, err := eval.Evaluate("x + 1", map[string]interface{}{"x": 5})
	if err != nil {
		t.Fatalf("First evaluation failed: %v", err)
	}
	if result1 != 6 {
		t.Errorf("First result = %v, want 6", result1)
	}

	// Second evaluation with same expression should use cache
	result2, err := eval.Evaluate("x + 1", map[string]interface{}{"x": 10})
	if err != nil {
		t.Fatalf("Second evaluation failed: %v", err)
	}
	if result2 != 11 {
		t.Errorf("Second result = %v, want 11", result2)
	}

	// Verify cache has the expression
	eval.mu.RLock()
	_, cached := eval.compiled["x + 1"]
	eval.mu.RUnlock()

	if !cached {
		t.Error("Expression should be cached")
	}
}

func TestExprEvaluator_MaxLength(t *testing.T) {
	eval := NewExprEvaluator()
	eval.MaxExpressionLength = 10

	// Short expression should work
	_, err := eval.Evaluate("1 + 2", map[string]interface{}{})
	if err != nil {
		t.Errorf("Short expression should not error: %v", err)
	}

	// Long expression should fail
	_, err = eval.Evaluate("this_is_a_very_long_expression_that_exceeds_limit", map[string]interface{}{})
	if err == nil {
		t.Error("Long expression should return error")
	}
}

func TestBuildEnvironment(t *testing.T) {
	nodeOutputs := map[string]map[string]interface{}{
		"node1": {"result": "success", "count": 10},
		"node2": {"data": []interface{}{1, 2, 3}},
	}

	contextVars := map[string]interface{}{
		"run_id":    "run-123",
		"iteration": 5,
	}

	env := BuildEnvironment(nodeOutputs, contextVars)

	// Check inputs structure
	inputs, ok := env["inputs"].(map[string]map[string]interface{})
	if !ok {
		t.Fatal("inputs should be map[string]map[string]interface{}")
	}
	if inputs["node1"]["result"] != "success" {
		t.Error("inputs.node1.result should be 'success'")
	}

	// Check context structure
	ctx, ok := env["context"].(map[string]interface{})
	if !ok {
		t.Fatal("context should be map[string]interface{}")
	}
	if ctx["run_id"] != "run-123" {
		t.Error("context.run_id should be 'run-123'")
	}

	// Check top-level context vars
	if env["run_id"] != "run-123" {
		t.Error("run_id should be available at top level")
	}
	if env["iteration"] != 5 {
		t.Error("iteration should be available at top level")
	}
}

func TestBuildEnvironment_NilInputs(t *testing.T) {
	env := BuildEnvironment(nil, nil)

	// Should have empty inputs and context
	if _, ok := env["inputs"]; !ok {
		t.Error("inputs should exist even when nil")
	}
	if _, ok := env["context"]; !ok {
		t.Error("context should exist even when nil")
	}
}
