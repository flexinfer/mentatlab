/**
 * Store - Re-exports for backwards compatibility
 *
 * @deprecated Import from '@/stores' instead.
 * This file is maintained for backwards compatibility during migration.
 *
 * Migration guide:
 *   OLD: import useStore from '../store';
 *   NEW: import { useCanvasStore } from '@/stores';
 *
 *   OLD: import { useStreamingStore } from '../store';
 *   NEW: import { useStreamingStore } from '@/stores';
 */

// Re-export canvas store as default (most common usage)
export { useCanvasStore as default } from './stores';

// Re-export streaming store for files that import it from here
export { useStreamingStore } from './stores';

// Re-export RFState type for backwards compatibility
export type { CanvasState as RFState } from './stores';
