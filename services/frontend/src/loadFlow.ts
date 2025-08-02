/**
 * @deprecated This function is deprecated. Flow loading is now handled through
 * the streaming service and real-time data flow in the new streaming UI.
 * This function will be removed in a future version.
 *
 * Migration Guide:
 * - Use streamingService for real-time flow data
 * - StreamingPage handles flow loading automatically
 * - The streaming interface provides better real-time flow management
 */

import { Flow } from './types/graph';

/**
 * @deprecated Use streamingService and StreamingPage instead
 */
export async function loadFlow(id: string): Promise<Flow> {
  // Add deprecation warning
  console.warn(
    'loadFlow function is deprecated. Use streamingService and StreamingPage instead. ' +
    'This function will be removed in a future version.'
  );
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
