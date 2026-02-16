import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi, type Mock } from 'vitest';
import { ToastProvider } from '../../../../contexts/ToastContext';

// Hoisted mocks for use inside vi.mock factories
const { mockAnalyze, mockCanAutoApply, mockApplyQuickFix } = vi.hoisted(() => ({
  mockAnalyze: vi.fn().mockReturnValue([]),
  mockCanAutoApply: vi.fn().mockReturnValue(false),
  mockApplyQuickFix: vi.fn(),
}));

// Mock the linter from services
vi.mock('../../../../services/mission-control/services', () => ({
  linter: {
    analyze: mockAnalyze,
    canAutoApply: mockCanAutoApply,
    applyQuickFix: mockApplyQuickFix,
  },
}));

// Mock the Zustand store
vi.mock('../../../../store', () => ({
  __esModule: true,
  default: (selector: (s: any) => any) => {
    return selector({
      nodes: [],
      edges: [],
      setNodes: vi.fn(),
      setEdges: vi.fn(),
    });
  },
}));

// Mock feature flags
vi.mock('../../../../config/features', () => ({
  FeatureFlags: { CONNECT_WS: false, NEW_STREAMING: false, MULTIMODAL_UPLOAD: false, S3_STORAGE: false, CONTRACT_OVERLAY: false },
  isStreamWorkerEnabled: () => false,
}));

import IssuesPanel from '../IssuesPanel';

function renderWithProviders(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('IssuesPanel (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyze.mockReturnValue([]);
  });

  test('calls onCountChange with N issues from linter.analyze and displays Apply Fix button when fix is present', async () => {
    const issues = [
      {
        id: 'i1',
        kind: 'error',
        target: { type: 'node', id: 'n1' },
        rule: 'no-edges',
        message: 'No edges',
        fix: { id: 'f1', title: 'Open helper', action: 'open' },
      },
      {
        id: 'i2',
        kind: 'warning',
        target: { type: 'node', id: 'n2' },
        rule: 'isolated-node',
        message: 'Isolated',
      },
    ];
    mockAnalyze.mockReturnValue(issues);
    mockCanAutoApply.mockReturnValue(false);

    const onCountChange = vi.fn();
    renderWithProviders(<IssuesPanel onCountChange={onCountChange} />);

    // Wait for initial runLint to complete and onCountChange to be called
    await waitFor(() => {
      expect(onCountChange).toHaveBeenCalledWith(issues.length);
    });

    // Quick Fix button should render for the first issue (has fix, canAutoApply returns false)
    expect(screen.getByRole('button', { name: /Quick Fix/i })).toBeTruthy();
  });

  test('updates onCountChange when issues change after re-run', async () => {
    // First call returns 1 issue
    mockAnalyze.mockReturnValueOnce([
      {
        id: 'a1',
        kind: 'info',
        target: { type: 'node', id: 'n1' },
        rule: 'no-timeout',
        message: 'No timeout',
      },
    ]);

    const onCountChange = vi.fn();
    renderWithProviders(<IssuesPanel onCountChange={onCountChange} />);

    await waitFor(() => {
      expect(onCountChange).toHaveBeenCalledWith(1);
    });

    // Change mock to return 4 issues on next run
    mockAnalyze.mockReturnValueOnce(
      new Array(4).fill(0).map((_, i) => ({
        id: `b${i}`,
        kind: 'warning',
        target: { type: 'node', id: `n${i}` },
        rule: 'fanout-high',
        message: 'High fanout',
      }))
    );

    // Click the "Re-run" button
    const rerunBtn = screen.getByRole('button', { name: /Re-run/i });
    fireEvent.click(rerunBtn);

    await waitFor(() => {
      expect(onCountChange).toHaveBeenCalledWith(4);
    });
  });
});
