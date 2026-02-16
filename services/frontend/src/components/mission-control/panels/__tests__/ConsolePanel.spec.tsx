import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ToastProvider } from '../../../../contexts/ToastContext';

// Mock useRunConsole hook to avoid real streaming
const mockApplyFilters = vi.fn();
const { mockItems, mockFiltered } = vi.hoisted(() => ({
  mockItems: { current: [] as any[] },
  mockFiltered: { current: [] as any[] },
}));

vi.mock('../console/useRunConsole', () => ({
  useRunConsole: () => ({
    items: mockItems.current,
    filtered: mockFiltered.current,
    nodes: [],
    applyFilters: mockApplyFilters,
    filters: { types: new Set(['log', 'checkpoint']), levels: new Set(['info']), nodeId: null, query: '' },
    autoscroll: true,
    setAutoscroll: vi.fn(),
    paused: false,
    setPaused: vi.fn(),
    clear: vi.fn(),
  }),
}));

// Mock ConsoleVirtualList to render items simply
vi.mock('../console/ConsoleVirtualList', () => ({
  ConsoleVirtualList: ({ items, onItemClick }: any) => (
    <ul data-testid="console-list">
      {items.map((item: any, i: number) => (
        <li key={item.id ?? i} id={`console-${item.id}`} onClick={() => onItemClick?.(item, i)}>
          {item.type}:{item.message ?? JSON.stringify(item.data)}
        </li>
      ))}
    </ul>
  ),
  formatTime: (ts: string) => new Date(ts).toLocaleTimeString(),
}));

// Mock feature flags
vi.mock('../../../../config/features', () => ({
  FeatureFlags: { CONNECT_WS: false, NEW_STREAMING: false, MULTIMODAL_UPLOAD: false, S3_STORAGE: false, CONTRACT_OVERLAY: false },
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

// Lazy import so mocks are in place
const loadConsolePanel = () => import('../ConsolePanel').then((m) => m.default);

describe('ConsolePanel (integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockItems.current = [];
    mockFiltered.current = [];
  });

  test('renders panel shell with Console title', async () => {
    const ConsolePanel = await loadConsolePanel();
    renderWithProviders(<ConsolePanel runId="run-1" />);

    expect(screen.getByText('Console')).toBeTruthy();
  });

  test('renders filtered items via ConsoleVirtualList', async () => {
    mockFiltered.current = [
      { id: 'e1', type: 'log', message: 'Hello world', ts: new Date().toISOString(), level: 'info' },
      { id: 'e2', type: 'checkpoint', message: 'CP1', ts: new Date().toISOString(), level: 'info' },
    ];
    mockItems.current = [...mockFiltered.current];

    const ConsolePanel = await loadConsolePanel();
    renderWithProviders(<ConsolePanel runId="run-1" />);

    expect(screen.getByText('log:Hello world')).toBeTruthy();
    expect(screen.getByText('checkpoint:CP1')).toBeTruthy();
  });

  test('shows event count in toolbar', async () => {
    mockFiltered.current = [
      { id: 'e1', type: 'log', message: 'a', ts: new Date().toISOString(), level: 'info' },
    ];
    mockItems.current = [
      ...mockFiltered.current,
      { id: 'e2', type: 'log', message: 'b', ts: new Date().toISOString(), level: 'debug' },
    ];

    const ConsolePanel = await loadConsolePanel();
    renderWithProviders(<ConsolePanel runId="run-1" />);

    // The component renders "{filtered.length}/{items.length}"
    expect(screen.getByText('1/2')).toBeTruthy();
  });
});
