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

function buildMCPToolDragData(tool: MCPToolRecord): Record<string, unknown> {
  return {
    label: toolLabel(tool.name),
    agent_id: 'loom-mcp-executor',
    tool_name: tool.name,
    tool_args: {},
    mcp_server: tool.server ?? '',
    inputSchema: tool.inputSchema ?? {},
  };
}

async function loadMCPToolNodes(): Promise<NodeDefinition[]> {
  if (typeof fetch !== 'function') return [];

  const endpoints = [
    'loom://tools/index',
    '/api/v1/mcp/tools/index',
    '/api/v1/mcp/tools',
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint);
      if (!response.ok) continue;

      const payload = (await response.json()) as unknown;
      const tools = normalizeMCPTools(payload);
      if (tools.length === 0) continue;

      return tools.map((tool) => ({
        type: toNodeType(tool.name),
        label: toolLabel(tool.name),
        description: tool.description ?? `Execute ${tool.name} via loom-mcp-executor`,
        category: NodeCategory.INTEGRATION,
        icon: '🧰',
        groupLabel: toolGroupLabel(tool.server),
        dragData: buildMCPToolDragData(tool),
      }));
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
      className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing
                 bg-muted/40 hover:bg-muted/80 border border-transparent hover:border-border/50
                 transition-colors select-none"
      title={node.description}
    >
      <span className="text-base w-5 text-center">{node.icon ?? '📦'}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-foreground truncate">{node.label}</div>
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
      <div className={`w-10 h-full bg-card border-r flex flex-col items-center py-2 ${className}`}>
        <button
          onClick={onToggleCollapse}
          className="p-2 rounded hover:bg-muted transition-colors"
          title="Expand node palette"
        >
          <span className="text-lg">📦</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`w-56 h-full bg-card border-r flex flex-col ${className}`}>
      {/* Header */}
      <div className="px-2 py-2 border-b flex items-center justify-between">
        <span className="text-[11px] font-semibold text-foreground">Nodes</span>
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"
            title="Collapse palette"
          >
            ◀
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-2 py-2 border-b">
        <Input
          size="sm"
          placeholder="Search nodes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="text-[11px] h-7"
        />
      </div>

      {/* Node categories */}
      <div className="flex-1 overflow-y-auto px-2 py-2 scrollbar-thin">
        {groupedNodes.length === 0 ? (
          <div className="text-[11px] text-muted-foreground text-center py-4">
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
      <div className="px-2 py-1.5 border-t text-[10px] text-muted-foreground">
        Drag nodes to canvas or press <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">n</kbd>
      </div>
    </div>
  );
}

export default NodePalette;
