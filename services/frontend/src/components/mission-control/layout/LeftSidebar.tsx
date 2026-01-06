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
      className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-muted border flex items-center justify-center hover:bg-muted/80 transition-colors"
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      <svg
        className={`h-3 w-3 transition-transform ${collapsed ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
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

  if (leftSidebarCollapsed) {
    return (
      <div className="relative w-0 h-full">
        <CollapseButton collapsed={true} onClick={toggleLeftSidebar} />
      </div>
    );
  }

  return (
    <>
      <Panel
        defaultSize={15}
        minSize={10}
        maxSize={25}
        className={`relative ${className}`}
        onResize={(size) => {
          // Convert percentage to approximate pixels (assuming ~1600px viewport)
          setLeftSidebarWidth(Math.round(size * 16));
        }}
      >
        <aside className="h-full border-r bg-card overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-3 border-b flex items-center justify-between">
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
                  className="px-3 py-2 rounded-lg bg-primary/10 text-sm font-medium text-primary flex items-center gap-2 cursor-pointer"
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
      <PanelResizeHandle className="w-1 hover:bg-primary/20 transition-colors cursor-col-resize" />
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
