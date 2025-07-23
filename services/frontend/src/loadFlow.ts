import { Flow } from './types/graph';

export async function loadFlow(id: string): Promise<Flow> {
  // For now, return a hardcoded example flow
  const exampleFlow: Flow = {
    apiVersion: "v1",
    kind: "Flow",
    meta: {
      id: "example-flow",
      name: "Example Flow",
      version: "1.0.0",
      createdAt: new Date().toISOString(),
    },
    graph: {
      nodes: [
        { id: "start", type: "input", position: { x: 0, y: 0 }, params: { label: "Start Node" } },
        { id: "process", type: "default", position: { x: 200, y: 100 }, params: { label: "Process Data" } },
        { id: "end", type: "output", position: { x: 400, y: 200 }, params: { label: "End Node" } },
      ],
      edges: [
        { from: "start", to: "process" },
        { from: "process", to: "end" },
      ],
    },
  };
  return exampleFlow;
}
