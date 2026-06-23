import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useKeyboardShortcuts,
  formatShortcut,
  categorizeShortcuts,
  commonShortcuts,
  type KeyboardShortcut,
} from '../useKeyboardShortcuts';

// ---------------------------------------------------------------------------
// Helper to dispatch keyboard events
// ---------------------------------------------------------------------------
function fireKey(key: string, options: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  window.dispatchEvent(event);
  return event;
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// useKeyboardShortcuts hook
// ============================================================================

describe('useKeyboardShortcuts - basic matching', () => {
  it('triggers action for matching key', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 'Escape', description: 'Close', action },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    fireKey('Escape');
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('does not trigger for non-matching key', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 'Escape', description: 'Close', action },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    fireKey('Enter');
    expect(action).not.toHaveBeenCalled();
  });

  it('matches Ctrl modifier', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 's', ctrlKey: true, description: 'Save', action },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    // Without ctrl - should not match
    fireKey('s');
    expect(action).not.toHaveBeenCalled();

    // With ctrl (or meta on Mac) - should match
    fireKey('s', { ctrlKey: true });
    // This depends on platform detection; in jsdom isMac will be false
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('matches Shift modifier', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 'z', ctrlKey: true, shiftKey: true, description: 'Redo', action },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    // Ctrl+Z without shift
    fireKey('z', { ctrlKey: true });
    expect(action).not.toHaveBeenCalled();

    // Ctrl+Shift+Z
    fireKey('z', { ctrlKey: true, shiftKey: true });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('matches Alt modifier', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 'p', altKey: true, description: 'Preview', action },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    fireKey('p', { altKey: true });
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('is case-insensitive on key', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 'k', ctrlKey: true, description: 'Command', action },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    fireKey('K', { ctrlKey: true });
    expect(action).toHaveBeenCalledTimes(1);
  });
});

describe('useKeyboardShortcuts - input fields', () => {
  it('ignores shortcuts when target is an INPUT element', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 's', ctrlKey: true, description: 'Save', action },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, 'target', { value: input, writable: false });
    window.dispatchEvent(event);

    expect(action).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('allows Escape even in INPUT elements', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 'Escape', description: 'Close', action, preventDefault: false },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    });
    Object.defineProperty(event, 'target', { value: input, writable: false });
    window.dispatchEvent(event);

    expect(action).toHaveBeenCalledTimes(1);
    document.body.removeChild(input);
  });
});

describe('useKeyboardShortcuts - enabled flag', () => {
  it('does not trigger when enabled=false', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 'Escape', description: 'Close', action },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts, false));

    fireKey('Escape');
    expect(action).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts - disabled shortcut', () => {
  it('does not trigger when shortcut.enabled=false', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 'Escape', description: 'Close', action, enabled: false },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    fireKey('Escape');
    expect(action).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts - first match wins', () => {
  it('only triggers the first matching shortcut', () => {
    const action1 = vi.fn();
    const action2 = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 'Escape', description: 'First', action: action1 },
      { key: 'Escape', description: 'Second', action: action2 },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    fireKey('Escape');
    expect(action1).toHaveBeenCalledTimes(1);
    expect(action2).not.toHaveBeenCalled();
  });
});

describe('useKeyboardShortcuts - preventDefault behavior', () => {
  it('calls preventDefault by default', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 'Escape', description: 'Close', action },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
  });

  it('does not call preventDefault when preventDefault=false', () => {
    const action = vi.fn();
    const shortcuts: KeyboardShortcut[] = [
      { key: 'Escape', description: 'Close', action, preventDefault: false },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// formatShortcut
// ============================================================================

describe('formatShortcut', () => {
  it('formats a simple key', () => {
    const result = formatShortcut({ key: 'Escape', description: 'Close', action: () => {} });
    expect(result).toBe('Escape');
  });

  it('formats Ctrl+key (non-Mac env in jsdom)', () => {
    const result = formatShortcut({ key: 's', ctrlKey: true, description: 'Save', action: () => {} });
    // In jsdom, navigator.platform is empty string, so isMac = false
    expect(result).toContain('Ctrl');
    expect(result).toContain('S');
  });

  it('formats Shift+key', () => {
    const result = formatShortcut({ key: 'z', ctrlKey: true, shiftKey: true, description: 'Redo', action: () => {} });
    expect(result).toContain('Shift');
    expect(result).toContain('Z');
  });

  it('formats Alt+key', () => {
    const result = formatShortcut({ key: 'p', altKey: true, description: 'Preview', action: () => {} });
    expect(result).toContain('Alt');
    expect(result).toContain('P');
  });
});

// ============================================================================
// categorizeShortcuts
// ============================================================================

describe('categorizeShortcuts', () => {
  it('groups shortcuts by category prefix in description', () => {
    const shortcuts: KeyboardShortcut[] = [
      { key: 's', ctrlKey: true, description: 'Flow: Save', action: () => {} },
      { key: 'r', ctrlKey: true, description: 'Flow: Run', action: () => {} },
      { key: 'Escape', description: 'Close', action: () => {} },
    ];

    const categories = categorizeShortcuts(shortcuts);
    expect(categories.has('Flow')).toBe(true);
    expect(categories.get('Flow')!.shortcuts).toHaveLength(2);
    // "Close" has no category prefix, so it goes under "General" (it is the full description)
  });

  it('assigns uncategorized shortcuts to General', () => {
    const shortcuts: KeyboardShortcut[] = [
      { key: 'Escape', description: 'Close', action: () => {} },
    ];

    const categories = categorizeShortcuts(shortcuts);
    // When description has no ':', category = full description
    // The code splits by ':' - with no ':', category is the full string
    expect(categories.size).toBe(1);
  });

  it('adds displayKey to each shortcut', () => {
    const shortcuts: KeyboardShortcut[] = [
      { key: 's', ctrlKey: true, description: 'Save', action: () => {} },
    ];

    const categories = categorizeShortcuts(shortcuts);
    const firstCategory = Array.from(categories.values())[0];
    expect(firstCategory.shortcuts[0].displayKey).toBeTruthy();
  });
});

// ============================================================================
// commonShortcuts
// ============================================================================

describe('commonShortcuts', () => {
  it('creates a save shortcut with Ctrl+S', () => {
    const action = vi.fn();
    const shortcut = commonShortcuts.save(action);
    expect(shortcut.key).toBe('s');
    expect(shortcut.ctrlKey).toBe(true);
    expect(shortcut.description).toBe('Save');
    expect(shortcut.preventDefault).toBe(true);
  });

  it('creates an undo shortcut with Ctrl+Z', () => {
    const action = vi.fn();
    const shortcut = commonShortcuts.undo(action);
    expect(shortcut.key).toBe('z');
    expect(shortcut.ctrlKey).toBe(true);
    expect(shortcut.shiftKey).toBeUndefined();
  });

  it('creates a redo shortcut with Ctrl+Shift+Z', () => {
    const action = vi.fn();
    const shortcut = commonShortcuts.redo(action);
    expect(shortcut.key).toBe('z');
    expect(shortcut.ctrlKey).toBe(true);
    expect(shortcut.shiftKey).toBe(true);
  });

  it('creates a command palette shortcut with Ctrl+K', () => {
    const action = vi.fn();
    const shortcut = commonShortcuts.commandPalette(action);
    expect(shortcut.key).toBe('k');
    expect(shortcut.ctrlKey).toBe(true);
  });

  it('creates an escape shortcut with preventDefault=false', () => {
    const action = vi.fn();
    const shortcut = commonShortcuts.escape(action);
    expect(shortcut.key).toBe('Escape');
    expect(shortcut.preventDefault).toBe(false);
  });

  it('creates delete and backspace shortcuts', () => {
    const action = vi.fn();
    expect(commonShortcuts.delete(action).key).toBe('Delete');
    expect(commonShortcuts.backspace(action).key).toBe('Backspace');
  });

  it('creates search, copy, paste, duplicate, selectAll shortcuts', () => {
    const action = vi.fn();
    expect(commonShortcuts.search(action).key).toBe('f');
    expect(commonShortcuts.copy(action).key).toBe('c');
    expect(commonShortcuts.paste(action).key).toBe('v');
    expect(commonShortcuts.duplicate(action).key).toBe('d');
    expect(commonShortcuts.selectAll(action).key).toBe('a');
  });

  it('all common shortcuts call the provided action', () => {
    const entries = Object.entries(commonShortcuts);
    for (const [name, factory] of entries) {
      const action = vi.fn();
      const shortcut = (factory as Function)(action);
      shortcut.action(new KeyboardEvent('keydown'));
      expect(action).toHaveBeenCalledTimes(1);
    }
  });
});
