/**
 * BottomDock - Resizable tabbed panel dock at the bottom of Mission Control
 *
 * Features:
 * - Resizable height via react-resizable-panels
 * - Tabbed interface (Console, Timeline, Issues, Runs, Network, Graph)
 * - Collapsible with double-click
 * - Badge counts on tabs
 * - Action buttons for run control
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Button } from '@/components/ui/button';
import { PanelErrorBoundary } from '@/components/ui/PanelErrorBoundary';
import { useLayoutStore } from '@/stores';
import { useWorkspace } from './WorkspaceProvider';

// Panels (lazy imports to avoid circular deps)
import ConsolePanel from '../panels/ConsolePanel';
import TimelinePanel from '../panels/TimelinePanel';
import IssuesPanel from '../panels/IssuesPanel';
import RunsPanelImport from '../panels/RunsPanel';
import NetworkPanel from '../panels/NetworkPanel';
import GraphPanel from '../panels/GraphPanel';
import AgentBrowser from '../panels/AgentBrowser';
import TracePanelImport from '../panels/TracePanel';

// Type assertion needed due to React 19 JSX type changes
const RunsPanel = RunsPanelImport as unknown as React.FC;
const TracePanel = TracePanelImport as unknown as React.FC<{ runId?: string | null; traceId?: string | null }>;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TabId = 'Console' | 'Run Queue' | 'Timeline' | 'Issues' | 'Runs' | 'Network' | 'Graph' | 'Agents' | 'Traces';

interface TabConfig {
  id: TabId;
  label: string;
  featureFlag?: string;
  badge?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function TabButton({
  label,
  active,
  badge,
  onClick,
}: {
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border border-transparent px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={`px-1.5 py-0.5 text-[10px] rounded-full min-w-[18px] text-center ${active ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted-foreground/15 text-muted-foreground'}`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

function CollapseHandle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <div
      onDoubleClick={onToggle}
      className="group flex h-1.5 w-full cursor-row-resize items-center justify-center transition-colors hover:bg-primary/15"
    >
      <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30 group-hover:bg-primary/40 transition-colors" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BottomDock Component
// ─────────────────────────────────────────────────────────────────────────────

export interface BottomDockProps {
  className?: string;
}

export function BottomDock({ className = '' }: BottomDockProps) {
  const {
    bottomDockCollapsed,
    toggleBottomDock,
    bottomDockHeight,
    setBottomDockHeight,
    activeBottomTab,
    setActiveBottomTab,
  } = useLayoutStore();

  const {
    activeRunId,
    isEnabled,
    isLiveConnected,
    startDemoRun,
    startLiveConnection,
    stopLiveConnection,
    startOrchestratorRun,
  } = useWorkspace();

  // Badge counts
  const [issuesCount, setIssuesCount] = useState(0);
  const [timelineCount, setTimelineCount] = useState(0);

  // Selected node from Graph (bridged via CustomEvent)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Trace panel state (bridged from RunsPanel via CustomEvent)
  const [traceTarget, setTraceTarget] = useState<{ traceId?: string; runId?: string } | null>(null);

  // Graph node selection bridge
  useEffect(() => {
    const onNodeSelected = (e: Event) => {
      const nodeId = (e as CustomEvent).detail?.nodeId as string | undefined;
      setSelectedNodeId(nodeId ?? null);
    };
    const onNodeCleared = () => setSelectedNodeId(null);

    window.addEventListener('graphNodeSelected', onNodeSelected as EventListener);
    window.addEventListener('graphNodeCleared', onNodeCleared as EventListener);
    return () => {
      window.removeEventListener('graphNodeSelected', onNodeSelected as EventListener);
      window.removeEventListener('graphNodeCleared', onNodeCleared as EventListener);
    };
  }, []);

  // Listen for openTrace events (from RunsPanel "View Trace" button)
  useEffect(() => {
    const onOpenTrace = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setTraceTarget(detail);
      setActiveBottomTab('Traces');
    };
    window.addEventListener('openTrace', onOpenTrace as EventListener);
    return () => window.removeEventListener('openTrace', onOpenTrace as EventListener);
  }, [setActiveBottomTab]);

  // Reset timeline count when run changes (TimelinePanel owns the actual event count)
  useEffect(() => {
    setTimelineCount(0);
  }, [activeRunId]);

  // Tab configuration
  const tabs: TabConfig[] = [
    { id: 'Console', label: 'Console', featureFlag: 'MISSION_CONSOLE' },
    { id: 'Run Queue', label: 'Run Queue' },
    { id: 'Timeline', label: 'Timeline', featureFlag: 'NEW_STREAMING', badge: timelineCount },
    { id: 'Network', label: 'Network', featureFlag: 'NETWORK_PANEL' },
    { id: 'Runs', label: 'Runs', featureFlag: 'ORCHESTRATOR_PANEL' },
    { id: 'Issues', label: 'Issues', badge: issuesCount },
    { id: 'Graph', label: 'Graph', featureFlag: 'MISSION_GRAPH' },
    { id: 'Agents', label: 'Agents', featureFlag: 'ORCHESTRATOR_PANEL' },
    { id: 'Traces', label: 'Traces', featureFlag: 'ORCHESTRATOR_PANEL' },
  ];

  const visibleTabs = tabs.filter(
    (tab) => !tab.featureFlag || isEnabled(tab.featureFlag as keyof typeof isEnabled)
  );

  // Ensure active tab is valid
  const activeTab = visibleTabs.find((t) => t.id === activeBottomTab)?.id ?? visibleTabs[0]?.id ?? 'Console';

  const handleTabChange = useCallback(
    (tabId: TabId) => {
      setActiveBottomTab(tabId);
    },
    [setActiveBottomTab]
  );

  // When collapsed, render a minimal Panel to maintain PanelGroup structure
  if (bottomDockCollapsed) {
    return (
      <>
        <PanelResizeHandle className="mc-resize-handle h-0.5 cursor-row-resize" />
        <Panel defaultSize={3} minSize={3} maxSize={5} className={`mc-shell rounded-none border-x-0 border-b-0 ${className}`}>
          <div className="h-full flex items-center justify-center">
            <button
              onClick={toggleBottomDock}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Show Panel
            </button>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PanelResizeHandle className="mc-resize-handle h-1 cursor-row-resize" />
      <Panel
        defaultSize={25}
        minSize={15}
        maxSize={50}
        className={`mc-shell flex flex-col rounded-none border-x-0 border-b-0 ${className}`}
        onResize={(size) => setBottomDockHeight(Math.round(size * 6))}
      >
        {/* Collapse handle */}
        <CollapseHandle collapsed={false} onToggle={toggleBottomDock} />

        {/* Tab bar */}
        <div className="mc-shell-header flex h-10 items-center justify-between px-3">
          {/* Tabs */}
          <div className="flex items-center gap-1">
            {visibleTabs.map((tab) => (
              <TabButton
                key={tab.id}
                label={tab.label}
                active={activeTab === tab.id}
                badge={tab.badge}
                onClick={() => handleTabChange(tab.id)}
              />
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {isEnabled('CONNECT_WS') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (isLiveConnected) {
                    stopLiveConnection();
                    return;
                  }
                  void startLiveConnection();
                }}
                className="h-7 text-xs"
              >
                {isLiveConnected ? 'Disconnect' : 'Live'}
              </Button>
            )}
            {isEnabled('NEW_STREAMING') && (
              <Button variant="outline" size="sm" onClick={startDemoRun} className="h-7 text-xs">
                Demo Run
              </Button>
            )}
            {isEnabled('ORCHESTRATOR_PANEL') && (
              <Button variant="default" size="sm" onClick={startOrchestratorRun} className="h-7 text-xs">
                Run
              </Button>
            )}
          </div>
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'Console' && isEnabled('MISSION_CONSOLE') && (
            <PanelErrorBoundary panelName="Console" compact>
              <ConsolePanel runId={activeRunId} selectedNodeId={selectedNodeId} />
            </PanelErrorBoundary>
          )}
          {activeTab === 'Run Queue' && (
            <div className="p-4 text-sm text-muted-foreground">
              Run Queue - Coming soon
            </div>
          )}
          {activeTab === 'Timeline' && isEnabled('NEW_STREAMING') && (
            <PanelErrorBoundary panelName="Timeline" compact>
              <TimelinePanel runId={activeRunId} />
            </PanelErrorBoundary>
          )}
          {activeTab === 'Network' && isEnabled('NETWORK_PANEL') && (
            <PanelErrorBoundary panelName="Network" compact>
              <NetworkPanel runId={activeRunId} />
            </PanelErrorBoundary>
          )}
          {activeTab === 'Runs' && isEnabled('ORCHESTRATOR_PANEL') && (
            <PanelErrorBoundary panelName="Runs" compact>
              <RunsPanel />
            </PanelErrorBoundary>
          )}
          {activeTab === 'Issues' && (
            <PanelErrorBoundary panelName="Issues" compact>
              <IssuesPanel onCountChange={setIssuesCount} />
            </PanelErrorBoundary>
          )}
          {activeTab === 'Graph' && isEnabled('MISSION_GRAPH') && (
            <PanelErrorBoundary panelName="Graph" compact>
              <GraphPanel runId={activeRunId} />
            </PanelErrorBoundary>
          )}
          {activeTab === 'Agents' && isEnabled('ORCHESTRATOR_PANEL') && (
            <PanelErrorBoundary panelName="Agents" compact>
              <AgentBrowser />
            </PanelErrorBoundary>
          )}
          {activeTab === 'Traces' && isEnabled('ORCHESTRATOR_PANEL') && (
            <PanelErrorBoundary panelName="Traces" compact>
              <TracePanel
                runId={traceTarget?.runId || activeRunId}
                traceId={traceTarget?.traceId}
              />
            </PanelErrorBoundary>
          )}
        </div>
      </Panel>
    </>
  );
}

export default BottomDock;
