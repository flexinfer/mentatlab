package registry

import (
	"encoding/json"
	"time"
)

const (
	defaultEchoAgentImage       = "registry.harbor.lan/library/mentatlab-echoagent:latest"
	defaultPsycheSimAgentImage  = "registry.harbor.lan/library/mentatlab-psyche-sim:latest"
	defaultCTMCogPackAgentImage = "registry.harbor.lan/library/mentatlab-ctm-cogpack:latest"
	defaultMCPExecutorImage     = "registry.harbor.lan/library/mentatlab-loom-mcp-executor:v0.2.0-dev"
	defaultFlexInferAgentImage  = "registry.harbor.lan/library/mentatlab-flexinfer-adapter:v0.1.0-dev"
)

func defaultAgents(now time.Time) []*Agent {
	return []*Agent{
		{
			ID:           "mentatlab.echo",
			Name:         "Echo Agent",
			Version:      "1.0.0",
			Description:  "Simple echo agent for testing",
			Image:        defaultEchoAgentImage,
			Command:      []string{"python", "agents/echo/main.py"},
			Capabilities: []string{"echo", "test"},
			CapabilitySpec: &CapabilitySpec{
				Inputs:  []PinSpec{{Name: "spec", Type: "json"}, {Name: "context", Type: "json"}},
				Outputs: []PinSpec{{Name: "result", Type: "json"}},
			},
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:           "mentatlab.psyche-sim",
			Name:         "Psyche Simulation",
			Version:      "1.0.0",
			Description:  "Psychological simulation agent",
			Image:        defaultPsycheSimAgentImage,
			Command:      []string{"python", "agents/psyche-sim/main.py"},
			Capabilities: []string{"simulation", "psychology"},
			CapabilitySpec: &CapabilitySpec{
				Inputs:  []PinSpec{{Name: "spec", Type: "json"}, {Name: "context", Type: "json"}},
				Outputs: []PinSpec{{Name: "result", Type: "json"}, {Name: "mentat_meta", Type: "json"}},
			},
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:           "mentatlab.ctm-cogpack",
			Name:         "CTM CogPack",
			Version:      "1.0.0",
			Description:  "Cognitive task modeling package",
			Image:        defaultCTMCogPackAgentImage,
			Command:      []string{"python", "agents/ctm-cogpack/main.py"},
			Capabilities: []string{"cognitive", "modeling"},
			CapabilitySpec: &CapabilitySpec{
				Inputs:  []PinSpec{{Name: "spec", Type: "json"}, {Name: "context", Type: "json"}},
				Outputs: []PinSpec{{Name: "output", Type: "stream"}, {Name: "stats", Type: "json"}},
			},
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:           "loom-mcp-executor",
			Name:         "Loom MCP Executor",
			Version:      "1.0.0",
			Description:  "Executes MCP tools through loom-core and emits output payloads",
			Image:        defaultMCPExecutorImage,
			Command:      []string{"python", "agents/loom-mcp-executor/main.py"},
			Capabilities: []string{"mcp", "integration", "tools"},
			CapabilitySpec: &CapabilitySpec{
				Inputs:  []PinSpec{{Name: "spec", Type: "json", Description: "MCP tool call specification"}},
				Outputs: []PinSpec{{Name: "result", Type: "json"}},
				Actions: []string{"call_tool"},
			},
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:           "mentatlab.flexinfer-adapter",
			Name:         "FlexInfer Adapter",
			Version:      "0.1.0",
			Description:  "Lifecycle-aware adapter for FlexInfer model inference, activation, and scaling",
			Image:        defaultFlexInferAgentImage,
			Command:      []string{"python", "agents/flexinfer-adapter/main.py"},
			Capabilities: []string{"inference", "flexinfer", "llm", "image-generation"},
			CapabilitySpec: &CapabilitySpec{
				Inputs:  []PinSpec{{Name: "spec", Type: "json", Description: "Action spec: model, action, params"}},
				Outputs: []PinSpec{{Name: "result", Type: "json"}, {Name: "error", Type: "json"}},
				Actions: []string{"inference", "list", "get", "activate", "scale", "gpu_status"},
			},
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
}

func cloneAgent(agent *Agent) *Agent {
	if agent == nil {
		return nil
	}

	copy := *agent
	copy.Command = cloneStringSlice(agent.Command)
	copy.Capabilities = cloneStringSlice(agent.Capabilities)
	copy.Schema = cloneRawMessage(agent.Schema)
	copy.Metadata = cloneStringMap(agent.Metadata)
	copy.CapabilitySpec = cloneCapabilitySpec(agent.CapabilitySpec)
	return &copy
}

func cloneCapabilitySpec(spec *CapabilitySpec) *CapabilitySpec {
	if spec == nil {
		return nil
	}

	copy := *spec
	copy.Inputs = clonePinSpecs(spec.Inputs)
	copy.Outputs = clonePinSpecs(spec.Outputs)
	copy.Actions = cloneStringSlice(spec.Actions)
	return &copy
}

func clonePinSpecs(pins []PinSpec) []PinSpec {
	if len(pins) == 0 {
		return nil
	}

	out := make([]PinSpec, len(pins))
	copy(out, pins)
	return out
}

func cloneStringSlice(values []string) []string {
	if len(values) == 0 {
		return nil
	}

	out := make([]string, len(values))
	copy(out, values)
	return out
}

func cloneStringMap(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}

	out := make(map[string]string, len(values))
	for k, v := range values {
		out[k] = v
	}
	return out
}

func cloneRawMessage(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return nil
	}

	out := make([]byte, len(raw))
	copy(out, raw)
	return out
}

func mergeDefaultAgentFields(agent, defaults *Agent) bool {
	if agent == nil || defaults == nil {
		return false
	}

	changed := false

	if agent.Name == "" && defaults.Name != "" {
		agent.Name = defaults.Name
		changed = true
	}
	if agent.Version == "" && defaults.Version != "" {
		agent.Version = defaults.Version
		changed = true
	}
	if agent.Image == "" && defaults.Image != "" {
		agent.Image = defaults.Image
		changed = true
	}
	if len(agent.Command) == 0 && len(defaults.Command) > 0 {
		agent.Command = cloneStringSlice(defaults.Command)
		changed = true
	}
	if len(agent.Capabilities) == 0 && len(defaults.Capabilities) > 0 {
		agent.Capabilities = cloneStringSlice(defaults.Capabilities)
		changed = true
	}
	if len(agent.Schema) == 0 && len(defaults.Schema) > 0 {
		agent.Schema = cloneRawMessage(defaults.Schema)
		changed = true
	}
	if agent.Description == "" && defaults.Description != "" {
		agent.Description = defaults.Description
		changed = true
	}
	if agent.Author == "" && defaults.Author != "" {
		agent.Author = defaults.Author
		changed = true
	}
	if len(agent.Metadata) == 0 && len(defaults.Metadata) > 0 {
		agent.Metadata = cloneStringMap(defaults.Metadata)
		changed = true
	}
	if agent.CapabilitySpec == nil && defaults.CapabilitySpec != nil {
		agent.CapabilitySpec = cloneCapabilitySpec(defaults.CapabilitySpec)
		changed = true
	}

	return changed
}
