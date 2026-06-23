/**
 * Bundled example flows for demo mode.
 * These are loaded when the orchestrator backend returns empty and DEMO_MODE is enabled.
 */

export interface ExampleFlow {
  meta: { id: string; name: string; description: string; createdAt: string };
  graph: {
    nodes: Array<{ id: string; type: string; position: { x: number; y: number }; params?: Record<string, any>; outputs?: Record<string, any> }>;
    edges: Array<{ from: string; to: string }>;
  };
}

export const EXAMPLE_FLOWS: ExampleFlow[] = [
  {
    meta: {
      id: 'demo.echo-flow',
      name: 'Hello Mentat',
      description: 'Simple echo agent flow',
      createdAt: '2026-02-15T00:00:00Z',
    },
    graph: {
      nodes: [
        { id: 'prompt1', type: 'ui.prompt', position: { x: 120, y: 80 }, outputs: { text: 'Hello, Mentat!' } },
        { id: 'echo1', type: 'mentatlab.echo', position: { x: 400, y: 80 }, params: { prompt: 'Echo input' } },
        { id: 'console1', type: 'ui.console', position: { x: 680, y: 80 } },
      ],
      edges: [
        { from: 'prompt1.text', to: 'echo1.text' },
        { from: 'echo1.result', to: 'console1.text' },
      ],
    },
  },
  {
    meta: {
      id: 'demo.conditional-routing',
      name: 'Conditional Routing',
      description: 'Classify input and route to different agents',
      createdAt: '2026-02-15T00:00:00Z',
    },
    graph: {
      nodes: [
        { id: 'classifier', type: 'mentatlab.echo', position: { x: 120, y: 160 }, params: { prompt: 'Classify input' } },
        { id: 'router', type: 'conditional', position: { x: 400, y: 160 }, params: { conditional: { type: 'switch', expression: 'inputs.classifier.result', branches: { technical: { targets: ['tech_agent'] }, creative: { targets: ['creative_agent'] } }, default: 'tech_agent' } } },
        { id: 'tech_agent', type: 'mentatlab.echo', position: { x: 680, y: 80 }, params: { prompt: 'Technical processing' } },
        { id: 'creative_agent', type: 'mentatlab.echo', position: { x: 680, y: 240 }, params: { prompt: 'Creative processing' } },
      ],
      edges: [
        { from: 'classifier.result', to: 'router.input' },
        { from: 'router.output', to: 'tech_agent.text' },
        { from: 'router.output', to: 'creative_agent.text' },
      ],
    },
  },
  {
    meta: {
      id: 'demo.foreach-batch',
      name: 'Batch Processing',
      description: 'Process items in parallel using ForEach',
      createdAt: '2026-02-15T00:00:00Z',
    },
    graph: {
      nodes: [
        { id: 'source', type: 'mentatlab.echo', position: { x: 120, y: 160 }, outputs: { items: ['doc-1', 'doc-2', 'doc-3'] } },
        { id: 'loop', type: 'for_each', position: { x: 400, y: 160 }, params: { for_each: { collection: 'inputs.source.items', item_var: 'doc', max_parallel: 2, body: ['process'] } } },
        { id: 'process', type: 'mentatlab.echo', position: { x: 680, y: 160 }, params: { prompt: 'Process document' } },
        { id: 'aggregate', type: 'mentatlab.echo', position: { x: 960, y: 160 }, params: { prompt: 'Aggregate results' } },
      ],
      edges: [
        { from: 'source.items', to: 'loop.input' },
        { from: 'loop.output', to: 'aggregate.text' },
      ],
    },
  },
  {
    meta: {
      id: 'demo.data-pipeline',
      name: 'Data Pipeline',
      description: 'Multi-stage pipeline with parallel enrichment',
      createdAt: '2026-02-15T00:00:00Z',
    },
    graph: {
      nodes: [
        { id: 'ingest', type: 'mentatlab.echo', position: { x: 120, y: 80 }, params: { prompt: 'Ingest data' } },
        { id: 'validate', type: 'mentatlab.echo', position: { x: 400, y: 80 }, params: { prompt: 'Validate schema' } },
        { id: 'enrich', type: 'mentatlab.echo', position: { x: 400, y: 240 }, params: { prompt: 'Enrich metadata' } },
        { id: 'transform', type: 'mentatlab.echo', position: { x: 680, y: 160 }, params: { prompt: 'Transform and merge' } },
        { id: 'output', type: 'mentatlab.echo', position: { x: 960, y: 160 }, params: { prompt: 'Write output' } },
      ],
      edges: [
        { from: 'ingest.result', to: 'validate.text' },
        { from: 'ingest.result', to: 'enrich.text' },
        { from: 'validate.result', to: 'transform.text' },
        { from: 'enrich.result', to: 'transform.text' },
        { from: 'transform.result', to: 'output.text' },
      ],
    },
  },
];
