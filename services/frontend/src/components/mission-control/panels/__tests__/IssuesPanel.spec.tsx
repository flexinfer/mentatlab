import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Component under test
import IssuesPanel from '../IssuesPanel';

// Mock the linter and loadFlow imports used by IssuesPanel
jest.mock('services/frontend/src/services/mission-control/services', () => {
  return {
    __esModule: true,
    linter: {
      analyze: jest.fn(),
    },
  };
});
jest.mock('services/frontend/src/loadFlow', () => ({
  loadFlow: jest.fn(async () => ({
    apiVersion: 'v1',
    kind: 'Flow',
    meta: { id: 'example-flow', name: 'example', version: '1.0', createdAt: new Date().toISOString() },
    graph: { nodes: [], edges: [] },
  })),
}));

import { linter } from 'services/frontend/src/services/mission-control/services';
import { loadFlow } from 'services/frontend/src/loadFlow';

describe('IssuesPanel (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls onCountChange with N issues from linter.analyze and displays quick-fix title when present', async () => {
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
    (linter.analyze as jest.Mock).mockReturnValueOnce(issues);

    const onCountChange = jest.fn();
    render(<IssuesPanel onCountChange={onCountChange} />);

    // Wait for initial runLint to complete and onCountChange to be called
    await waitFor(() => {
      expect(onCountChange).toHaveBeenCalledWith(issues.length);
    });

    // Quick Fix button should render for the first issue (has fix)
    expect(screen.getByRole('button', { name: /Quick Fix/i })).toBeInTheDocument();
  });

  test('updates onCountChange when issues change after re-run (simulating lint refresh)', async () => {
    // First call returns 1 issue
    (linter.analyze as jest.Mock).mockReturnValueOnce([
      {
        id: 'a1',
        kind: 'info',
        target: { type: 'node', id: 'n1' },
        rule: 'no-timeout',
        message: 'No timeout',
      },
    ]);

    const onCountChange = jest.fn();
    render(<IssuesPanel onCountChange={onCountChange} />);

    await waitFor(() => {
      expect(onCountChange).toHaveBeenCalledWith(1);
    });

    // Change mock to return 4 issues on next run
    (linter.analyze as jest.Mock).mockReturnValueOnce(new Array(4).fill(0).map((_, i) => ({
      id: `b${i}`,
      kind: 'warning',
      target: { type: 'node', id: `n${i}` },
      rule: 'fanout-high',
      message: 'High fanout',
    })));

    // Click the "Re-run" button to simulate a lint trigger causing re-run
    const rerunBtn = screen.getByRole('button', { name: /Re-run/i });
    await userEvent.click(rerunBtn);

    await waitFor(() => {
      expect(onCountChange).toHaveBeenCalledWith(4);
    });
  });
});