/**
 * LeftSidebar - Mission Control left navigation panel
 *
 * Contains:
 * - Workspaces section
 * - CogPaks list
 * - Flows list
 *
 * Uses react-resizable-panels for width adjustment.
 */

import React from 'react';
import { Panel, PanelResizeHandle } from 'react-resizable-panels';
import { ChevronLeft } from 'lucide-react';
import { useLayoutStore } from '@/stores';
import { useWorkspace } from './WorkspaceProvider';

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SectionTitle({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`text-[10px] uppercase tracking-wide text-muted-foreground px-2 ${className}`}>
      {children}
    </div>
  );
}

function CollapseButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute -right-3 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <ChevronLeft className={`h-3 w-3 transition-transform ${collapsed ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LeftSidebar Component
// ─────────────────────────────────────────────────────────────────────────────

export interface LeftSidebarProps {
  /** Content to render in the sidebar (CogPaksList, Flows, etc.) */
  children?: React.ReactNode;
  /** Class name for the sidebar container */
  className?: string;
}

export function LeftSidebar({ children, className = '' }: LeftSidebarProps) {
  const {
    leftSidebarCollapsed,
    toggleLeftSidebar,
    leftSidebarWidth,
    setLeftSidebarWidth,
  } = useLayoutStore();
  const { setMainView } = useWorkspace();

  // When collapsed, render a minimal Panel to maintain PanelGroup structure
  if (leftSidebarCollapsed) {
    return (
      <>
        <Panel defaultSize={2} minSize={2} maxSize={3} className="mc-mobile-hide mc-shell relative rounded-none border-y-0 border-l-0">
          <div className="h-full flex items-center justify-center">
            <CollapseButton collapsed={true} onClick={toggleLeftSidebar} />
          </div>
        </Panel>
        <PanelResizeHandle className="mc-mobile-hide mc-resize-handle w-0.5 cursor-col-resize" />
      </>
    );
  }

  return (
    <>
      <Panel
        defaultSize={15}
        minSize={10}
        maxSize={25}
        className={`mc-mobile-hide relative ${className}`}
        onResize={(size) => {
          // Convert percentage to approximate pixels (assuming ~1600px viewport)
          setLeftSidebarWidth(Math.round(size * 16));
        }}
      >
        <aside className="mc-shell flex h-full flex-col overflow-hidden rounded-none border-y-0 border-l-0">
          {/* Header */}
          <div className="mc-shell-header flex items-center justify-between p-3">
            <span className="text-xs font-medium text-muted-foreground">Navigator</span>
            <CollapseButton collapsed={false} onClick={toggleLeftSidebar} />
          </div>

          {/* Scrollable content */}
          <nav className="flex-1 overflow-y-auto p-2 space-y-4">
            {/* Workspaces section */}
            <div>
              <SectionTitle>Workspaces</SectionTitle>
              <ul className="space-y-1 mt-2">
                <li
                  className="flex cursor-pointer items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
                  onClick={() => setMainView('canvas')}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  Default
                </li>
              </ul>
            </div>

            {/* Custom children (CogPaksList, Flows, etc.) */}
            {children}
          </nav>
        </aside>
      </Panel>
      <PanelResizeHandle className="mc-mobile-hide mc-resize-handle w-1 cursor-col-resize" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported sub-components for composition
// ─────────────────────────────────────────────────────────────────────────────

LeftSidebar.Section = function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-2">{children}</div>
    </div>
  );
};

LeftSidebar.SectionTitle = SectionTitle;

export default LeftSidebar;
