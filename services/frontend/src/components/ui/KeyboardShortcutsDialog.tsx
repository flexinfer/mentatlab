import React from 'react';
import { categorizeShortcuts, type KeyboardShortcut } from '@/hooks/useKeyboardShortcuts';
import { cn } from '@/lib/cn';

interface KeyboardShortcutsDialogProps {
  shortcuts: KeyboardShortcut[];
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Dialog displaying all keyboard shortcuts grouped by category
 */
export function KeyboardShortcutsDialog({ shortcuts, isOpen, onClose }: KeyboardShortcutsDialogProps) {
  if (!isOpen) return null;

  const categories = categorizeShortcuts(shortcuts);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[80vh] bg-card rounded-lg shadow-xl border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/50">
          <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto max-h-[calc(80vh-80px)] p-6">
          {Array.from(categories.values()).map((category) => (
            <div key={category.name} className="mb-8 last:mb-0">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-3">
                {category.name}
              </h3>
              <div className="space-y-2">
                {category.shortcuts.map((shortcut, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-2 px-3 rounded hover:bg-muted/40"
                  >
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {shortcut.description}
                    </span>
                    <kbd className={cn(
                      "inline-flex items-center gap-1 px-2 py-1 text-xs font-mono",
                      "bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600",
                      "rounded shadow-sm"
                    )}>
                      {shortcut.displayKey}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t bg-muted/30 text-xs text-gray-600 dark:text-gray-400 text-center">
          Press <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 border rounded text-[10px]">?</kbd> to toggle this dialog
        </div>
      </div>
    </div>
  );
}
