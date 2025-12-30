// Package validator provides JSON schema validation for agent manifests and plans.
package validator

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v5"
)

// Validator validates agent manifests and execution plans.
type Validator struct {
	manifestSchema *jsonschema.Schema
	planSchema     *jsonschema.Schema
}

// ValidationError represents a validation failure.
type ValidationError struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// ValidationResult holds the result of a validation.
type ValidationResult struct {
	Valid  bool              `json:"valid"`
	Errors []ValidationError `json:"errors,omitempty"`
}

// New creates a new validator with embedded schemas.
func New() (*Validator, error) {
	compiler := jsonschema.NewCompiler()
	compiler.Draft = jsonschema.Draft2020

	// Register the manifest schema
	if err := compiler.AddResource("manifest.json", strings.NewReader(manifestSchemaJSON)); err != nil {
		return nil, fmt.Errorf("add manifest schema: %w", err)
	}

	// Register the plan schema
	if err := compiler.AddResource("plan.json", strings.NewReader(planSchemaJSON)); err != nil {
		return nil, fmt.Errorf("add plan schema: %w", err)
	}

	manifestSchema, err := compiler.Compile("manifest.json")
	if err != nil {
		return nil, fmt.Errorf("compile manifest schema: %w", err)
	}

	planSchema, err := compiler.Compile("plan.json")
	if err != nil {
		return nil, fmt.Errorf("compile plan schema: %w", err)
	}

	return &Validator{
		manifestSchema: manifestSchema,
		planSchema:     planSchema,
	}, nil
}

// ValidateManifest validates an agent manifest.
func (v *Validator) ValidateManifest(manifest map[string]interface{}) *ValidationResult {
	return v.validate(v.manifestSchema, manifest)
}

// ValidatePlan validates an execution plan.
func (v *Validator) ValidatePlan(plan map[string]interface{}) *ValidationResult {
	return v.validate(v.planSchema, plan)
}

// ValidateManifestJSON validates a JSON-encoded manifest.
func (v *Validator) ValidateManifestJSON(data []byte) *ValidationResult {
	var manifest map[string]interface{}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return &ValidationResult{
			Valid: false,
			Errors: []ValidationError{
				{Path: "$", Message: fmt.Sprintf("invalid JSON: %v", err)},
			},
		}
	}
	return v.ValidateManifest(manifest)
}

// ValidatePlanJSON validates a JSON-encoded plan.
func (v *Validator) ValidatePlanJSON(data []byte) *ValidationResult {
	var plan map[string]interface{}
	if err := json.Unmarshal(data, &plan); err != nil {
		return &ValidationResult{
			Valid: false,
			Errors: []ValidationError{
				{Path: "$", Message: fmt.Sprintf("invalid JSON: %v", err)},
			},
		}
	}
	return v.ValidatePlan(plan)
}

// validate runs schema validation and converts errors.
func (v *Validator) validate(schema *jsonschema.Schema, data interface{}) *ValidationResult {
	err := schema.Validate(data)
	if err == nil {
		return &ValidationResult{Valid: true}
	}

	result := &ValidationResult{Valid: false}

	// Convert validation errors
	if verr, ok := err.(*jsonschema.ValidationError); ok {
		result.Errors = extractErrors(verr)
	} else {
		result.Errors = []ValidationError{
			{Path: "$", Message: err.Error()},
		}
	}

	return result
}

// extractErrors recursively extracts validation errors.
func extractErrors(verr *jsonschema.ValidationError) []ValidationError {
	var errors []ValidationError

	if verr.Message != "" {
		errors = append(errors, ValidationError{
			Path:    verr.InstanceLocation,
			Message: verr.Message,
		})
	}

	for _, cause := range verr.Causes {
		errors = append(errors, extractErrors(cause)...)
	}

	return errors
}

// Embedded JSON schemas

const manifestSchemaJSON = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "manifest.json",
  "title": "Agent Manifest",
  "description": "Schema for MentatLab agent manifests",
  "type": "object",
  "required": ["id", "name", "version"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9._-]*$",
      "description": "Unique agent identifier"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "description": "Human-readable agent name"
    },
    "version": {
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+",
      "description": "Semantic version"
    },
    "description": {
      "type": "string",
      "description": "Agent description"
    },
    "image": {
      "type": "string",
      "description": "Container image reference"
    },
    "command": {
      "type": "array",
      "items": {"type": "string"},
      "description": "Command and arguments"
    },
    "env": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name": {"type": "string"},
          "value": {"type": "string"},
          "valueFrom": {
            "type": "object",
            "properties": {
              "secretKeyRef": {
                "type": "object",
                "properties": {
                  "name": {"type": "string"},
                  "key": {"type": "string"}
                }
              },
              "configMapKeyRef": {
                "type": "object",
                "properties": {
                  "name": {"type": "string"},
                  "key": {"type": "string"}
                }
              }
            }
          }
        }
      },
      "description": "Environment variables"
    },
    "resources": {
      "type": "object",
      "properties": {
        "limits": {
          "type": "object",
          "properties": {
            "cpu": {"type": "string"},
            "memory": {"type": "string"},
            "nvidia.com/gpu": {"type": ["string", "integer"]}
          }
        },
        "requests": {
          "type": "object",
          "properties": {
            "cpu": {"type": "string"},
            "memory": {"type": "string"}
          }
        }
      },
      "description": "Resource requirements"
    },
    "inputs": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "type"],
        "properties": {
          "name": {"type": "string"},
          "type": {"type": "string", "enum": ["text", "json", "file", "stream"]},
          "required": {"type": "boolean"},
          "description": {"type": "string"}
        }
      },
      "description": "Input specifications"
    },
    "outputs": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "type"],
        "properties": {
          "name": {"type": "string"},
          "type": {"type": "string", "enum": ["text", "json", "file", "stream"]},
          "description": {"type": "string"}
        }
      },
      "description": "Output specifications"
    },
    "pins": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name": {"type": "string"},
          "type": {"type": "string"},
          "direction": {"type": "string", "enum": ["input", "output", "bidirectional"]},
          "description": {"type": "string"}
        }
      },
      "description": "Pin specifications for data flow"
    },
    "metadata": {
      "type": "object",
      "description": "Additional metadata"
    }
  }
}`

const planSchemaJSON = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "plan.json",
  "title": "Execution Plan",
  "description": "Schema for orchestrator execution plans",
  "type": "object",
  "required": ["nodes"],
  "properties": {
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id"],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^[a-zA-Z][a-zA-Z0-9_-]*$",
            "description": "Node identifier"
          },
          "type": {
            "type": "string",
            "description": "Node type (agent, task, etc.)"
          },
          "agent_id": {
            "type": "string",
            "description": "Agent to execute"
          },
          "image": {
            "type": "string",
            "description": "Container image override"
          },
          "command": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Command override"
          },
          "env": {
            "type": "object",
            "additionalProperties": {"type": "string"},
            "description": "Environment variables"
          },
          "inputs": {
            "type": "array",
            "items": {"type": "string"},
            "description": "IDs of nodes this depends on"
          },
          "timeout": {
            "type": "string",
            "pattern": "^[0-9]+(s|m|h)$",
            "description": "Timeout duration"
          },
          "retries": {
            "type": "integer",
            "minimum": 0,
            "maximum": 10,
            "description": "Max retry count"
          }
        }
      },
      "minItems": 1,
      "description": "Nodes in the execution graph"
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["from", "to"],
        "properties": {
          "from": {
            "type": "string",
            "description": "Source node ID"
          },
          "to": {
            "type": "string",
            "description": "Destination node ID"
          }
        }
      },
      "description": "Data flow edges"
    },
    "metadata": {
      "type": "object",
      "description": "Plan metadata"
    }
  }
}`
