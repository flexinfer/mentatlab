import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, test, expect, beforeEach, vi, type Mock } from "vitest";
import RunsPanel from "../RunsPanel";

// Hoisted mocks for use inside vi.mock factories
const { mockOrchestratorService, mockCapturedHandlers, mockClose } = vi.hoisted(() => {
  const mockOrchestratorService = {
    createRun: vi.fn(),
    getRun: vi.fn(),
    cloneRun: vi.fn(),
    cancelRun: vi.fn(),
    streamRunEvents: vi.fn(),
  };

  const mockCapturedHandlers: any = {};
  const mockClose = vi.fn();

  return { mockOrchestratorService, mockCapturedHandlers, mockClose };
});

// Mock the orchestrator service
vi.mock("@/services/api", () => {
  return {
    orchestratorService: mockOrchestratorService,
  };
});

// Mock the orchestratorService module directly (RunsPanel may import from either path)
vi.mock("@/services/api/orchestratorService", () => {
  return {
    orchestratorService: mockOrchestratorService,
  };
});

// Mock feature flags
vi.mock("@/config/features", () => ({
  FeatureFlags: { CONNECT_WS: false, NEW_STREAMING: false, MULTIMODAL_UPLOAD: false, S3_STORAGE: false, CONTRACT_OVERLAY: false },
  isStreamWorkerEnabled: () => false,
}));

describe("RunsPanel (integration-ish)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // reset captured handlers
    for (const k of Object.keys(mockCapturedHandlers)) delete mockCapturedHandlers[k];

    // Default streamRunEvents to capture handlers
    mockOrchestratorService.streamRunEvents.mockImplementation((runId: string, handlers: any) => {
      mockCapturedHandlers[runId] = handlers;
      handlers.onOpen?.();
      return { close: mockClose };
    });
  });

  test("create run (redis) -> shows run and auto-connects SSE and handles events", async () => {
    // Arrange: mock createRun to return a runId
    (mockOrchestratorService.createRun as Mock).mockResolvedValue({ runId: "run-123" });
    (mockOrchestratorService.getRun as Mock).mockResolvedValue({
      id: "run-123",
      mode: "redis",
      createdAt: new Date().toISOString(),
      status: "queued",
    });
    render(<RunsPanel />);

    // Select mode 'redis'
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "redis" } });

    // Click "+ New Run" (button text changed from "Create Run")
    const createBtn = screen.getByRole("button", { name: /New Run/i });
    fireEvent.click(createBtn);

    // Wait for runId to appear in input (auto-populated)
    // Placeholder is "Run ID..." now
    await waitFor(() => {
      const input = screen.getByPlaceholderText("Run ID...") as HTMLInputElement;
      expect(input.value).toBe("run-123");
    });

    // Expect getRun was called
    expect(mockOrchestratorService.getRun).toHaveBeenCalledWith("run-123");

    // Expect streamRunEvents was called (connects SSE)
    expect(mockOrchestratorService.streamRunEvents).toHaveBeenCalled();

    // Simulate SSE checkpoint event
    const handlers = mockCapturedHandlers["run-123"];
    expect(handlers).toBeDefined();

    // Trigger a checkpoint event
    const cp = { id: "cp-1", runId: "run-123", ts: new Date().toISOString(), type: "progress", data: { percent: 10 } };
    handlers.onCheckpoint?.(cp);

    // The checkpoint should appear in the panel
    await waitFor(() => expect(screen.getByText("progress")).toBeTruthy());

    // Trigger status update
    handlers.onStatus?.({ runId: "run-123", status: "running" });
    // The run status text should update (may appear in badge + toast)
    await waitFor(() => expect(screen.getAllByText(/RUNNING/i).length).toBeGreaterThanOrEqual(1));
  }, 20000);

  test("Refresh button refreshes run details via getRun", async () => {
    (mockOrchestratorService.createRun as Mock).mockResolvedValue({ runId: "r" });
    (mockOrchestratorService.getRun as Mock).mockResolvedValue({
      id: "r",
      mode: "redis",
      createdAt: new Date().toISOString(),
      status: "queued",
    });

    render(<RunsPanel />);

    // create run quickly so input is populated
    const createBtn = screen.getByRole("button", { name: /New Run/i });
    fireEvent.click(createBtn);

    await waitFor(() => expect((screen.getByPlaceholderText("Run ID...") as HTMLInputElement).value).toBe("r"));

    const postBtn = screen.getByRole("button", { name: /Refresh/i });
    fireEvent.click(postBtn);

    await waitFor(() => expect(mockOrchestratorService.getRun).toHaveBeenCalledTimes(2));
  });

  test("cancel run calls cancelRun on the service", async () => {
    // Setup: populate run id
    (mockOrchestratorService.createRun as Mock).mockResolvedValue({ runId: "r2" });
    (mockOrchestratorService.getRun as Mock).mockResolvedValue({
      id: "r2",
      mode: "redis",
      createdAt: new Date().toISOString(),
      status: "running",
    });
    (mockOrchestratorService.cancelRun as Mock).mockResolvedValue({ status: "cancelled" });

    render(<RunsPanel />);

    const createBtn = screen.getByRole("button", { name: /New Run/i });
    fireEvent.click(createBtn);
    await waitFor(() => expect((screen.getByPlaceholderText("Run ID...") as HTMLInputElement).value).toBe("r2"));

    const cancelBtn = screen.getByRole("button", { name: /Cancel Run/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => expect(mockOrchestratorService.cancelRun).toHaveBeenCalledWith("r2"));
  });
});
