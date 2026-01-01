import { useEffect, useCallback, useRef } from 'react';

/**
 * Keyboard shortcut configuration
 */
export interface KeyboardShortcut {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  description: string;
  action: (event: KeyboardEvent) => void;
  preventDefault?: boolean;
  enabled?: boolean;
}

/**
 * Platform-aware modifier key detection
 */
const isMac = typeof window !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform);

/**
 * Normalize keyboard event to handle cross-platform modifiers
 */
function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  // Check if shortcut is disabled
  if (shortcut.enabled === false) return false;

  // Key match (case-insensitive)
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;

  // Handle Ctrl/Cmd (Meta on Mac, Ctrl on Windows/Linux)
  const cmdOrCtrl = shortcut.ctrlKey || shortcut.metaKey;
  if (cmdOrCtrl) {
    const hasModifier = isMac ? event.metaKey : event.ctrlKey;
    if (!hasModifier) return false;
  } else {
    // If not expecting Ctrl/Cmd, ensure they're not pressed
    if (event.ctrlKey || event.metaKey) return false;
  }

  // Check Shift
  if (shortcut.shiftKey && !event.shiftKey) return false;
  if (!shortcut.shiftKey && event.shiftKey) return false;

  // Check Alt
  if (shortcut.altKey && !event.altKey) return false;
  if (!shortcut.altKey && event.altKey) return false;

  return true;
}

/**
 * Hook for managing keyboard shortcuts
 *
 * @example
 * ```tsx
 * const shortcuts: KeyboardShortcut[] = [
 *   {
 *     key: 's',
 *     ctrlKey: true,
 *     description: 'Save flow',
 *     action: () => handleSave(),
 *     preventDefault: true,
 *   },
 *   {
 *     key: 'k',
 *     ctrlKey: true,
 *     description: 'Open command palette',
 *     action: () => setCommandPaletteOpen(true),
 *   },
 * ];
 *
 * useKeyboardShortcuts(shortcuts);
 * ```
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[], enabled = true) {
  const shortcutsRef = useRef(shortcuts);

  // Keep shortcuts up to date
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    // Skip if user is typing in an input field
    const target = event.target as HTMLElement;
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    const isContentEditable = target.isContentEditable;

    if (isInput || isContentEditable) {
      // Allow Escape key even in inputs
      if (event.key !== 'Escape') return;
    }

    // Find matching shortcut
    for (const shortcut of shortcutsRef.current) {
      if (matchesShortcut(event, shortcut)) {
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
          event.stopPropagation();
        }
        shortcut.action(event);
        break; // Only trigger first match
      }
    }
  }, [enabled]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

/**
 * Format shortcut for display (e.g., "⌘S" on Mac, "Ctrl+S" on Windows)
 */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];

  if (shortcut.ctrlKey || shortcut.metaKey) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (shortcut.shiftKey) {
    parts.push(isMac ? '⇧' : 'Shift');
  }
  if (shortcut.altKey) {
    parts.push(isMac ? '⌥' : 'Alt');
  }

  // Capitalize key for display
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  parts.push(key);

  return parts.join(isMac ? '' : '+');
}

/**
 * Get all shortcuts grouped by category
 */
export interface ShortcutCategory {
  name: string;
  shortcuts: Array<KeyboardShortcut & { displayKey: string }>;
}

export function categorizeShortcuts(shortcuts: KeyboardShortcut[]): Map<string, ShortcutCategory> {
  const categories = new Map<string, ShortcutCategory>();

  shortcuts.forEach(shortcut => {
    // Extract category from description (e.g., "Flow: Save" -> "Flow")
    const [category = 'General', ...rest] = shortcut.description.split(':');
    const cleanDesc = rest.length > 0 ? rest.join(':').trim() : shortcut.description;

    if (!categories.has(category)) {
      categories.set(category, {
        name: category,
        shortcuts: [],
      });
    }

    categories.get(category)!.shortcuts.push({
      ...shortcut,
      description: cleanDesc,
      displayKey: formatShortcut(shortcut),
    });
  });

  return categories;
}

/**
 * Common keyboard shortcuts that can be reused
 */
export const commonShortcuts = {
  save: (action: () => void): KeyboardShortcut => ({
    key: 's',
    ctrlKey: true,
    description: 'Save',
    action,
    preventDefault: true,
  }),
  undo: (action: () => void): KeyboardShortcut => ({
    key: 'z',
    ctrlKey: true,
    description: 'Undo',
    action,
    preventDefault: true,
  }),
  redo: (action: () => void): KeyboardShortcut => ({
    key: 'z',
    ctrlKey: true,
    shiftKey: true,
    description: 'Redo',
    action,
    preventDefault: true,
  }),
  commandPalette: (action: () => void): KeyboardShortcut => ({
    key: 'k',
    ctrlKey: true,
    description: 'Open command palette',
    action,
    preventDefault: true,
  }),
  escape: (action: () => void): KeyboardShortcut => ({
    key: 'Escape',
    description: 'Close/Cancel',
    action,
    preventDefault: false,
  }),
  delete: (action: () => void): KeyboardShortcut => ({
    key: 'Delete',
    description: 'Delete selected',
    action,
    preventDefault: true,
  }),
  backspace: (action: () => void): KeyboardShortcut => ({
    key: 'Backspace',
    description: 'Delete selected',
    action,
    preventDefault: true,
  }),
  search: (action: () => void): KeyboardShortcut => ({
    key: 'f',
    ctrlKey: true,
    description: 'Search',
    action,
    preventDefault: true,
  }),
  copy: (action: () => void): KeyboardShortcut => ({
    key: 'c',
    ctrlKey: true,
    description: 'Copy selected',
    action,
    preventDefault: true,
  }),
  paste: (action: () => void): KeyboardShortcut => ({
    key: 'v',
    ctrlKey: true,
    description: 'Paste',
    action,
    preventDefault: true,
  }),
  duplicate: (action: () => void): KeyboardShortcut => ({
    key: 'd',
    ctrlKey: true,
    description: 'Duplicate selected',
    action,
    preventDefault: true,
  }),
  selectAll: (action: () => void): KeyboardShortcut => ({
    key: 'a',
    ctrlKey: true,
    description: 'Select all',
    action,
    preventDefault: true,
  }),
};
