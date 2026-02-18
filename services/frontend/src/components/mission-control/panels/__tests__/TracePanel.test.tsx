import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, test, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockGetTrace, mockGetTraceForRun } = vi.hoisted(() => ({
  mockGetTrace: vi.fn(),
  mockGetTraceForRun: vi.fn(),
}));

vi.mock('@/services/api/traceService', () => ({
  traceService: {
    getTrace: (...args: any[]) => mockGetTrace(...args),
    getTraceForRun: (...args: any[]) => mockGetTraceForRun(...args),
  },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

// Mock UI components to simplify rendering
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div data-testid="card" {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div data-testid="card-header" {...props}>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button data-testid="fetch-button" onClick={onClick} {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/Input', () => ({
  Input: ({ onChange, onKeyDown, value, placeholder, ...props }: any) => (
    <input
      data-testid="trace-input"
      onChange={onChange}
      onKeyDown={onKeyDown}
      value={value}
      placeholder={placeholder}
    />
  ),
}));

// Import after mocks
import TracePanel from '../TracePanel';
import type { TraceData, TraceSpan } from '@/services/api/traceService';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
  return {
    traceID: 'trace-1',
    spanID: overrides.spanID ?? 'span-1',
    operationName: overrides.operationName ?? 'TestOp',
    serviceName: overrides.serviceName ?? 'orchestrator',
    startTime: overrides.startTime ?? 1000000,
    duration: overrides.duration ?? 5000,
    status: overrides.status ?? 'ok',
    tags: overrides.tags ?? {},
    parentSpanID: overrides.parentSpanID,
    children: overrides.children,
  };
}

function makeTraceData(overrides: Partial<TraceData> = {}): TraceData {
  const rootSpan = makeSpan({
    spanID: 'root',
    operationName: 'StartRun',
    children: [
      makeSpan({ spanID: 'child-1', operationName: 'ScheduleNode', parentSpanID: 'root', startTime: 1001000, duration: 3000 }),
      makeSpan({ spanID: 'child-2', operationName: 'EmitEvent', parentSpanID: 'root', startTime: 1002000, duration: 1000 }),
    ],
  });
  return {
    traceID: overrides.traceID ?? 'trace-1',
    spans: overrides.spans ?? [
      rootSpan,
      ...(rootSpan.children ?? []),
    ],
    rootSpan: overrides.rootSpan ?? rootSpan,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TracePanel', () => {
  // ---- Empty / initial state ----

  test('renders empty state when no traceId or runId', () => {
    render(<TracePanel />);
    expect(screen.getByText(/enter a trace id/i)).toBeInTheDocument();
  });

  test('renders trace input and fetch button', () => {
    render(<TracePanel />);
    expect(screen.getByTestId('trace-input')).toBeInTheDocument();
    expect(screen.getByTestId('fetch-button')).toBeInTheDocument();
  });

  // ---- Loading state ----

  test('shows loading indicator while fetching', async () => {
    // Never resolve — keeps loading state
    mockGetTrace.mockReturnValue(new Promise(() => {}));

    render(<TracePanel traceId="abc" />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  // ---- Error state ----

  test('displays error message when fetch fails', async () => {
    mockGetTrace.mockRejectedValue(new Error('Tempo unavailable'));

    render(<TracePanel traceId="bad-id" />);

    await waitFor(() => {
      expect(screen.getByText(/tempo unavailable/i)).toBeInTheDocument();
    });
  });

  test('displays error when trace has no spans', async () => {
    mockGetTrace.mockResolvedValue({ traceID: 'x', spans: [], rootSpan: undefined });

    render(<TracePanel traceId="empty" />);

    await waitFor(() => {
      expect(screen.getByText(/no spans found/i)).toBeInTheDocument();
    });
  });

  // ---- Successful trace rendering ----

  test('renders span rows after successful fetch', async () => {
    const data = makeTraceData();
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" />);

    await waitFor(() => {
      expect(screen.getByText('StartRun')).toBeInTheDocument();
      expect(screen.getByText('ScheduleNode')).toBeInTheDocument();
      expect(screen.getByText('EmitEvent')).toBeInTheDocument();
    });
  });

  test('renders service names for each span', async () => {
    const data = makeTraceData();
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" />);

    await waitFor(() => {
      const serviceLabels = screen.getAllByText('orchestrator');
      expect(serviceLabels.length).toBeGreaterThanOrEqual(3); // root + 2 children
    });
  });

  test('renders span count and total duration', async () => {
    const data = makeTraceData();
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" />);

    await waitFor(() => {
      expect(screen.getByText(/3 spans/)).toBeInTheDocument();
    });
  });

  test('renders column headers', async () => {
    const data = makeTraceData();
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" />);

    await waitFor(() => {
      expect(screen.getByText(/service \/ operation/i)).toBeInTheDocument();
      expect(screen.getByText('Timeline')).toBeInTheDocument();
    });
  });

  // ---- Span selection and detail pane ----

  test('shows span detail pane when a span is clicked', async () => {
    const data = makeTraceData();
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" />);

    await waitFor(() => {
      expect(screen.getByText('StartRun')).toBeInTheDocument();
    });

    // Click on the StartRun span row (it's a button)
    const startRunLabel = screen.getByText('StartRun');
    const spanButton = startRunLabel.closest('button');
    expect(spanButton).toBeTruthy();
    fireEvent.click(spanButton!);

    // Detail pane should appear with span info
    await waitFor(() => {
      expect(screen.getByText('Operation:')).toBeInTheDocument();
      expect(screen.getByText('Service:')).toBeInTheDocument();
      expect(screen.getByText('Duration:')).toBeInTheDocument();
      expect(screen.getByText('Span ID:')).toBeInTheDocument();
    });
  });

  test('shows span attributes in detail pane', async () => {
    const rootSpan = makeSpan({
      spanID: 'root',
      operationName: 'StartRun',
      tags: { run_id: 'run-123', node_count: '5' },
      children: [],
    });
    const data: TraceData = {
      traceID: 'trace-1',
      spans: [rootSpan],
      rootSpan,
    };
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" />);

    await waitFor(() => {
      expect(screen.getByText('StartRun')).toBeInTheDocument();
    });

    const spanButton = screen.getByText('StartRun').closest('button');
    fireEvent.click(spanButton!);

    await waitFor(() => {
      expect(screen.getByText('Attributes')).toBeInTheDocument();
      expect(screen.getByText('run_id:')).toBeInTheDocument();
      expect(screen.getByText('run-123')).toBeInTheDocument();
    });
  });

  // ---- Auto-fetch on prop changes ----

  test('fetches by traceId when traceId prop is provided', async () => {
    const data = makeTraceData();
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" />);

    await waitFor(() => {
      expect(mockGetTrace).toHaveBeenCalledWith('trace-1');
    });
  });

  test('fetches by runId when only runId prop is provided', async () => {
    const data = makeTraceData();
    mockGetTraceForRun.mockResolvedValue(data);

    render(<TracePanel runId="run-abc" />);

    await waitFor(() => {
      expect(mockGetTraceForRun).toHaveBeenCalledWith('run-abc');
    });
  });

  test('prefers traceId over runId when both are provided', async () => {
    const data = makeTraceData();
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" runId="run-abc" />);

    await waitFor(() => {
      expect(mockGetTrace).toHaveBeenCalledWith('trace-1');
      expect(mockGetTraceForRun).not.toHaveBeenCalled();
    });
  });

  // ---- Manual fetch ----

  test('manual fetch via button click', async () => {
    const data = makeTraceData();
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel />);

    const input = screen.getByTestId('trace-input');
    fireEvent.change(input, { target: { value: 'manual-trace-id' } });

    const fetchBtn = screen.getByTestId('fetch-button');
    fireEvent.click(fetchBtn);

    await waitFor(() => {
      expect(mockGetTrace).toHaveBeenCalledWith('manual-trace-id');
    });
  });

  test('manual fetch via Enter key', async () => {
    const data = makeTraceData();
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel />);

    const input = screen.getByTestId('trace-input');
    fireEvent.change(input, { target: { value: 'enter-trace-id' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(mockGetTrace).toHaveBeenCalledWith('enter-trace-id');
    });
  });

  test('does not fetch when input is empty', () => {
    render(<TracePanel />);

    const fetchBtn = screen.getByTestId('fetch-button');
    fireEvent.click(fetchBtn);

    expect(mockGetTrace).not.toHaveBeenCalled();
    expect(mockGetTraceForRun).not.toHaveBeenCalled();
  });

  test('trims whitespace from manual trace ID', async () => {
    const data = makeTraceData();
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel />);

    const input = screen.getByTestId('trace-input');
    fireEvent.change(input, { target: { value: '  spaced-id  ' } });

    const fetchBtn = screen.getByTestId('fetch-button');
    fireEvent.click(fetchBtn);

    await waitFor(() => {
      expect(mockGetTrace).toHaveBeenCalledWith('spaced-id');
    });
  });

  // ---- Duration formatting ----

  test('formats microsecond durations', async () => {
    const rootSpan = makeSpan({
      spanID: 'root',
      operationName: 'FastOp',
      duration: 500, // 500us
      children: [],
    });
    const data: TraceData = {
      traceID: 'trace-1',
      spans: [rootSpan],
      rootSpan,
    };
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" />);

    await waitFor(() => {
      expect(screen.getByText('500us')).toBeInTheDocument();
    });
  });

  test('formats millisecond durations', async () => {
    const rootSpan = makeSpan({
      spanID: 'root',
      operationName: 'MediumOp',
      duration: 5000, // 5ms
      children: [],
    });
    const data: TraceData = {
      traceID: 'trace-1',
      spans: [rootSpan],
      rootSpan,
    };
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" />);

    await waitFor(() => {
      expect(screen.getByText('5.0ms')).toBeInTheDocument();
    });
  });

  test('formats second durations', async () => {
    const rootSpan = makeSpan({
      spanID: 'root',
      operationName: 'SlowOp',
      duration: 2_500_000, // 2.5s
      children: [],
    });
    const data: TraceData = {
      traceID: 'trace-1',
      spans: [rootSpan],
      rootSpan,
    };
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" />);

    await waitFor(() => {
      expect(screen.getByText('2.50s')).toBeInTheDocument();
    });
  });

  // ---- Error span styling ----

  test('renders error span with error status text', async () => {
    const rootSpan = makeSpan({
      spanID: 'root',
      operationName: 'FailedOp',
      status: 'error',
      children: [],
    });
    const data: TraceData = {
      traceID: 'trace-1',
      spans: [rootSpan],
      rootSpan,
    };
    mockGetTrace.mockResolvedValue(data);

    render(<TracePanel traceId="trace-1" />);

    await waitFor(() => {
      expect(screen.getByText('FailedOp')).toBeInTheDocument();
    });

    // Click to open detail and check status
    const spanButton = screen.getByText('FailedOp').closest('button');
    fireEvent.click(spanButton!);

    await waitFor(() => {
      expect(screen.getByText('error')).toBeInTheDocument();
    });
  });
});
