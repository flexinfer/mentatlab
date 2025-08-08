import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

test.describe('Orchestrator end-to-end (UI)', () => {
  // Increase timeout for orchestration startup
  test.setTimeout(5 * 60 * 1000);

  test.beforeAll(async () => {
    // Start orchestrator + redis via docker-compose if not already running.
    // This assumes a docker-compose.yml at repository root declares services 'orchestrator' and 'redis'.
    try {
      console.log('Bringing up orchestrator + redis via docker-compose...');
      execSync('docker-compose up --build -d orchestrator redis', { stdio: 'inherit' });
    } catch (err) {
      // If docker-compose fails, continue — test will fail later if orchestrator not available.
      console.warn('docker-compose up may have failed (or already running):', String(err));
    }

    // Poll the orchestrator ready endpoint until it responds 200 or timeout
    const readyUrl = 'http://localhost:7070/ready';
    const start = Date.now();
    const timeoutMs = 60_000;
    while (Date.now() - start < timeoutMs) {
      try {
        // Node 18+ has global fetch
        const res = await fetch(readyUrl, { method: 'GET' });
        if (res.ok) {
          console.log('Orchestrator is ready');
          return;
        }
      } catch {
        // ignore and retry
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('Orchestrator did not become ready within timeout');
  });

  test.afterAll(async () => {
    // Tear down the compose stack we started earlier.
    try {
      execSync('docker-compose down', { stdio: 'inherit' });
    } catch (err) {
      console.warn('docker-compose down failed (it may not be needed):', String(err));
    }
  });

  test('create → connect SSE → post checkpoint → cancel (Flows through UI)', async ({ page }) => {
    // Open the frontend (Playwright config webServer generally serves at 5173)
    await page.goto('http://localhost:5173/');

    // Wait for the page to render and the Bottom Dock to appear
    await expect(page.locator('text=Runs')).toBeVisible({ timeout: 30_000 });

    // Open Runs tab (the tab label is "Runs" added behind a feature flag)
    await page.locator('button:has-text("Runs")').click();

    // Select mode 'redis'
    const select = page.locator('select');
    await expect(select).toBeVisible();
    await select.selectOption('redis');

    // Click Create Run
    await page.locator('button:has-text("Create Run")').click();

    // Wait for the run id to be populated in the run id input
    const runInput = page.locator('input[placeholder="run id"]');
    await expect(runInput).toHaveValue(/.+/, { timeout: 10_000 });
    const runId = (await runInput.inputValue()).trim();
    expect(runId.length).toBeGreaterThan(0);

    // Click Connect to subscribe to SSE
    await page.locator('button:has-text("Connect")').click();

    // Wait for SSE to show connected (UI shows 'connected' text)
    await expect(page.locator('text=connected')).toBeVisible({ timeout: 10_000 });

    // Post a checkpoint
    await page.locator('button:has-text("Post progress checkpoint")').click();

    // Wait for a checkpoint entry with type 'progress' to appear
    await expect(page.locator('text=progress')).toBeVisible({ timeout: 10_000 });

    // Export button should be enabled; click Export to ensure it doesn't throw
    const exportBtn = page.locator('button:has-text("Export checkpoints (JSON)")');
    await expect(exportBtn).toBeEnabled();
    await exportBtn.click();

    // Cancel the run
    await page.locator('button:has-text("Cancel run")').click();

    // Expect status to change to canceled (UI shows the status text)
    await expect(page.locator('text=canceled')).toBeVisible({ timeout: 10_000 });

    // Refresh and connect again to verify replay behavior
    await page.reload();
    // Re-open Runs tab and enter run id again (if not auto populated)
    await page.locator('button:has-text("Runs")').click();
    await runInput.fill(runId);
    await page.locator('button:has-text("Connect")').click();

    // On reconnect, replay should emit recent checkpoints — assert at least one 'progress' visible again
    await expect(page.locator('text=progress')).toBeVisible({ timeout: 10_000 });
  });
});