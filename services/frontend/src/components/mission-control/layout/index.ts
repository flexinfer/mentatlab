/**
 * Layout Components Index
 *
 * Exports all Mission Control layout components.
 * Part of Phase 3 frontend refactoring.
 */

// Main layout (use MissionControlLayout for the refactored version)
export { MissionControlLayout } from './MissionControlLayout.new';

// Compound components
export { WorkspaceProvider, useWorkspace, type WorkspaceContextValue, type CogpakUi, type FeatureFlagKey } from './WorkspaceProvider';
export { TopBar, type TopBarProps } from './TopBar';
export { LeftSidebar, type LeftSidebarProps } from './LeftSidebar';
export { BottomDock, type BottomDockProps } from './BottomDock';

// Legacy layout (kept for comparison during migration)
export { MissionControlLayout as MissionControlLayoutLegacy } from './MissionControlLayout';
