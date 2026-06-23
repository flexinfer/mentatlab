import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Hoisted mocks
const { mockPolicies } = vi.hoisted(() => ({
  mockPolicies: {
    getViolations: vi.fn(() => []),
    getCost: vi.fn(() => 0),
    getBudget: vi.fn(() => undefined),
    checkBudget: vi.fn(() => ({ exceeded: false, usage: 0, limit: 0 })),
  },
}));

// Mock services
vi.mock('@/services/mission-control/services', () => ({
  policies: mockPolicies,
}));

// Mock cn utility
vi.mock('@/lib/cn', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

// Mock Badge
vi.mock('@/components/ui/Badge', () => ({
  __esModule: true,
  default: ({ children, variant }: any) => (
    <span data-testid={`badge-${variant || 'default'}`}>{children}</span>
  ),
  Badge: ({ children, variant }: any) => (
    <span data-testid={`badge-${variant || 'default'}`}>{children}</span>
  ),
}));

// Mock Input
vi.mock('@/components/ui/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

import PolicyOverlay from '../PolicyOverlay';

// Helper for creating violations
function makeViolation(overrides: Partial<any> = {}) {
  return {
    id: `violation-${Math.random().toString(36).slice(2)}`,
    timestamp: '2026-01-15T10:00:00Z',
    runId: 'run-1',
    nodeId: 'node-A',
    type: 'cost_exceeded',
    severity: 'high',
    message: 'Cost limit exceeded for node-A',
    action: 'warn',
    ...overrides,
  };
}

describe('PolicyOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPolicies.getViolations.mockReturnValue([]);
    mockPolicies.getCost.mockReturnValue(0);
    mockPolicies.getBudget.mockReturnValue(undefined);
    mockPolicies.checkBudget.mockReturnValue({ exceeded: false, usage: 0, limit: 0 });
  });

  test('shows "no policy data" message when runId is null', () => {
    render(<PolicyOverlay runId={null} onClose={vi.fn()} />);
    expect(screen.getByText(/No policy data available/)).toBeTruthy();
  });

  test('shows Close button in no-data state', () => {
    const onClose = vi.fn();
    render(<PolicyOverlay runId={null} onClose={onClose} />);
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('renders Policy Guardrails header when runId provided', () => {
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('Policy Guardrails')).toBeTruthy();
  });

  test('renders close button with aria-label', () => {
    const onClose = vi.fn();
    render(<PolicyOverlay runId="run-1" onClose={onClose} />);
    const closeBtn = screen.getByLabelText('Close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('closes when clicking backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(<PolicyOverlay runId="run-1" onClose={onClose} />);
    const backdrop = container.firstElementChild;
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('does not close when clicking dialog content', () => {
    const onClose = vi.fn();
    render(<PolicyOverlay runId="run-1" onClose={onClose} />);
    fireEvent.click(screen.getByText('Policy Guardrails'));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('shows "All Clear" badge when no violations exist', () => {
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('All Clear')).toBeTruthy();
  });

  test('shows "No Policy Violations" message when compliant', () => {
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('No Policy Violations')).toBeTruthy();
    expect(screen.getByText(/compliant with all configured policies/)).toBeTruthy();
  });

  test('shows critical count badge when critical violations exist', () => {
    mockPolicies.getViolations.mockReturnValue([
      makeViolation({ severity: 'critical', type: 'unsafe_content' }),
      makeViolation({ severity: 'critical', type: 'pii_detected' }),
    ]);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('2 Critical')).toBeTruthy();
  });

  test('shows high count badge when high severity violations exist', () => {
    mockPolicies.getViolations.mockReturnValue([
      makeViolation({ severity: 'high' }),
    ]);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('1 High')).toBeTruthy();
  });

  test('displays violation messages', () => {
    mockPolicies.getViolations.mockReturnValue([
      makeViolation({ message: 'Token budget exceeded for inference' }),
    ]);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('Token budget exceeded for inference')).toBeTruthy();
  });

  test('groups violations by type', () => {
    mockPolicies.getViolations.mockReturnValue([
      makeViolation({ type: 'cost_exceeded', message: 'Cost 1' }),
      makeViolation({ type: 'pii_detected', message: 'PII found' }),
    ]);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('Cost Exceeded')).toBeTruthy();
    expect(screen.getByText('PII Detected')).toBeTruthy();
  });

  test('shows violation severity badge', () => {
    mockPolicies.getViolations.mockReturnValue([
      makeViolation({ severity: 'critical' }),
    ]);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('critical')).toBeTruthy();
  });

  test('shows violation action label', () => {
    mockPolicies.getViolations.mockReturnValue([
      makeViolation({ action: 'block' }),
    ]);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('block')).toBeTruthy();
  });

  test('shows violation count in footer', () => {
    mockPolicies.getViolations.mockReturnValue([
      makeViolation(),
      makeViolation(),
      makeViolation(),
    ]);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    // Footer shows "3 violations"
    const footer = screen.getByText(/violations/);
    expect(footer).toBeTruthy();
  });

  test('shows cost in footer', () => {
    mockPolicies.getCost.mockReturnValue(0.1234);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText(/\$0\.1234/)).toBeTruthy();
  });

  test('shows truncated run ID in footer', () => {
    render(<PolicyOverlay runId="abcdefghijklmnop" onClose={vi.fn()} />);
    expect(screen.getByText(/Run ID: abcdefgh\.\.\./)).toBeTruthy();
  });

  test('shows Budget Envelope section', () => {
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('Budget Envelope')).toBeTruthy();
  });

  test('shows "No budget envelope configured" when no budget', () => {
    mockPolicies.getBudget.mockReturnValue(undefined);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText(/No budget envelope configured/)).toBeTruthy();
  });

  test('shows budget name and max cost when budget exists', () => {
    mockPolicies.getBudget.mockReturnValue({
      id: 'default',
      name: 'Production Budget',
      maxCost: 10.0,
    });
    mockPolicies.checkBudget.mockReturnValue({ exceeded: false, usage: 2.5, limit: 10.0 });
    mockPolicies.getCost.mockReturnValue(2.5);

    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('Production Budget')).toBeTruthy();
    expect(screen.getByText(/Max Cost: \$10\.00/)).toBeTruthy();
  });

  test('shows budget exceeded warning when over budget', () => {
    mockPolicies.getBudget.mockReturnValue({
      id: 'default',
      name: 'Test Budget',
      maxCost: 5.0,
    });
    mockPolicies.checkBudget.mockReturnValue({ exceeded: true, usage: 6.0, limit: 5.0 });
    mockPolicies.getCost.mockReturnValue(6.0);

    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText(/Budget exceeded!/)).toBeTruthy();
  });

  test('shows remediation suggestions for cost violations', () => {
    mockPolicies.getViolations.mockReturnValue([
      makeViolation({ type: 'cost_exceeded' }),
    ]);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText('Remediation Suggestions')).toBeTruthy();
    expect(screen.getByText(/optimizing model selection/)).toBeTruthy();
  });

  test('shows remediation suggestions for PII violations', () => {
    mockPolicies.getViolations.mockReturnValue([
      makeViolation({ type: 'pii_detected' }),
    ]);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText(/PII redaction/)).toBeTruthy();
  });

  test('does not show remediation section when no violations', () => {
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.queryByText('Remediation Suggestions')).toBeNull();
  });

  test('shows node ID in violation detail', () => {
    mockPolicies.getViolations.mockReturnValue([
      makeViolation({ nodeId: 'processing-node-7' }),
    ]);
    render(<PolicyOverlay runId="run-1" onClose={vi.fn()} />);
    expect(screen.getByText(/processing-node-7/)).toBeTruthy();
  });
});
