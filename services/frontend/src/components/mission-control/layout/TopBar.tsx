/**
 * TopBar - Mission Control header with navigation and controls
 *
 * Extracted from MissionControlLayout to enable compound component pattern.
 * Contains:
 * - Logo and title
 * - View mode switcher (Canvas, Network, Flow, Code)
 * - Run controls
 * - Theme toggle
 * - Settings and help buttons
 */

import React from 'react';
import { Button } from '@/components/ui/button';
import { useLayoutStore } from '@/stores';
import { useWorkspace } from './WorkspaceProvider';
import { SaveStatusIndicator } from '@/components/ui/SaveStatusIndicator';
import { ConnectionStatusBanner } from '@/components/ui/ConnectionStatusBanner';
import type { MainViewMode } from '@/stores/layout';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ViewModeButtonProps {
  mode: MainViewMode;
  label: string;
  active: boolean;
  onClick: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ViewModeButton({ mode, label, active, onClick }: ViewModeButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TopBar Component
// ─────────────────────────────────────────────────────────────────────────────

export interface TopBarProps {
  className?: string;
}

export function TopBar({ className = '' }: TopBarProps) {
  const { mainView, setMainView, darkMode, toggleDarkMode } = useLayoutStore();
  const {
    isEnabled,
    setSettingsOpen,
    setShortcutsDialogOpen,
    setCommandPaletteOpen,
    startDemoRun,
    startLiveConnection,
    startOrchestratorRun,
  } = useWorkspace();

  const viewModes: { mode: MainViewMode; label: string }[] = [
    { mode: 'canvas', label: 'Canvas' },
    { mode: 'network', label: 'Network' },
    { mode: 'flow', label: 'Flow' },
    { mode: 'code', label: 'Code' },
  ];

  return (
    <header
      className={`h-12 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center justify-between px-4 ${className}`}
    >
      {/* Left: Logo and title */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center">
            <span className="text-xs font-bold text-primary">M</span>
          </div>
          <span className="font-semibold text-sm">MentatLab</span>
        </div>

        {/* View mode switcher */}
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
          {viewModes.map(({ mode, label }) => (
            <ViewModeButton
              key={mode}
              mode={mode}
              label={label}
              active={mainView === mode}
              onClick={() => setMainView(mode)}
            />
          ))}
        </div>
      </div>

      {/* Center: Connection status */}
      <div className="flex-1 flex justify-center">
        <ConnectionStatusBanner />
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-2">
        {/* Save status */}
        <SaveStatusIndicator />

        {/* Run controls */}
        <div className="flex items-center gap-1 border-l pl-2 ml-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={startDemoRun}
            className="text-xs h-7"
            title="Start demo run (Cmd+D)"
          >
            Demo
          </Button>
          {isEnabled('CONNECT_WS') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={startLiveConnection}
              className="text-xs h-7"
              title="Connect live"
            >
              Live
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={startOrchestratorRun}
            className="text-xs h-7"
            title="Run via orchestrator (Cmd+R)"
          >
            Run
          </Button>
        </div>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleDarkMode}
          className="h-7 w-7"
          title={`Toggle ${darkMode ? 'light' : 'dark'} mode (Cmd+T)`}
        >
          {darkMode ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
              />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
              />
            </svg>
          )}
        </Button>

        {/* Command palette */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCommandPaletteOpen(true)}
          className="h-7 w-7"
          title="Command palette (Cmd+K)"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </Button>

        {/* Keyboard shortcuts help */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShortcutsDialogOpen(true)}
          className="h-7 w-7"
          title="Keyboard shortcuts (Shift+?)"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </Button>

        {/* Settings */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          className="h-7 w-7"
          title="Settings"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </Button>
      </div>
    </header>
  );
}

export default TopBar;
