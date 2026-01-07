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
import { useLayoutStore, useStreamingStore } from '@/stores';
import { useWorkspace } from './WorkspaceProvider';
import { StreamConnectionState } from '@/types/streaming';
import { flightRecorder } from '@/services/mission-control/services';

// Panels (lazy imports to avoid circular deps)
import ConsolePanel from '../panels/ConsolePanel';
import TimelinePanel from '../panels/TimelinePanel';
import IssuesPanel from '../panels/IssuesPanel';
import RunsPanelImport from '../panels/RunsPanel';
import NetworkPanel from '../panels/NetworkPanel';
import GraphPanel from '../panels/GraphPanel';

// Type assertion needed due to React 19 JSX type changes
const RunsPanel = RunsPanelImport as unknown as React.FC;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TabId = 'Console' | 'Run Queue' | 'Timeline' | 'Issues' | 'Runs' | 'Network' | 'Graph';

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
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 flex items-center gap-1.5 ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={`px-1.5 py-0.5 text-[10px] rounded-full min-w-[18px] text-center ${
          active
            ? 'bg-primary-foreground/20 text-primary-foreground'
            : 'bg-muted-foreground/20 text-muted-foreground'
        }`}>
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
      className="h-1.5 w-full cursor-row-resize hover:bg-primary/20 transition-colors flex items-center justify-center group"
    >
      <div className="w-8 h-0.5 rounded-full bg-muted-foreground/30 group-hover:bg-primary/50 transition-colors" />
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
    startDemoRun,
    startLiveConnection,
    startOrchestratorRun,
  } = useWorkspace();

  // Connection status for live button state
  const connectionStatus = useStreamingStore((s) => s.connectionStatus);
  const liveDisabled =
    connectionStatus === StreamConnectionState.CONNECTING ||
    connectionStatus === StreamConnectionState.RECONNECTING ||
    connectionStatus === StreamConnectionState.CONNECTED;

  // Badge counts
  const [issuesCount, setIssuesCount] = useState(0);
  const [timelineCount, setTimelineCount] = useState(0);

  // Selected node from Graph (bridged via CustomEvent)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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

  // Timeline count subscription
  useEffect(() => {
    if (!activeRunId) {
      setTimelineCount(0);
      return;
    }
    try {
      setTimelineCount(flightRecorder.listCheckpoints(activeRunId).length);
      const unsub = flightRecorder.subscribe(activeRunId, () => {
        setTimelineCount(flightRecorder.listCheckpoints(activeRunId).length);
      });
      return () => unsub?.();
    } catch {
      // ignore
    }
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
        <PanelResizeHandle className="h-0.5 hover:bg-primary/20 transition-colors cursor-row-resize" />
        <Panel defaultSize={3} minSize={3} maxSize={5} className={`bg-card border-t ${className}`}>
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
      <PanelResizeHandle className="h-1 hover:bg-primary/20 transition-colors cursor-row-resize" />
      <Panel
        defaultSize={25}
        minSize={15}
        maxSize={50}
        className={`flex flex-col bg-card border-t ${className}`}
        onResize={(size) => setBottomDockHeight(Math.round(size * 6))}
      >
        {/* Collapse handle */}
        <CollapseHandle collapsed={false} onToggle={toggleBottomDock} />

        {/* Tab bar */}
        <div className="h-10 border-b flex items-center justify-between px-3">
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
                onClick={startLiveConnection}
                disabled={liveDisabled}
                className="h-7 text-xs"
              >
                {connectionStatus === StreamConnectionState.CONNECTING ||
                connectionStatus === StreamConnectionState.RECONNECTING
                  ? 'Connecting...'
                  : connectionStatus === StreamConnectionState.CONNECTED
                    ? 'Live'
                    : 'Connect'}
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
        </div>
      </Panel>
    </>
  );
}

export default BottomDock;
