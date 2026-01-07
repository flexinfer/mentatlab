/**
 * Layout Components Index
 *
 * Exports all Mission Control layout components.
 * Phase 3 frontend refactoring complete.
 */

// Main layout
export { MissionControlLayout } from './MissionControlLayout';

// Compound components
export { WorkspaceProvider, useWorkspace, type WorkspaceContextValue, type CogpakUi, type FeatureFlagKey } from './WorkspaceProvider';
export { TopBar, type TopBarProps } from './TopBar';
export { LeftSidebar, type LeftSidebarProps } from './LeftSidebar';
export { BottomDock, type BottomDockProps } from './BottomDock';
