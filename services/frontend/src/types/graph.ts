export interface NodeIO {
  name: string;
  type: string;
}

export interface AgentSpec {
  id: string;
  version: string;
  image: string;
  runtime: string;
  description?: string;
  inputs?: NodeIO[];
  outputs?: NodeIO[];
  longRunning?: boolean;
  ui?: Record<string, unknown>;
}

export interface ToolSpec {
  id: string;
  description?: string;
  inputs?: NodeIO[];
  outputs?: NodeIO[];
}

export interface Pin {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "binary";
}

export interface Agent {
  id: string;
  version: string;
  image: string;
  runtime?: string;
  description: string;
  inputs: Pin[];
  outputs: Pin[];
  longRunning?: boolean;
  ui?: {
    remoteEntry?: string;
  };
  resources?: {
    gpu?: boolean;
  };
  env?: string[];
}

export interface Position {
  x?: number;
  y?: number;
}

export interface Node {
  id: string;
  type: string;
  position: Position;
  outputs?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

export interface Edge {
  from: string;
  to: string;
}

export interface FlowMeta {
  id: string;
  name: string;
  version: string;
  description?: string;
  createdBy?: string;
  createdAt: string;
}

export interface FlowGraph {
  nodes: Node[];
  edges: Edge[];
}

export interface FlowLayout {
  zoom?: number;
  viewport?: Position;
}

export interface FlowRunConfig {
  maxTokens?: number;
  temperature?: number;
  secrets?: string[];
}

export interface Flow {
  apiVersion: string;
  kind: "Flow";
  meta: FlowMeta;
  graph: FlowGraph;
  layout?: FlowLayout;
  runConfig?: FlowRunConfig;
}
