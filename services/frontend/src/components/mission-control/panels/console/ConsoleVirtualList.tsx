/**
 * ConsoleVirtualList - Virtualized list for console events
 *
 * Uses react-window v2 for efficient rendering of large event lists.
 * Only renders visible items + overscan, keeping DOM size constant.
 */

import React, { useCallback, useEffect, memo } from 'react';
import { List, RowComponentProps, useListRef } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import Badge from '@/components/ui/Badge';
import CodeInline from '@/components/ui/CodeInline';
import { ConsoleItem, ConsoleType, ConsoleLevel } from './useRunConsole';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsoleVirtualListProps {
  items: ConsoleItem[];
  autoscroll: boolean;
  onAutoscrollChange: (enabled: boolean) => void;
  onItemClick?: (item: ConsoleItem, index: number) => void;
  selectedIndex?: number | null;
}

interface RowData {
  items: ConsoleItem[];
  onItemClick?: (item: ConsoleItem, index: number) => void;
  selectedIndex?: number | null;
}

// Row height in pixels (matches h-8 + py-1 padding)
const ROW_HEIGHT = 40;
const OVERSCAN_COUNT = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Row Component (memoized for performance)
// ─────────────────────────────────────────────────────────────────────────────

const ConsoleRow = memo(function ConsoleRow({
  index,
  style,
  items,
  onItemClick,
  selectedIndex,
}: RowComponentProps<RowData> & RowData) {
  const item = items[index];
  if (!item) return null;

  const isSelected = selectedIndex === index;

  return (
    <div style={style} className="px-2 py-1">
      <div
        className={`flex items-center gap-2 rounded transition-colors h-8 px-2 cursor-pointer ${
          isSelected
            ? 'bg-primary/20 ring-1 ring-primary/40'
            : 'hover:bg-muted/40'
        }`}
        onClick={() => onItemClick?.(item, index)}
      >
        {/* Time */}
        <span className="text-gray-400 min-w-[90px] tabular-nums text-[11px]">
          {formatTime(item.ts)}
        </span>
        {/* Type */}
        <Badge variant={typeVariant(item.type)} title={String(item.type)}>
          {item.type}
        </Badge>
        {/* Level */}
        {item.type === 'log' && item.level && (
          <Badge variant={levelVariant(item.level)} title={String(item.level)}>
            {item.level}
          </Badge>
        )}
        {/* Node */}
        {item.nodeId && (
          <span className="text-gray-500 text-[11px] truncate max-w-[100px]">
            {item.nodeId}
          </span>
        )}
        {/* Message/Data */}
        <span className="flex-1 text-gray-800 dark:text-gray-200 text-[11px] truncate">
          {renderMessageOrData(item)}
        </span>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function ConsoleVirtualList({
  items,
  autoscroll,
  onAutoscrollChange,
  onItemClick,
  selectedIndex,
}: ConsoleVirtualListProps) {
  const listRef = useListRef(null);

  // Scroll to bottom when items change and autoscroll is enabled
  useEffect(() => {
    if (autoscroll && listRef.current && items.length > 0) {
      listRef.current.scrollToRow({ index: items.length - 1, align: 'end' });
    }
  }, [items.length, autoscroll, listRef]);

  // Handle scroll events to detect user scrolling away from bottom
  const handleScroll = useCallback(
    (scrollTop: number, containerHeight: number) => {
      const totalHeight = items.length * ROW_HEIGHT;
      const threshold = ROW_HEIGHT * 2;
      const atBottom = scrollTop + containerHeight >= totalHeight - threshold;

      if (!atBottom && autoscroll) {
        onAutoscrollChange(false);
      } else if (atBottom && !autoscroll) {
        onAutoscrollChange(true);
      }
    },
    [items.length, autoscroll, onAutoscrollChange]
  );

  if (items.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-[11px]">
        No events.
      </div>
    );
  }

  return (
    <AutoSizer
      className="h-full w-full"
      renderProp={({ height, width }) =>
        height && width ? (
          <List
            listRef={listRef}
            style={{ height, width }}
            rowCount={items.length}
            rowHeight={ROW_HEIGHT}
            rowComponent={ConsoleRow}
            rowProps={{ items, onItemClick, selectedIndex }}
            overscanCount={OVERSCAN_COUNT}
            className="scrollbar-thin"
            onScroll={(e: React.UIEvent<HTMLDivElement>) => {
              const target = e.currentTarget;
              handleScroll(target.scrollTop, target.clientHeight);
            }}
          />
        ) : null
      }
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

function typeVariant(t: ConsoleType) {
  switch (t) {
    case 'log':
      return 'info' as const;
    case 'checkpoint':
      return 'success' as const;
    case 'node_status':
      return 'warning' as const;
    case 'status':
      return 'default' as const;
    default:
      return 'default' as const;
  }
}

function levelVariant(l?: ConsoleLevel) {
  switch (l) {
    case 'debug':
      return 'default' as const;
    case 'info':
      return 'info' as const;
    case 'warn':
      return 'warning' as const;
    case 'error':
      return 'danger' as const;
    default:
      return 'default' as const;
  }
}

function renderMessageOrData(it: { type: ConsoleType; message?: string; data?: unknown }) {
  if (it.type === 'log' && it.message) {
    return <span className="whitespace-nowrap">{it.message}</span>;
  }
  return <CodeInline value={compactData(it.data)} maxLength={200} />;
}

function compactData(d: unknown): unknown {
  if (!d || typeof d !== 'object') return d;
  const obj = d as Record<string, unknown>;
  const { message, msg, node_id, nodeId, type, kind, level, ...rest } = obj;
  const head: Record<string, unknown> = {};
  if (type) head.type = type;
  if (kind) head.kind = kind;
  if (level) head.level = level;
  if (message) head.message = message;
  if (msg) head.msg = msg;
  if (node_id) head.node_id = node_id;
  if (nodeId) head.nodeId = nodeId;
  if (Object.keys(head).length > 0) {
    if (Object.keys(rest).length) {
      head._ = rest;
    }
    return head;
  }
  return d;
}

export function formatTime(ts?: string) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  } catch {
    return ts;
  }
}

export default ConsoleVirtualList;
