import React from 'react';
import useStore from '../../../store';
import { useToast } from '../../../contexts/ToastContext';
import { cn } from '../../../lib/utils';

interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

/**
 * NodeContextMenu - Context menu for node quick actions
 *
 * Appears on right-click of a node in the canvas.
 * Provides quick access to common operations like duplicate, delete, etc.
 */
export function NodeContextMenu() {
  const { contextMenu, closeContextMenu, nodes, duplicateNode, deleteNodes } = useStore();
  const toast = useToast();
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close menu on click outside
  React.useEffect(() => {
    if (!contextMenu.isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeContextMenu();
      }
    };

    // Use timeout to avoid closing immediately on the same click that opened it
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu.isOpen, closeContextMenu]);

  // Get the target node
  const targetNode = React.useMemo(() => {
    if (!contextMenu.nodeId) return null;
    return nodes.find((n) => n.id === contextMenu.nodeId);
  }, [contextMenu.nodeId, nodes]);

  // Define menu items based on node state
  const menuItems = React.useMemo<MenuItem[]>(() => {
    if (!targetNode) return [];

    const nodeStatus = targetNode.data?.status;
    const isRunning = nodeStatus === 'running' || nodeStatus === 'pending';
    const isFailed = nodeStatus === 'failed' || nodeStatus === 'error';

    const items: MenuItem[] = [
      // View actions
      {
        label: 'View Details',
        icon: <InfoIcon />,
        action: () => {
          // Dispatch custom event to open inspector with this node
          window.dispatchEvent(new CustomEvent('inspectNode', { detail: { nodeId: contextMenu.nodeId } }));
          closeContextMenu();
        },
      },
      {
        label: 'View Logs',
        icon: <TerminalIcon />,
        action: () => {
          // Dispatch custom event to filter console to this node
          window.dispatchEvent(new CustomEvent('filterConsole', { detail: { nodeId: contextMenu.nodeId } }));
          closeContextMenu();
        },
      },
      { label: '', action: () => {}, divider: true },
      // Edit actions
      {
        label: 'Duplicate',
        icon: <CopyIcon />,
        action: () => {
          duplicateNode(contextMenu.nodeId!);
          toast.success('Node duplicated');
          closeContextMenu();
        },
      },
      {
        label: 'Delete',
        icon: <TrashIcon />,
        action: () => {
          deleteNodes([contextMenu.nodeId!]);
          toast.info('Node deleted');
          closeContextMenu();
        },
        danger: true,
      },
    ];

    // Add run-specific actions
    if (isRunning || isFailed) {
      items.splice(2, 0, { label: '', action: () => {}, divider: true });

      if (isRunning) {
        items.splice(3, 0, {
          label: 'Cancel',
          icon: <StopIcon />,
          action: () => {
            window.dispatchEvent(new CustomEvent('cancelNode', { detail: { nodeId: contextMenu.nodeId } }));
            closeContextMenu();
          },
        });
      }

      if (isFailed) {
        items.splice(3, 0, {
          label: 'Retry',
          icon: <RetryIcon />,
          action: () => {
            window.dispatchEvent(new CustomEvent('retryNode', { detail: { nodeId: contextMenu.nodeId } }));
            closeContextMenu();
          },
        });
      }
    }

    return items;
  }, [targetNode, contextMenu.nodeId, duplicateNode, deleteNodes, closeContextMenu, toast]);

  if (!contextMenu.isOpen || !targetNode) return null;

  // Adjust position to keep menu in viewport
  const adjustedPosition = {
    x: Math.min(contextMenu.position.x, window.innerWidth - 200),
    y: Math.min(contextMenu.position.y, window.innerHeight - 300),
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Node actions"
      className="fixed z-[100] min-w-[160px] rounded-lg border border-border bg-popover/95 backdrop-blur-sm shadow-lg py-1 text-sm animate-in fade-in zoom-in-95 duration-100"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
    >
      {/* Node name header */}
      <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border mb-1 truncate max-w-[200px]">
        {targetNode.data?.label || targetNode.type || 'Node'}
      </div>

      {menuItems.map((item, index) =>
        item.divider ? (
          <div key={index} className="h-px bg-border my-1" />
        ) : (
          <button
            key={index}
            role="menuitem"
            disabled={item.disabled}
            onClick={item.action}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              'focus:bg-accent focus:text-accent-foreground focus:outline-none',
              'disabled:opacity-50 disabled:pointer-events-none',
              item.danger && 'text-destructive hover:bg-destructive/10 hover:text-destructive'
            )}
          >
            {item.icon && <span className="w-4 h-4 shrink-0">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        )
      )}
    </div>
  );
}

// Simple inline SVG icons
function InfoIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

export default NodeContextMenu;
