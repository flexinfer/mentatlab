import { test, expect } from '@playwright/test';

/**
 * M16 Visual QA Snapshot Tests
 *
 * Captures screenshots of key runtime states to prevent visual regressions
 * after the M16 UI modernization (issues #43–#48).
 *
 * States captured:
 * - Offline/disconnected: default load, no backend
 * - Mission Control layout: canvas + panels visible
 * - Dark mode: theme token changes applied
 *
 * Run with:  npx playwright test e2e/visual-qa-m16.spec.ts --update-snapshots
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

test.describe('M16 Visual QA Baseline', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app root
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  });

  test('mission-control layout loads without errors', async ({ page }) => {
    // Verify the main layout container renders
    await expect(page.locator('body')).toBeVisible();

    // No uncaught errors in console
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForTimeout(1000);
    expect(errors).toHaveLength(0);
  });

  test('screenshot: default offline state', async ({ page }) => {
    await page.waitForTimeout(500); // Let CSS settle
    await expect(page).toHaveScreenshot('m16-offline-state.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });

  test('screenshot: dark mode', async ({ page }) => {
    // Toggle dark mode via keyboard shortcut (Cmd+T)
    await page.keyboard.press('Meta+t');
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('m16-dark-mode.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
    });
  });

  test('no neon glow artifacts in light mode', async ({ page }) => {
    // Check that no element has an excessively bright box-shadow
    const glowElements = await page.evaluate(() => {
      const all = document.querySelectorAll('*');
      const glowy: string[] = [];
      all.forEach((el) => {
        const style = window.getComputedStyle(el);
        const shadow = style.boxShadow;
        // Flag if shadow contains high-opacity neon-style colors
        if (shadow && /rgba?\(0,\s*240,\s*255/.test(shadow)) {
          glowy.push(el.tagName + '.' + el.className.split(' ').slice(0, 2).join('.'));
        }
      });
      return glowy;
    });
    expect(glowElements).toHaveLength(0);
  });

  test('panel chrome uses consistent border-radius', async ({ page }) => {
    // Verify no rounded-xl or shadow-2xl in rendered panel elements
    const inconsistent = await page.evaluate(() => {
      const panels = document.querySelectorAll('[class*="rounded-xl"], [class*="shadow-2xl"]');
      return Array.from(panels).map((el) => ({
        tag: el.tagName,
        classes: el.className,
      }));
    });
    // After M16.6, no panel or card should use rounded-xl or shadow-2xl
    expect(inconsistent).toHaveLength(0);
  });

  test('/streaming redirects to / when feature flag is off', async ({ page }) => {
    await page.goto(`${BASE_URL}/streaming`, { waitUntil: 'networkidle' });
    // In production build, LEGACY_STREAMING_PAGE defaults to false
    // so /streaming should redirect to /
    expect(page.url()).toBe(`${BASE_URL}/`);
  });
});
