/**
 * QuickAddMenu - Keyboard-driven node insertion
 *
 * A spotlight-style menu for quickly adding nodes to the canvas.
 * Triggered by pressing '/' when the canvas is focused.
 * Supports fuzzy search and keyboard navigation.
 */

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useReactFlow } from 'reactflow';
import { NodeCategory, MediaNodeType } from '@/types/graph';
import { NODE_TYPES } from '@/nodes';
import { Input } from '@/components/ui/Input';
import { useCanvasStore } from '@/stores';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface QuickAddMenuProps {
  /** Whether the menu is open */
  isOpen: boolean;
  /** Callback to close the menu */
  onClose: () => void;
  /** Position to insert the new node (flow coordinates) */
  insertPosition?: { x: number; y: number };
  /** Callback when a node is inserted */
  onNodeInserted?: (nodeType: string, position: { x: number; y: number }) => void;
}

interface NodeOption {
  type: string;
  label: string;
  description: string;
  category: NodeCategory;
  icon: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node Options (same as NodePalette but flattened for search)
// ─────────────────────────────────────────────────────────────────────────────

const NODE_OPTIONS: NodeOption[] = [
  // Core logic nodes
  { type: NODE_TYPES.CHAT, label: 'Chat', description: 'LLM conversation node', category: NodeCategory.AI, icon: '💬' },
  { type: NODE_TYPES.PYTHON_CODE, label: 'Python Code', description: 'Execute Python code', category: NodeCategory.PROCESSING, icon: '🐍' },
  { type: NODE_TYPES.CONDITIONAL, label: 'Conditional', description: 'Branch flow based on conditions', category: NodeCategory.LOGIC, icon: '⑂' },
  { type: NODE_TYPES.FOR_EACH, label: 'For Each', description: 'Iterate over a collection', category: NodeCategory.LOGIC, icon: '🔁' },

  // Input nodes
  { type: MediaNodeType.MEDIA_UPLOAD, label: 'Media Upload', description: 'Upload images, audio, or video', category: NodeCategory.INPUT, icon: '📤' },
  { type: MediaNodeType.CAMERA_CAPTURE, label: 'Camera', description: 'Capture from webcam', category: NodeCategory.INPUT, icon: '📷' },
  { type: MediaNodeType.MICROPHONE_CAPTURE, label: 'Microphone', description: 'Record audio', category: NodeCategory.INPUT, icon: '🎤' },

  // Processing nodes
  { type: MediaNodeType.IMAGE_RESIZE, label: 'Image Resize', description: 'Resize images', category: NodeCategory.PROCESSING, icon: '📐' },
  { type: MediaNodeType.IMAGE_FILTER, label: 'Image Filter', description: 'Apply filters', category: NodeCategory.PROCESSING, icon: '🎨' },
  { type: MediaNodeType.AUDIO_TRANSCODE, label: 'Audio Transcode', description: 'Convert audio formats', category: NodeCategory.PROCESSING, icon: '🔊' },

  // AI nodes
  { type: MediaNodeType.IMAGE_RECOGNITION, label: 'Image Recognition', description: 'Classify images', category: NodeCategory.AI, icon: '👁️' },
  { type: MediaNodeType.OBJECT_DETECTION, label: 'Object Detection', description: 'Detect objects', category: NodeCategory.AI, icon: '🎯' },
  { type: MediaNodeType.SPEECH_TO_TEXT, label: 'Speech to Text', description: 'Transcribe audio', category: NodeCategory.AI, icon: '🗣️' },
  { type: MediaNodeType.TEXT_TO_SPEECH, label: 'Text to Speech', description: 'Convert text to audio', category: NodeCategory.AI, icon: '📢' },
  { type: MediaNodeType.OCR, label: 'OCR', description: 'Extract text from images', category: NodeCategory.AI, icon: '📝' },
  { type: MediaNodeType.IMAGE_GENERATION, label: 'Image Generation', description: 'Generate images', category: NodeCategory.AI, icon: '🎭' },

  // Output nodes
  { type: MediaNodeType.MEDIA_DISPLAY, label: 'Media Display', description: 'Preview media', category: NodeCategory.OUTPUT, icon: '🖥️' },
  { type: MediaNodeType.MEDIA_DOWNLOAD, label: 'Download', description: 'Download media', category: NodeCategory.OUTPUT, icon: '💾' },
  { type: MediaNodeType.WEBHOOK_SENDER, label: 'Webhook', description: 'Send to external URL', category: NodeCategory.INTEGRATION, icon: '🔗' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Fuzzy Search
// ─────────────────────────────────────────────────────────────────────────────

function fuzzyMatch(text: string, query: string): boolean {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  // Check if query is a substring
  if (textLower.includes(queryLower)) return true;

  // Simple fuzzy: check if all characters appear in order
  let queryIdx = 0;
  for (let i = 0; i < textLower.length && queryIdx < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIdx]) {
      queryIdx++;
    }
  }
  return queryIdx === queryLower.length;
}

function searchNodes(query: string): NodeOption[] {
  if (!query.trim()) return NODE_OPTIONS.slice(0, 8); // Show first 8 when empty

  const results = NODE_OPTIONS.filter((opt) =>
    fuzzyMatch(opt.label, query) ||
    fuzzyMatch(opt.description, query) ||
    fuzzyMatch(opt.type, query)
  );

  // Sort by relevance (exact prefix match first)
  const queryLower = query.toLowerCase();
  return results.sort((a, b) => {
    const aStartsWith = a.label.toLowerCase().startsWith(queryLower) ? 0 : 1;
    const bStartsWith = b.label.toLowerCase().startsWith(queryLower) ? 0 : 1;
    return aStartsWith - bStartsWith;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function QuickAddMenu({
  isOpen,
  onClose,
  insertPosition,
  onNodeInserted,
}: QuickAddMenuProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const reactFlowInstance = useReactFlow();
  const createNode = useCanvasStore((state) => state.createNode);

  // Filter results based on query
  const results = useMemo(() => searchNodes(query), [query]);

  // Reset state when menu opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Focus input after a short delay to ensure the menu is rendered
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && results.length > 0) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex, results.length]);

  // Insert the selected node
  const insertNode = useCallback(
    (option: NodeOption) => {
      // Determine insertion position
      let position = insertPosition ?? { x: 100, y: 100 };

      // If no position provided, try to get center of viewport
      if (!insertPosition) {
        try {
          const viewport = reactFlowInstance.getViewport();
          // Get canvas center in screen coords and convert to flow coords
          const viewportCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          position = reactFlowInstance.screenToFlowPosition(viewportCenter);
        } catch {
          // Use default position
        }
      }

      // Create the node
      createNode(option.type, position);
      onNodeInserted?.(option.type, position);
      onClose();

      console.debug('[QuickAddMenu] Inserted node:', { type: option.type, position });
    },
    [reactFlowInstance, createNode, insertPosition, onNodeInserted, onClose]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          const selected = results[selectedIndex];
          if (selected) {
            insertNode(selected);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'Tab':
          e.preventDefault();
          // Tab cycles through results
          if (e.shiftKey) {
            setSelectedIndex((i) => (i === 0 ? results.length - 1 : i - 1));
          } else {
            setSelectedIndex((i) => (i + 1) % results.length);
          }
          break;
      }
    },
    [results, selectedIndex, insertNode, onClose]
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/20"
        onClick={onClose}
      />

      {/* Menu */}
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 max-w-[90vw]">
        <div className="bg-card border rounded-lg shadow-xl overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b">
            <Input
              ref={inputRef}
              size="sm"
              placeholder="Search nodes... (type to filter)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="text-sm"
            />
          </div>

          {/* Results list */}
          <div ref={listRef} className="max-h-64 overflow-y-auto scrollbar-thin">
            {results.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No nodes match "{query}"
              </div>
            ) : (
              results.map((option, index) => (
                <button
                  key={option.type}
                  className={`w-full px-3 py-2 flex items-center gap-3 text-left transition-colors ${
                    index === selectedIndex
                      ? 'bg-primary/10 text-foreground'
                      : 'hover:bg-muted/50 text-muted-foreground'
                  }`}
                  onClick={() => insertNode(option)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className="text-lg w-6 text-center">{option.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{option.label}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {option.description}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground/60 capitalize">
                    {option.category}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-2 border-t text-[10px] text-muted-foreground flex items-center justify-between">
            <span>
              <kbd className="px-1 py-0.5 bg-muted rounded">↑↓</kbd> navigate
              <span className="mx-2">|</span>
              <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> insert
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-muted rounded">Esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

export default QuickAddMenu;
