import { Node, Edge } from "reactflow";
import { v4 as uuidv4 } from "uuid";

export interface LoomWorkflowConfig {
  name: string;
  description: string;
  namespace?: string;
}

/**
 * Converts a MentatLab flow graph (ReactFlow nodes/edges) into a Loom Workflow definition.
 */
export function exportFlowToLoom(
  config: LoomWorkflowConfig,
  nodes: Node[],
  edges: Edge[],
): Record<string, any> {
  const steps: any[] = [];

  // Build a lookup for which nodes depend on which
  const deps: Record<string, string[]> = {};
  for (const e of edges) {
    if (!deps[e.target]) {
      deps[e.target] = [];
    }
    deps[e.target].push(e.source);
  }

  for (const n of nodes) {
    const stepDeps = deps[n.id] || [];

    // Map node types. MentatLab node types -> Loom step types.
    // By default, loom assumes 'tool' step_type, unless specified as 'approval', 'gate', 'parallel', etc.
    let stepType = "tool";
    let toolName = n.data?.tool_name || n.type;
    let toolArgs = n.data?.tool_args || {};
    let requiresApproval = false;
    let condition = "";

    if (n.type === "gate" || n.type === "approval") {
      stepType = "gate";
      requiresApproval = true;
    } else if (n.type === "conditional" || n.type === "router") {
      stepType = "gate";
      condition = n.data?.expression || "";
    } else if (n.type === "chat" || n.type === "llm") {
      toolName = "llm_completion";
    }

    const step: any = {
      id: n.id,
      name: n.data?.label || `${toolName} step`,
      description: n.data?.description || "",
      step_type: stepType,
      tool_name: toolName !== "tool" ? toolName : undefined,
      tool_args: toolArgs,
      depends_on: stepDeps.length > 0 ? stepDeps : undefined,
    };

    if (requiresApproval) {
      step.requires_approval = true;
      step.approval_message =
        n.data?.approval_message || "Approval required to proceed.";
    }
    if (condition) {
      step.condition = condition;
    }

    steps.push(step);
  }

  return {
    name: config.name,
    description: config.description,
    namespace: config.namespace || "mentatlab/export",
    steps,
  };
}

/**
 * Converts a Loom Workflow definition into a MentatLab flow graph (ReactFlow nodes/edges).
 */
export function importLoomToFlow(workflowData: any): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const steps = workflowData.steps || [];

  // Basic layout positioning
  let x = 100;
  let y = 100;

  for (const step of steps) {
    const stepId = step.id || uuidv4();

    // Reverse map step types
    let nodeType = "tool";
    if (
      step.step_type === "approval" ||
      step.step_type === "gate" ||
      step.requires_approval
    ) {
      nodeType = "gate";
    } else if (
      step.tool_name === "llm_completion" ||
      step.tool_name === "chat"
    ) {
      nodeType = "chat";
    } else if (step.tool_name) {
      nodeType = "tool";
    } else {
      nodeType = "default";
    }

    nodes.push({
      id: stepId,
      type: nodeType,
      position: { x, y: y },
      data: {
        label: step.name || stepId,
        description: step.description || "",
        tool_name: step.tool_name,
        tool_args: step.tool_args || {},
        approval_message: step.approval_message,
      },
    });

    // Handle dependencies -> edges
    const deps = step.depends_on || [];
    for (const dep of deps) {
      edges.push({
        id: `e-${dep}-${stepId}`,
        source: dep,
        target: stepId,
      });
    }

    // Bump positions for a very naive layout (users usually re-layout manually or we can add elkjs later)
    x += 250;
    if (x > 1000) {
      x = 100;
      y += 150;
    }
  }

  return { nodes, edges };
}
