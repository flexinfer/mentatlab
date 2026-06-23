/**
 * NodePalette - Draggable node catalog for workflow building
 *
 * Displays available nodes organized by category with search filtering.
 * Nodes can be dragged onto the ReactFlow canvas to create new instances.
 *
 * Uses HTML5 Drag and Drop API with a custom transfer format that
 * ReactFlow reads in the onDrop handler.
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { NodeCategory, MediaNodeType } from '@/types/graph';
import { NODE_TYPES } from '@/nodes';
import { Input } from '@/components/ui/Input';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NodeDefinition {
  type: string;
  label: string;
  description: string;
  category: NodeCategory;
  icon?: string;
  groupLabel?: string;
  dragData?: Record<string, unknown>;
}

export interface NodePaletteProps {
  /** Callback when a node is dragged - used for canvas drop handling */
  onNodeDragStart?: (nodeType: string) => void;
  /** Whether the palette is collapsed */
  collapsed?: boolean;
  /** Toggle collapse state */
  onToggleCollapse?: () => void;
  /** Additional CSS class */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Built-in node definitions with categories and descriptions.
 * Extend this array to add more node types.
 */
const NODE_DEFINITIONS: NodeDefinition[] = [
  // Logic nodes
  {
    type: NODE_TYPES.CHAT,
    label: 'Chat',
    description: 'LLM conversation node with prompt input',
    category: NodeCategory.AI,
    icon: '💬',
  },
  {
    type: NODE_TYPES.PYTHON_CODE,
    label: 'Python Code',
    description: 'Execute Python code in a sandbox',
    category: NodeCategory.PROCESSING,
    icon: '🐍',
  },
  {
    type: NODE_TYPES.CONDITIONAL,
    label: 'Conditional',
    description: 'Branch flow based on conditions',
    category: NodeCategory.LOGIC,
    icon: '⑂',
  },
  {
    type: NODE_TYPES.FOR_EACH,
    label: 'For Each',
    description: 'Iterate over a collection',
    category: NodeCategory.LOGIC,
    icon: '🔁',
  },

  // Input nodes
  {
    type: MediaNodeType.MEDIA_UPLOAD,
    label: 'Media Upload',
    description: 'Upload images, audio, or video files',
    category: NodeCategory.INPUT,
    icon: '📤',
  },
  {
    type: MediaNodeType.CAMERA_CAPTURE,
    label: 'Camera',
    description: 'Capture from webcam',
    category: NodeCategory.INPUT,
    icon: '📷',
  },
  {
    type: MediaNodeType.MICROPHONE_CAPTURE,
    label: 'Microphone',
    description: 'Record audio from microphone',
    category: NodeCategory.INPUT,
    icon: '🎤',
  },

  // Processing nodes
  {
    type: MediaNodeType.IMAGE_RESIZE,
    label: 'Image Resize',
    description: 'Resize images to specified dimensions',
    category: NodeCategory.PROCESSING,
    icon: '📐',
  },
  {
    type: MediaNodeType.IMAGE_FILTER,
    label: 'Image Filter',
    description: 'Apply filters and effects to images',
    category: NodeCategory.PROCESSING,
    icon: '🎨',
  },
  {
    type: MediaNodeType.AUDIO_TRANSCODE,
    label: 'Audio Transcode',
    description: 'Convert audio between formats',
    category: NodeCategory.PROCESSING,
    icon: '🔊',
  },

  // AI nodes
  {
    type: MediaNodeType.IMAGE_RECOGNITION,
    label: 'Image Recognition',
    description: 'Classify and tag images',
    category: NodeCategory.AI,
    icon: '👁️',
  },
  {
    type: MediaNodeType.OBJECT_DETECTION,
    label: 'Object Detection',
    description: 'Detect and locate objects in images',
    category: NodeCategory.AI,
    icon: '🎯',
  },
  {
    type: MediaNodeType.SPEECH_TO_TEXT,
    label: 'Speech to Text',
    description: 'Transcribe audio to text',
    category: NodeCategory.AI,
    icon: '🗣️',
  },
  {
    type: MediaNodeType.TEXT_TO_SPEECH,
    label: 'Text to Speech',
    description: 'Convert text to spoken audio',
    category: NodeCategory.AI,
    icon: '📢',
  },
  {
    type: MediaNodeType.OCR,
    label: 'OCR',
    description: 'Extract text from images',
    category: NodeCategory.AI,
    icon: '📝',
  },
  {
    type: MediaNodeType.IMAGE_GENERATION,
    label: 'Image Generation',
    description: 'Generate images from prompts',
    category: NodeCategory.AI,
    icon: '🎭',
  },

  // Output nodes
  {
    type: MediaNodeType.MEDIA_DISPLAY,
    label: 'Media Display',
    description: 'Preview media output',
    category: NodeCategory.OUTPUT,
    icon: '🖥️',
  },
  {
    type: MediaNodeType.MEDIA_DOWNLOAD,
    label: 'Download',
    description: 'Download processed media',
    category: NodeCategory.OUTPUT,
    icon: '💾',
  },
  {
    type: MediaNodeType.WEBHOOK_SENDER,
    label: 'Webhook',
    description: 'Send results to external URL',
    category: NodeCategory.INTEGRATION,
    icon: '🔗',
  },
];

// Category display configuration
const CATEGORY_CONFIG: Record<NodeCategory, { label: string; order: number; color: string }> = {
  [NodeCategory.INPUT]: { label: 'Input', order: 1, color: 'text-green-500' },
  [NodeCategory.OUTPUT]: { label: 'Output', order: 2, color: 'text-blue-500' },
  [NodeCategory.PROCESSING]: { label: 'Processing', order: 3, color: 'text-yellow-500' },
  [NodeCategory.LOGIC]: { label: 'Logic', order: 4, color: 'text-purple-500' },
  [NodeCategory.AI]: { label: 'AI', order: 5, color: 'text-pink-500' },
  [NodeCategory.AI_INFERENCE]: { label: 'AI Inference', order: 5.5, color: 'text-rose-400' },
  [NodeCategory.MEDIA]: { label: 'Media', order: 6, color: 'text-orange-500' },
  [NodeCategory.INTEGRATION]: { label: 'Integration', order: 7, color: 'text-cyan-500' },
  [NodeCategory.UTILITY]: { label: 'Utility', order: 8, color: 'text-gray-500' },
};

type MCPToolRecord = {
  name: string;
  description?: string;
  server?: string;
  inputSchema?: Record<string, unknown>;
};

const FLEXINFER_SERVER = 'flexinfer';
const FLEXINFER_INFERENCE_TOOL = 'flexinfer__inference_chat';
const FLEXINFER_TEMPLATE_GROUP = 'FlexInfer Templates';

function normalizeMCPTools(payload: unknown): MCPToolRecord[] {
  const rawTools = Array.isArray(payload)
    ? payload
    : (payload as { tools?: unknown })?.tools;

  if (!Array.isArray(rawTools)) return [];

  return rawTools
    .filter((tool): tool is Record<string, unknown> => typeof tool === 'object' && tool !== null)
    .map((tool) => ({
      name: String(tool.name ?? tool.id ?? '').trim(),
      description: typeof tool.description === 'string' ? tool.description : undefined,
      server: typeof tool.server === 'string'
        ? tool.server
        : (typeof tool.server_name === 'string' ? tool.server_name : undefined),
      inputSchema: typeof tool.inputSchema === 'object' && tool.inputSchema !== null
        ? (tool.inputSchema as Record<string, unknown>)
        : undefined,
    }))
    .filter((tool) => tool.name.length > 0);
}

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function toolLabel(toolName: string): string {
  const suffix = toolName.includes('__') ? toolName.split('__').pop() ?? toolName : toolName;
  return toTitleCase(suffix);
}

function toolGroupLabel(server?: string): string {
  const normalized = (server ?? 'misc').trim();
  if (normalized.length === 0) return 'MCP · Misc';
  return `MCP · ${toTitleCase(normalized)}`;
}

function toNodeType(toolName: string): string {
  const safe = toolName.toLowerCase().replace(/[^a-z0-9:_-]+/g, '-');
  return `mcp:${safe}`;
}

// FlexInfer tool name prefixes — routed to the dedicated adapter agent
const FLEXINFER_TOOL_PREFIXES = [
  'flexinfer_',
  'flexinfer__',
];

function isFlexInferTool(toolName: string): boolean {
  return FLEXINFER_TOOL_PREFIXES.some((p) => toolName.startsWith(p));
}

function flexInferAction(toolName: string): string {
  const suffix = toolName.replace(/^flexinfer_+/, '');
  const actionMap: Record<string, string> = {
    proxy_models: 'inference',
    list_models: 'list',
    get_model: 'get',
    activate_model: 'activate',
    scale_model: 'scale',
    gpu_status: 'gpu_status',
    list_catalogs: 'list',
  };
  return actionMap[suffix] ?? suffix;
}

function buildMCPToolDragData(tool: MCPToolRecord): Record<string, unknown> {
  // FlexInfer tools use the dedicated adapter agent
  if (isFlexInferTool(tool.name)) {
    return {
      label: toolLabel(tool.name),
      agent_id: 'mentatlab.flexinfer-adapter',
      tool_name: tool.name,
      tool_args: { action: flexInferAction(tool.name) },
      mcp_server: tool.server ?? '',
      inputSchema: tool.inputSchema ?? {},
    };
  }

  return {
    label: toolLabel(tool.name),
    agent_id: 'loom-mcp-executor',
    tool_name: tool.name,
    tool_args: {},
    mcp_server: tool.server ?? '',
    inputSchema: tool.inputSchema ?? {},
  };
}

function hasTool(tools: MCPToolRecord[], name: string): boolean {
  return tools.some((tool) => tool.name === name);
}

function hasFlexInferInventory(tools: MCPToolRecord[]): boolean {
  return tools.some((tool) => {
    const server = (tool.server ?? '').toLowerCase();
    return server === FLEXINFER_SERVER || tool.name.startsWith('flexinfer__');
  });
}

function buildFlexInferTemplateNodes(tools: MCPToolRecord[]): NodeDefinition[] {
  if (!hasFlexInferInventory(tools)) return [];

  const nodes: NodeDefinition[] = [];

  if (hasTool(tools, 'flexinfer__flexinfer_proxy_models')) {
    nodes.push({
      type: 'mcp:flexinfer-template-readiness',
      label: 'FlexInfer Readiness',
      description: 'Check proxy /v1/models to verify inference backend readiness',
      category: NodeCategory.AI,
      icon: '🩺',
      groupLabel: FLEXINFER_TEMPLATE_GROUP,
      dragData: {
        label: 'FlexInfer Readiness',
        agent_id: 'loom-mcp-executor',
        tool_name: 'flexinfer__flexinfer_proxy_models',
        mcp_server: FLEXINFER_SERVER,
        tool_args: {
          proxy_url: '${FLEXINFER_PROXY_URL}',
        },
        runtime_contract: {
          kind: 'flexinfer_readiness',
          required_env: ['FLEXINFER_PROXY_URL'],
        },
      },
    });
  }

  if (hasTool(tools, 'flexinfer__flexinfer_activate_model')) {
    nodes.push({
      type: 'mcp:flexinfer-template-activate',
      label: 'FlexInfer Activate Model',
      description: 'Warm a serverless model before inference execution',
      category: NodeCategory.AI,
      icon: '⚡',
      groupLabel: FLEXINFER_TEMPLATE_GROUP,
      dragData: {
        label: 'FlexInfer Activate Model',
        agent_id: 'loom-mcp-executor',
        tool_name: 'flexinfer__flexinfer_activate_model',
        mcp_server: FLEXINFER_SERVER,
        tool_args: {
          name: '${FLEXINFER_MODEL}',
          namespace: '${FLEXINFER_NAMESPACE:-flexinfer-system}',
        },
        runtime_contract: {
          kind: 'flexinfer_activation',
          required_env: ['FLEXINFER_MODEL'],
        },
      },
    });
  }

  nodes.push({
    type: 'mcp:flexinfer-template-inference',
    label: 'FlexInfer Inference',
    description: 'Call FlexInfer OpenAI-compatible chat completions endpoint',
    category: NodeCategory.AI,
    icon: '🤖',
    groupLabel: FLEXINFER_TEMPLATE_GROUP,
    dragData: {
      label: 'FlexInfer Inference',
      agent_id: 'loom-mcp-executor',
      tool_name: FLEXINFER_INFERENCE_TOOL,
      mcp_server: FLEXINFER_SERVER,
      tool_args: {
        proxy_url: '${FLEXINFER_PROXY_URL}',
        model: '${FLEXINFER_MODEL}',
        prompt: '${FLEXINFER_PROMPT}',
        temperature: '${FLEXINFER_TEMPERATURE:-0.2}',
        max_tokens: '${FLEXINFER_MAX_TOKENS:-512}',
      },
      runtime_contract: {
        kind: 'flexinfer_inference',
        required_env: ['FLEXINFER_PROXY_URL', 'FLEXINFER_MODEL', 'FLEXINFER_PROMPT'],
      },
    },
  });

  return nodes;
}

import apiService from '@/services/api/apiService';

async function loadMCPToolNodes(): Promise<NodeDefinition[]> {
  const endpoints = [
    '/api/v1/mcp/tools/index',
    '/api/v1/mcp/tools', // Fallback endpoint
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await apiService.httpClient.get(endpoint);
      const payload = response.data;
      const tools = normalizeMCPTools(payload);
      if (tools.length === 0) continue;

      const toolNodes = tools.map((tool) => {
        const flexinfer = isFlexInferTool(tool.name);
        return {
          type: toNodeType(tool.name),
          label: toolLabel(tool.name),
          description: tool.description ?? (flexinfer
            ? `FlexInfer: ${flexInferAction(tool.name)}`
            : `Execute ${tool.name} via loom-mcp-executor`),
          category: flexinfer ? NodeCategory.AI_INFERENCE : NodeCategory.INTEGRATION,
          icon: flexinfer ? '\u{1F9E0}' : '🧰',
          groupLabel: flexinfer ? 'AI Inference' : toolGroupLabel(tool.server),
          dragData: buildMCPToolDragData(tool),
        };
      });

      const flexInferTemplates = buildFlexInferTemplateNodes(tools);
      return [...flexInferTemplates, ...toolNodes];
    } catch {
      continue;
    }
  }

  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Draggable Node Item
// ─────────────────────────────────────────────────────────────────────────────

interface NodeItemProps {
  node: NodeDefinition;
  onDragStart?: (nodeType: string) => void;
}

const REACTFLOW_MIME_TYPE = 'application/reactflow';
const REACTFLOW_METADATA_MIME_TYPE = 'application/reactflow-metadata';

function NodeItem({ node, onDragStart }: NodeItemProps) {
  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      // Set the node type in the drag data for the canvas to read
      event.dataTransfer.setData(REACTFLOW_MIME_TYPE, node.type);
      if (node.dragData) {
        event.dataTransfer.setData(REACTFLOW_METADATA_MIME_TYPE, JSON.stringify(node.dragData));
      }
      event.dataTransfer.effectAllowed = 'move';
      onDragStart?.(node.type);
    },
    [node.dragData, node.type, onDragStart]
  );

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group cursor-grab select-none rounded-xl border border-border/60 bg-background/60 p-2.5
                 transition active:cursor-grabbing hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:shadow-lg hover:shadow-black/10"
      title={node.description}
    >
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-base shadow-sm">
          {node.icon ?? '📦'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-foreground">{node.label}</div>
          <div className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
            {node.description}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Category Section
// ─────────────────────────────────────────────────────────────────────────────

interface CategorySectionProps {
  category: NodeCategory;
  label?: string;
  nodes: NodeDefinition[];
  onDragStart?: (nodeType: string) => void;
  defaultExpanded?: boolean;
}

function CategorySection({ category, label, nodes, onDragStart, defaultExpanded = true }: CategorySectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const config = CATEGORY_CONFIG[category];
  const categoryLabel = label ?? config.label;

  if (nodes.length === 0) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide
                   text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className={`${expanded ? 'rotate-90' : ''} transition-transform`}>▶</span>
        <span className={config.color}>{categoryLabel}</span>
        <span className="text-muted-foreground/60">({nodes.length})</span>
      </button>
      {expanded && (
        <div className="space-y-1 mt-1">
          {nodes.map((node) => (
            <NodeItem key={node.type} node={node} onDragStart={onDragStart} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function NodePalette({
  onNodeDragStart,
  collapsed = false,
  onToggleCollapse,
  className = '',
}: NodePaletteProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [mcpNodes, setMcpNodes] = useState<NodeDefinition[]>([]);

  useEffect(() => {
    let active = true;
    void loadMCPToolNodes().then((nodes) => {
      if (active && nodes.length > 0) setMcpNodes(nodes);
    });
    return () => {
      active = false;
    };
  }, []);

  const allNodeDefinitions = useMemo(() => [...NODE_DEFINITIONS, ...mcpNodes], [mcpNodes]);

  // Filter nodes based on search term
  const filteredNodes = useMemo(() => {
    if (!searchTerm.trim()) return allNodeDefinitions;
    const term = searchTerm.toLowerCase();
    return allNodeDefinitions.filter(
      (node) =>
        node.label.toLowerCase().includes(term) ||
        node.description.toLowerCase().includes(term) ||
        node.type.toLowerCase().includes(term) ||
        (node.groupLabel?.toLowerCase().includes(term) ?? false)
    );
  }, [searchTerm, allNodeDefinitions]);

  // Group filtered nodes by category
  const groupedNodes = useMemo(() => {
    const groups = new Map<string, { category: NodeCategory; label: string; nodes: NodeDefinition[] }>();

    filteredNodes.forEach((node) => {
      const key = node.groupLabel ?? node.category;
      const existing = groups.get(key);
      if (existing) {
        existing.nodes.push(node);
        return;
      }

      groups.set(key, {
        category: node.category,
        label: node.groupLabel ?? CATEGORY_CONFIG[node.category].label,
        nodes: [node],
      });
    });

    // Sort categories by configured order then label.
    return Array.from(groups.entries()).sort(
      ([, a], [, b]) => {
        const byCategoryOrder = CATEGORY_CONFIG[a.category].order - CATEGORY_CONFIG[b.category].order;
        if (byCategoryOrder !== 0) return byCategoryOrder;
        return a.label.localeCompare(b.label);
      }
    );
  }, [filteredNodes]);

  if (collapsed) {
    return (
      <div className={`w-12 h-full bg-card/95 border-r flex flex-col items-center py-3 ${className}`}>
        <button
          onClick={onToggleCollapse}
          className="rounded-xl border border-border/70 bg-background p-2 transition-colors hover:bg-muted"
          title="Expand node palette"
        >
          <span className="text-lg">📦</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`w-72 h-full bg-card/95 border-r flex flex-col ${className}`}>
      {/* Header */}
      <div className="border-b px-3 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Nodes</div>
            <div className="mt-1 text-sm font-black tracking-[-0.02em] text-foreground">
              Build blocks
            </div>
          </div>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="rounded-lg border border-border/70 bg-background px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Collapse palette"
          >
            ◀
          </button>
        )}
        </div>
        <div className="mt-3 rounded-xl border border-primary/15 bg-primary/10 p-2 text-[11px] leading-5 text-muted-foreground">
          Drag a card to the canvas, or use a starter blueprint when the canvas is empty.
        </div>
      </div>

      {/* Search */}
      <div className="border-b px-3 py-3">
        <Input
          size="sm"
          placeholder="Search nodes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-8 text-[12px]"
        />
      </div>

      {/* Node categories */}
      <div className="flex-1 overflow-y-auto px-3 py-3 scrollbar-thin">
        {groupedNodes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-3 py-5 text-center text-[11px] text-muted-foreground">
            No nodes match "{searchTerm}"
          </div>
        ) : (
          groupedNodes.map(([groupKey, group]) => (
            <CategorySection
              key={groupKey}
              category={group.category}
              label={group.label}
              nodes={group.nodes}
              onDragStart={onNodeDragStart}
              defaultExpanded={searchTerm.length > 0 || group.nodes.length <= 5}
            />
          ))
        )}
      </div>

      {/* Footer tip */}
      <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
        Drag nodes to canvas, press <kbd className="rounded bg-muted px-1 py-0.5 text-[9px]">/</kbd> for quick add, or <kbd className="rounded bg-muted px-1 py-0.5 text-[9px]">n</kbd> to hide this rail.
      </div>
    </div>
  );
}

export default NodePalette;
