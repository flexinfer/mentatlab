// Minimal Playwright E2E helpers for Gateway + Mission Control UI

export const GATEWAY_BASE =
  process.env.PLAYWRIGHT_GATEWAY_URL ||
  process.env.GATEWAY_URL ||
  'http://localhost:8080';

/**
 * createRunViaGateway
 * POSTs a minimal plan to Gateway and returns the created runId.
 * Accepts varying response shapes from different backends.
 */
export async function createRunViaGateway(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const plan = {
    nodes: [
      { id: 'n1', label: 'n1' },
    ],
    edges: []
  };

  const res = await request.post(`${GATEWAY_BASE}/api/v1/runs`, {
    headers: { 'content-type': 'application/json' },
    data: { plan },
    timeout: 30_000
  });
  if (!res.ok()) {
    throw new Error(`Failed to create run via Gateway: HTTP ${res.status()} ${await res.text()}`);
  }
  const body = await res.json().catch(() => ({} as any));
  // Accept common shapes:
  // { run: { id: '...' } } | { id: '...' } | { runId: '...' }
  const runId =
    body?.run?.id ||
    body?.id ||
    body?.runId;

  if (!runId || typeof runId !== 'string') {
    throw new Error(`Gateway createRun response missing runId; body=${JSON.stringify(body).slice(0, 500)}`);
  }
  return runId;
}

// Common selectors to keep specs concise
export const selectors = {
  // Bottom dock tabs
  graphTab: 'button:has-text("Graph")',
  consoleTab: 'button:has-text("Console")',
  runsTab: 'button:has-text("Runs")',

  // React Flow canvas (Graph panel)
  reactFlowCanvas: '.react-flow',

  // RunsPanel controls (if present)
  runsPanel: {
    createRunBtn: 'button:has-text("Create Run")',
    runIdInput: 'input[placeholder="run id"]',
    connectBtn: 'button:has-text("Connect")',
  },

  // Bottom dock "Start Orchestrator Run" (feature-gated by ORCHESTRATOR_PANEL)
  startOrchestratorBtn: 'button:has-text("Start Orchestrator Run")',
};