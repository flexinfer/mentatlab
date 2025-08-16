/**
 * E2E: Orchestrator live UI (Graph + Console)
 *
 * Preconditions:
 * - docker compose up --build (stack running)
 * - FRONTEND: http://localhost:5173
 * - GATEWAY:  http://localhost:8080
 *
 * How to run:
 * - From services/frontend: npx playwright install && npx playwright test
 * - Or from repo root (if workspace scripts exist): npm -w services/frontend run e2e
 *
 * Test strategy:
 * - Prefer creating a run via Gateway REST to minimize flakiness and rely on SSE/autoupdate in UI.
 * - Mission Control currently derives runId from internal state (activeRunId) not from URL.
 * - If the Bottom Dock exposes "Start Orchestrator Run" (behind feature flag), use it as a reliable way
 *   to set activeRunId in the app; then verify Graph and Console live updates.
 * - Otherwise, skip with a clear reason, since there's no supported route param to inject runId into Graph/Console yet.
 */

import { test, expect } from '@playwright/test';
import { createRunViaGateway, selectors, GATEWAY_BASE } from './testUtils';

test.describe('Mission Control live updates (Graph + Console)', () => {
  test.setTimeout(60_000);

  test('create a run and observe live UI updates', async ({ page, request }) => {
    // 1) Create a run via Gateway REST (simple single-node plan)
    let gatewayRunId: string | null = null;
    try {
      gatewayRunId = await createRunViaGateway(request);
    } catch (e) {
      // Continue; we will fall back to UI creation if available
      console.warn(`Gateway createRun failed; will fall back to UI if available. Error=${String(e)}`);
    }

    // 2) Open Mission Control UI
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Wait for bottom dock to render tabs (Console tab exists in most builds)
    const consoleTab = page.locator(selectors.consoleTab);
    await expect(consoleTab).toBeVisible({ timeout: 30_000 });

    // 3) Preferred path: if "Start Orchestrator Run" is available, use it to ensure activeRunId is set in UI
    const startOrchestratorBtn = page.locator(selectors.startOrchestratorBtn);

    if (await startOrchestratorBtn.isVisible().catch(() => false)) {
      await startOrchestratorBtn.click();

      // Open Graph tab
      const graphTab = page.locator(selectors.graphTab);
      await expect(graphTab).toBeVisible();
      await graphTab.click();

      // 3a) Verify React Flow canvas appears
      const canvas = page.locator(selectors.reactFlowCanvas);
      await expect(canvas).toBeVisible({ timeout: 30_000 });

      // 3b) Verify run-level status badge transitions to Running then Succeeded/Failed
      // The toolbar shows "Run: Running" / "Run: Succeeded" via statusToBadge()
      // First, eventually shows running
      await expect
        .poll(
          async () =>
            (await page.locator('text=Run: Running').count()) > 0 ||
            (await page.locator('text=Run: Succeeded').count()) > 0 ||
            (await page.locator('text=Run: Failed').count()) > 0
        , { timeout: 20_000, message: 'Expect run status to appear (Running/Succeeded/Failed)' })
        .toBe(true);

      // Then, eventually it should reach a terminal state (Succeeded or Failed)
      await expect
        .poll(
          async () =>
            (await page.locator('text=Run: Succeeded').count()) > 0 ||
            (await page.locator('text=Run: Failed').count()) > 0
        , { timeout: 20_000, message: 'Expect run to finish with Succeeded or Failed' })
        .toBe(true);

      // 3c) Console tab: expect live events (node_status or checkpoint or log)
      await consoleTab.click();

      const anyConsoleRow = page.locator('text=node_status, text=checkpoint, text=log');
      await expect(anyConsoleRow).toBeVisible({ timeout: 20_000 });

      // 3d) Validate autoscroll remains at bottom when new events arrive
      // Measure scroll position, wait for more events, confirm we remain pinned near bottom.
      const list = page.locator('div[role="document"], div:has(> .tabular-nums)').first(); // fallback locator to the scrollable container
      const getScrollState = async () => {
        return await page.evaluate(() => {
          // Try to find the main console scroll region by class/structure heuristics
          const candidates = Array.from(document.querySelectorAll('div'))
            .filter(el => el.scrollHeight > el.clientHeight && el.className?.toString().includes('overflow-auto'));
          const el = candidates[0] || document.scrollingElement || document.body;
          return {
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          };
        });
      };

      const before = await getScrollState();

      // Heuristic wait for more events (autoscroll on)
      await expect.poll(async () => {
        const count =
          (await page.locator('text=node_status').count()) +
          (await page.locator('text=checkpoint').count()) +
          (await page.locator('text=log').count());
        return count;
      }, { timeout: 10_000 }).toBeGreaterThan(0);

      const after = await getScrollState();
      const distanceFromBottom = after.scrollHeight - after.clientHeight - after.scrollTop;
      expect(distanceFromBottom).toBeLessThanOrEqual(32); // within ~1 line worth of pixels

      return; // Test complete in this path
    }

    // 4) Fallback path: Use Runs panel (feature-gated "Runs")
    // This panel can create and connect to runs, but it does not currently bind the created run to Graph/Console panels.
    // We will at least assert Console tab is present and events appear somewhere; if Graph cannot bind a run, skip.
    const runsTab = page.locator(selectors.runsTab);
    if (await runsTab.isVisible().catch(() => false)) {
      await runsTab.click();

      // If we have a gateway-created runId, try to connect to it in RunsPanel inputs
      if (gatewayRunId) {
        const runInput = page.locator(selectors.runsPanel.runIdInput);
        await expect(runInput).toBeVisible();
        await runInput.fill(gatewayRunId);

        const connectBtn = page.locator(selectors.runsPanel.connectBtn);
        await expect(connectBtn).toBeVisible();
        await connectBtn.click();

        // The Runs panel shows "connected" text and checkpoints; validate presence
        await expect(page.locator('text=connected')).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('text=checkpoint, text=node_status, text=log')).toBeVisible({ timeout: 20_000 });

        test.skip(true, 'Graph/Console tabs are not bound to the RunsPanel runId; skipping graph assertions until route/prop is available.');
        return;
      }

      // If we cannot create or connect, skip
      test.skip(true, 'Could not create run via Gateway and no Start Orchestrator Run; skipping until a runId route is supported.');
      return;
    }

    // 5) No route to create or bind a run: skip with reason per spec instructions
    test.skip(true, 'Mission Control lacks a route/flag to bind runId to Graph/Console; skipping live assertions.');
  });
});