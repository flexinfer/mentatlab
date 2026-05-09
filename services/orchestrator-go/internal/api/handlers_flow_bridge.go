package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/gorilla/mux"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/flexinfer/mentatlab/services/orchestrator-go/internal/flowstore"
	"github.com/flexinfer/mentatlab/services/orchestrator-go/pkg/types"
)

type loomWorkflowDefinition struct {
	Name        string             `json:"name"`
	Description string             `json:"description,omitempty"`
	Steps       []loomWorkflowStep `json:"steps"`
}

type loomWorkflowStep struct {
	ID               string         `json:"id,omitempty"`
	Name             string         `json:"name"`
	Description      string         `json:"description,omitempty"`
	DependsOn        []string       `json:"depends_on,omitempty"`
	StepType         string         `json:"step_type,omitempty"`
	RequiresApproval bool           `json:"requires_approval,omitempty"`
	ServerName       string         `json:"server_name,omitempty"`
	ToolName         string         `json:"tool_name,omitempty"`
	ToolArgs         map[string]any `json:"tool_args,omitempty"`
	TimeoutSeconds   int            `json:"timeout_seconds,omitempty"`
}

type flowGraphPayload struct {
	Nodes []map[string]any `json:"nodes"`
	Edges []map[string]any `json:"edges"`
}

type graphNodeWithLabel struct {
	ID   string `json:"id"`
	Data struct {
		Label string `json:"label"`
		Name  string `json:"name"`
		Title string `json:"title"`
	} `json:"data"`
}

type graphWithLabels struct {
	Nodes []graphNodeWithLabel `json:"nodes"`
}

var nonWorkflowIDChars = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

// ImportLoomWorkflow handles POST /api/v1/flows/import/loom
func (h *Handlers) ImportLoomWorkflow(w http.ResponseWriter, r *http.Request) {
	ctx, span := apiTracer.Start(r.Context(), "api.ImportLoomWorkflow")
	defer span.End()

	if h.flowStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "flow store not available", errors.New("flow store not configured"))
		return
	}

	var wf loomWorkflowDefinition
	if err := json.NewDecoder(r.Body).Decode(&wf); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid request body", err)
		return
	}

	graph, err := workflowToFlowGraph(wf)
	if err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid loom workflow definition", err)
		return
	}

	graphRaw, err := json.Marshal(graph)
	if err != nil {
		h.respondError(w, r, http.StatusInternalServerError, "failed to serialize graph", err)
		return
	}
	if err := validateFlowGraph(graphRaw); err != nil {
		h.respondError(w, r, http.StatusBadRequest, "invalid loom workflow definition", err)
		return
	}

	name := strings.TrimSpace(wf.Name)
	if name == "" {
		name = "Imported Loom Workflow"
	}

	createReq := &flowstore.CreateFlowRequest{
		Name:        name,
		Description: wf.Description,
		Graph:       graphRaw,
		Metadata: map[string]any{
			"import_source":   "loom_workflow",
			"loom_step_count": len(wf.Steps),
		},
		CreatedBy: getOwnerFromRequest(r),
	}

	flow, err := h.flowStore.Create(ctx, createReq)
	if err != nil {
		if errors.Is(err, flowstore.ErrFlowExists) {
			h.respondError(w, r, http.StatusConflict, "flow already exists", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to create flow from workflow", err)
		return
	}

	h.respondJSON(w, http.StatusCreated, flow)
}

// ExportFlowAsLoomWorkflow handles GET /api/v1/flows/{id}/export/loom
func (h *Handlers) ExportFlowAsLoomWorkflow(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	flowID := vars["id"]

	ctx, span := apiTracer.Start(r.Context(), "api.ExportFlowAsLoomWorkflow",
		trace.WithAttributes(attribute.String("flow_id", flowID)),
	)
	defer span.End()

	if h.flowStore == nil {
		h.respondError(w, r, http.StatusServiceUnavailable, "flow store not available", errors.New("flow store not configured"))
		return
	}

	flow, err := h.flowStore.Get(ctx, flowID)
	if err != nil {
		if errors.Is(err, flowstore.ErrFlowNotFound) {
			h.respondError(w, r, http.StatusNotFound, "flow not found", err)
			return
		}
		h.respondError(w, r, http.StatusInternalServerError, "failed to get flow", err)
		return
	}

	plan, err := flowGraphToPlan(flow.Graph)
	if err != nil {
		h.respondError(w, r, http.StatusBadRequest, "failed to parse flow graph", err)
		return
	}

	labels := extractNodeLabels(flow.Graph)
	wf := planToWorkflowDefinition(flow.Name, flow.Description, plan, labels)
	h.respondJSON(w, http.StatusOK, wf)
}

func workflowToFlowGraph(wf loomWorkflowDefinition) (*flowGraphPayload, error) {
	if len(wf.Steps) == 0 {
		return nil, errors.New("workflow must include at least one step")
	}

	type resolvedStep struct {
		id   string
		step loomWorkflowStep
	}

	used := make(map[string]struct{}, len(wf.Steps))
	identifierToID := make(map[string]string, len(wf.Steps)*2)
	resolved := make([]resolvedStep, 0, len(wf.Steps))

	for i, step := range wf.Steps {
		stepID := strings.TrimSpace(step.ID)
		if stepID == "" {
			base := sanitizeWorkflowID(step.Name)
			if base == "" {
				base = "step-" + strconv.Itoa(i+1)
			}
			stepID = base
		}
		stepID = dedupeWorkflowID(stepID, used)

		if origID := strings.TrimSpace(step.ID); origID != "" {
			identifierToID[origID] = stepID
		}
		if name := strings.TrimSpace(step.Name); name != "" {
			if _, exists := identifierToID[name]; !exists {
				identifierToID[name] = stepID
			}
		}
		identifierToID[stepID] = stepID

		resolved = append(resolved, resolvedStep{id: stepID, step: step})
	}

	nodes := make([]map[string]any, 0, len(resolved))
	edges := make([]map[string]any, 0, len(resolved))
	edgeSeen := make(map[string]struct{})

	for i, rs := range resolved {
		step := rs.step
		label := strings.TrimSpace(step.Name)
		if label == "" {
			label = rs.id
		}

		data := map[string]any{"label": label}
		nodeType := "agent"

		if step.StepType != "" {
			data["step_type"] = step.StepType
		}
		if step.RequiresApproval {
			data["requires_approval"] = true
		}
		if step.TimeoutSeconds > 0 {
			data["timeout"] = fmt.Sprintf("%ds", step.TimeoutSeconds)
		}
		if step.ToolName != "" {
			data["agent_id"] = "loom-mcp-executor"
			data["tool_name"] = step.ToolName
			if len(step.ToolArgs) > 0 {
				data["tool_args"] = step.ToolArgs
			}
			serverName := step.ServerName
			if serverName == "" && strings.Contains(step.ToolName, "__") {
				parts := strings.SplitN(step.ToolName, "__", 2)
				serverName = parts[0]
			}
			if serverName != "" {
				data["mcp_server"] = serverName
			}
			nodeType = "mcp:" + step.ToolName
		}

		nodes = append(nodes, map[string]any{
			"id":   rs.id,
			"type": nodeType,
			"position": map[string]float64{
				"x": float64((i % 4) * 280),
				"y": float64((i / 4) * 180),
			},
			"data": data,
		})

		for _, dep := range step.DependsOn {
			dep = strings.TrimSpace(dep)
			if dep == "" {
				continue
			}
			fromID, ok := identifierToID[dep]
			if !ok {
				return nil, fmt.Errorf("step %q depends on unknown step %q", rs.id, dep)
			}
			edgeID := fmt.Sprintf("e-%s-%s", fromID, rs.id)
			if _, exists := edgeSeen[edgeID]; exists {
				continue
			}
			edgeSeen[edgeID] = struct{}{}
			edges = append(edges, map[string]any{
				"id":     edgeID,
				"source": fromID,
				"target": rs.id,
			})
		}
	}

	return &flowGraphPayload{Nodes: nodes, Edges: edges}, nil
}

func planToWorkflowDefinition(name, description string, plan *types.Plan, labels map[string]string) loomWorkflowDefinition {
	dependsOn := buildDependsOn(plan.Nodes, plan.Edges)
	steps := make([]loomWorkflowStep, 0, len(plan.Nodes))

	for _, node := range plan.Nodes {
		stepName := labels[node.ID]
		if stepName == "" {
			stepName = node.ID
		}

		step := loomWorkflowStep{
			ID:        node.ID,
			Name:      stepName,
			DependsOn: dependsOn[node.ID],
		}
		if node.Timeout > 0 {
			step.TimeoutSeconds = int(node.Timeout.Seconds())
		}
		if node.Gate != nil {
			step.StepType = "gate"
			step.RequiresApproval = true
		} else {
			step.StepType = "tool"
		}

		spec := parseInputSpec(node.Env)
		if toolName, _ := spec["tool_name"].(string); toolName != "" {
			step.ToolName = toolName
		}
		if serverName, _ := spec["mcp_server"].(string); serverName != "" {
			step.ServerName = serverName
		}
		if toolArgs, ok := spec["tool_args"].(map[string]any); ok && len(toolArgs) > 0 {
			step.ToolArgs = toolArgs
		}
		if step.ToolName == "" && strings.HasPrefix(node.Type, "mcp:") {
			step.ToolName = strings.TrimPrefix(node.Type, "mcp:")
		}
		steps = append(steps, step)
	}

	return loomWorkflowDefinition{
		Name:        name,
		Description: description,
		Steps:       steps,
	}
}

func buildDependsOn(nodes []types.NodeSpec, edges []types.EdgeSpec) map[string][]string {
	deps := make(map[string][]string, len(nodes))
	seen := make(map[string]map[string]struct{}, len(nodes))

	for _, node := range nodes {
		deps[node.ID] = []string{}
		seen[node.ID] = make(map[string]struct{})
	}

	for _, edge := range edges {
		if edge.To == "" || edge.From == "" {
			continue
		}
		if _, ok := seen[edge.To][edge.From]; ok {
			continue
		}
		seen[edge.To][edge.From] = struct{}{}
		deps[edge.To] = append(deps[edge.To], edge.From)
	}

	for _, node := range nodes {
		for _, input := range node.Inputs {
			if input == "" {
				continue
			}
			if _, ok := seen[node.ID][input]; ok {
				continue
			}
			seen[node.ID][input] = struct{}{}
			deps[node.ID] = append(deps[node.ID], input)
		}
	}

	for id := range deps {
		sort.Strings(deps[id])
	}
	return deps
}

func parseInputSpec(env map[string]string) map[string]any {
	if env == nil {
		return map[string]any{}
	}
	raw := strings.TrimSpace(env["INPUT_SPEC"])
	if raw == "" {
		return map[string]any{}
	}
	var spec map[string]any
	if err := json.Unmarshal([]byte(raw), &spec); err != nil {
		return map[string]any{}
	}
	return spec
}

func extractNodeLabels(graph json.RawMessage) map[string]string {
	labels := map[string]string{}
	var parsed graphWithLabels
	if err := json.Unmarshal(graph, &parsed); err != nil {
		return labels
	}
	for _, node := range parsed.Nodes {
		label := strings.TrimSpace(node.Data.Label)
		if label == "" {
			label = strings.TrimSpace(node.Data.Name)
		}
		if label == "" {
			label = strings.TrimSpace(node.Data.Title)
		}
		if label != "" && node.ID != "" {
			labels[node.ID] = label
		}
	}
	return labels
}

func sanitizeWorkflowID(value string) string {
	s := strings.TrimSpace(value)
	if s == "" {
		return ""
	}
	s = strings.ToLower(s)
	s = strings.ReplaceAll(s, " ", "-")
	s = nonWorkflowIDChars.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	return s
}

func dedupeWorkflowID(base string, used map[string]struct{}) string {
	if _, exists := used[base]; !exists {
		used[base] = struct{}{}
		return base
	}
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s-%d", base, i)
		if _, exists := used[candidate]; !exists {
			used[candidate] = struct{}{}
			return candidate
		}
	}
}
