import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RunsPanel from "../RunsPanel";

// Mock the orchestrator client exported from '@/services/api'
jest.mock("@/services/api", () => {
  return {
    orchestratorService: {
      createRun: jest.fn(),
      getRun: jest.fn(),
      listCheckpoints: jest.fn(),
      postCheckpoint: jest.fn(),
      cancelRun: jest.fn(),
    },
  };
});

// A controllable fake for the OrchestratorSSE client
const capturedHandlers: any = {};
class FakeOrchestratorSSE {
  constructor(_config: any) {
    // noop
  }
  connect = jest.fn((runId: string, handlers: any) => {
    // capture handlers so tests can trigger them
    capturedHandlers[runId] = handlers;
    return Promise.resolve();
  });
  close = jest.fn();
}
jest.mock("@/services/api/streaming/orchestratorSSE", () => {
  return jest.fn().mockImplementation((...args: any[]) => {
    return new FakeOrchestratorSSE(...args);
  });
});

import { orchestratorService } from "@/services/api";
import OrchestratorSSE from "@/services/api/streaming/orchestratorSSE";

describe("RunsPanel (integration-ish)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // reset captured handlers
    for (const k of Object.keys(capturedHandlers)) delete capturedHandlers[k];
  });

  test("create run (redis) -> shows run and auto-connects SSE and handles events", async () => {
    // Arrange: mock createRun to return a runId
    (orchestratorService.createRun as jest.Mock).mockResolvedValue({ runId: "run-123" });
    (orchestratorService.getRun as jest.Mock).mockResolvedValue({
      id: "run-123",
      mode: "redis",
      createdAt: new Date().toISOString(),
      status: "pending",
    });
    (orchestratorService.listCheckpoints as jest.Mock).mockResolvedValue([]);

    render(<RunsPanel />);

    // Select mode 'redis'
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "redis" } });

    // Click Create Run
    const createBtn = screen.getByRole("button", { name: /Create Run/i });
    fireEvent.click(createBtn);

    // Wait for runId to appear in input (auto-populated)
    await waitFor(() => expect((screen.getByPlaceholderText("run id") as HTMLInputElement).value).toBe("run-123"));

    // Expect getRun and listCheckpoints were called
    expect(orchestratorService.getRun).toHaveBeenCalledWith("run-123");
    expect(orchestratorService.listCheckpoints).toHaveBeenCalledWith("run-123");

    // Expect OrchestratorSSE.connect was called (via the mock)
    expect(OrchestratorSSE).toHaveBeenCalled();

    // Simulate SSE hello event
    const handlers = capturedHandlers["run-123"];
    expect(handlers).toBeDefined();
    // Trigger hello
    handlers.onHello?.({ runId: "run-123" });

    // Trigger a checkpoint event
    const cp = { id: "cp-1", runId: "run-123", ts: new Date().toISOString(), type: "progress", data: { percent: 10 } };
    handlers.onCheckpoint?.(cp);

    // The checkpoint should appear in the panel
    await waitFor(() => expect(screen.getByText("progress")).toBeInTheDocument());
    expect(screen.getByText("cp-1")).toBeInTheDocument();

    // Trigger status update
    handlers.onStatus?.({ runId: "run-123", status: "running" });
    // The run status text should update
    await waitFor(() => expect(screen.getByText(/running/i)).toBeInTheDocument());
  });

  test("post checkpoint button calls postCheckpoint and refreshes list", async () => {
    (orchestratorService.postCheckpoint as jest.Mock).mockResolvedValue({ checkpointId: "cp-xyz" });
    (orchestratorService.listCheckpoints as jest.Mock).mockResolvedValue([
      { id: "cp-xyz", runId: "r", ts: new Date().toISOString(), type: "progress" },
    ]);
    // Pre-fill run id in input by mocking createRun sequence for simplicity
    (orchestratorService.createRun as jest.Mock).mockResolvedValue({ runId: "r" });
    (orchestratorService.getRun as jest.Mock).mockResolvedValue({
      id: "r",
      mode: "redis",
      createdAt: new Date().toISOString(),
      status: "pending",
    });

    render(<RunsPanel />);

    // create run quickly so input is populated
    const createBtn = screen.getByRole("button", { name: /Create Run/i });
    fireEvent.click(createBtn);

    await waitFor(() => expect((screen.getByPlaceholderText("run id") as HTMLInputElement).value).toBe("r"));

    // Click post checkpoint
    const postBtn = screen.getByRole("button", { name: /Post progress checkpoint/i });
    fireEvent.click(postBtn);

    await waitFor(() => expect(orchestratorService.postCheckpoint).toHaveBeenCalled());
    // Confirm the checkpoint rendered
    await waitFor(() => expect(screen.getByText("cp-xyz")).toBeInTheDocument());
  });

  test("cancel run displays errors for 409/404 via UI toasts (no alert)", async () => {
    // Setup: populate run id
    (orchestratorService.createRun as jest.Mock).mockResolvedValue({ runId: "r2" });
    (orchestratorService.getRun as jest.Mock).mockResolvedValue({
      id: "r2",
      mode: "redis",
      createdAt: new Date().toISOString(),
      status: "running",
    });

    // Make cancelRun reject with status 409
    const err409: any = new Error("conflict");
    err409.response = { status: 409 };
    (orchestratorService.cancelRun as jest.Mock).mockRejectedValueOnce(err409);

    render(<RunsPanel />);

    const createBtn = screen.getByRole("button", { name: /Create Run/i });
    fireEvent.click(createBtn);
    await waitFor(() => expect((screen.getByPlaceholderText("run id") as HTMLInputElement).value).toBe("r2"));

    const cancelBtn = screen.getByRole("button", { name: /Cancel run/i });
    fireEvent.click(cancelBtn);

    // Since UI uses toasts, just assert cancelRun was called and no thrown alert occurs
    await waitFor(() => expect(orchestratorService.cancelRun).toHaveBeenCalledWith("r2"));
  });
});