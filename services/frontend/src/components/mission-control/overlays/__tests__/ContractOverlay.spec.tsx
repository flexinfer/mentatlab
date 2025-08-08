import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractOverlay from '../ContractOverlay';

jest.useFakeTimers();

// Mock feature flags to enable the overlay
jest.mock('services/frontend/src/config/features', () => ({
  FeatureFlags: { CONTRACT_OVERLAY: true, CONNECT_WS: false },
}));

// Spyable applyQuickFix mock (dynamic import target)
const applyQuickFixMock = jest.fn().mockResolvedValue(undefined);

// Mock the mission-control services module that ContractOverlay dynamically imports.
// We export a `linter` with applyQuickFix so ContractOverlay can call it.
jest.mock('services/frontend/src/services/mission-control/services', () => {
  return {
    __esModule: true,
    linter: {
      applyQuickFix: applyQuickFixMock,
    },
  };
});

// Track how many times the store selector has been invoked so we can assert that
// the component responds to lint:trigger by re-rendering (selector re-invocation)
let storeCallCount = 0;
// We'll mutate `nodes`/`edges` within tests by replacing these arrays reference.
let nodes: any[] = [];
let edges: any[] = [];

// Mock the Zustand store hook used by the overlay. The overlay calls useStore(selector)
// twice (for nodes and edges) each render; this mock invokes the selector with
// an object and counts invocations.
jest.mock('services/frontend/src/store', () => {
  return {
    __esModule: true,
    default: (selector: (s: any) => any) => {
      storeCallCount++;
      // Provide a lightweight store shape
      return selector({ nodes, edges });
    },
  };
});

describe('ContractOverlay (integration)', () => {
  beforeEach(() => {
    // reset mocks and default small graph
    applyQuickFixMock.mockClear();
    storeCallCount = 0;
    nodes = [
      // no nodes by default to trigger "unknown pin type" issues when edges reference missing nodes
    ];
    edges = [];
  });

  test('renders hint elements and hover/popover with Apply/Dismiss that call applyQuickFix and show ephemeral banner', async () => {
    // Arrange: single edge that will produce an "unknown pin type" issue
    edges = [{ id: 'edge-1', source: 'n1', target: 'n2' }];

    const { container } = render(<ContractOverlay />);

    // Expect the dialog (overlay) to be present
    const dialog = await screen.findByRole('dialog', { name: /Contract issues/i });
    expect(dialog).toBeInTheDocument();

    // Badge should reflect number of issues (1)
    expect(screen.getByTitle(/1 issues/i)).toHaveTextContent('1');

    // The list should show our edge id
    expect(screen.getByText('edge-1')).toBeInTheDocument();

    // Hover to reveal the popover/tooltip
    await userEvent.hover(screen.getByText('edge-1'));

    // The popover contains reason text (Unknown pin type)
    expect(await screen.findByText(/Unknown pin type/i)).toBeInTheDocument();

    // Click "Apply fix" in the popover
    const applyBtn = screen.getAllByRole('button', { name: /Apply fix/i }).find((b) =>
      b.closest('[role="dialog"][aria-modal="false]') || b // pick the visible one
    ) ?? screen.getAllByRole('button', { name: /Apply fix/i })[0];
    // Better to query by text inside the popover: find the button that is visible near the reason
    const popoverApply = (await screen.findAllByText('Apply fix'))[0];
    await userEvent.click(popoverApply);

    // applyQuickFix should be called once
    await waitFor(() => expect(applyQuickFixMock).toHaveBeenCalledTimes(1));

    // Toast/banner should appear
    expect(screen.getByTestId('contract-overlay-toast')).toBeInTheDocument();
    expect(screen.getByTestId('contract-overlay-toast')).toHaveTextContent(/Applied/i);

    // Advance timers to allow toast to disappear (~2000ms)
    jest.advanceTimersByTime(2100);
    await waitFor(() => expect(screen.queryByTestId('contract-overlay-toast')).toBeNull());

    // Now test Dismiss: hover again, then click Dismiss and ensure the issue is removed
    await userEvent.hover(screen.getByText('edge-1'));
    const dismissBtn = (await screen.findAllByText('Dismiss'))[0];
    await userEvent.click(dismissBtn);

    // The issue list should no longer render the dismissed item
    await waitFor(() => expect(screen.queryByText('edge-1')).toBeNull());
  });

  test('enforces 200-item rendering cap when many issues exist', async () => {
    // Create 300 edges that reference missing nodes -> 300 issues generated; the overlay should cap to 200
    edges = Array.from({ length: 300 }).map((_, i) => ({ id: `edge-${i}`, source: `s${i}`, target: `t${i}` }));

    const { container } = render(<ContractOverlay />);

    const dialog = await screen.findByRole('dialog', { name: /Contract issues/i });
    expect(dialog).toBeInTheDocument();

    // Query list items within the overlay dialog only
    const listItems = dialog.querySelectorAll('li');
    expect(listItems.length).toBe(200);
  });

  test('listens to lint:trigger and re-invokes store selector (re-render)', async () => {
    // Start with one edge
    edges = [{ id: 'edge-xyz', source: 'a', target: 'b' }];

    render(<ContractOverlay />);

    const initialCalls = storeCallCount;
    // Dispatch lint:trigger custom event
    window.dispatchEvent(new CustomEvent('lint:trigger'));

    // Wait for a re-render to occur (selector to be called again)
    await waitFor(() => {
      expect(storeCallCount).toBeGreaterThan(initialCalls);
    });
  });
});