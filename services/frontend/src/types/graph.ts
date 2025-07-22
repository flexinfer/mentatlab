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
