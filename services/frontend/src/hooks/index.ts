/**
 * Hooks Index - Re-exports all custom hooks
 */

export {
  useAutoSave,
  useSaveStatus,
  type AutoSaveOptions,
  type AutoSaveState,
  type SaveStatus,
} from './useAutoSave';

export {
  useKeyboardShortcuts,
  formatShortcut,
  categorizeShortcuts,
  type KeyboardShortcut,
  type ShortcutCategory,
} from './useKeyboardShortcuts';

export {
  useStreamingTransport,
  type UseStreamingTransportOptions,
  type UseStreamingTransportReturn,
} from './useStreamingTransport';
