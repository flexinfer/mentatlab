import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Do not start a dev server here; docker-compose should already be running the stack.
  // If you later decide to use a dev server, prefer reuseExistingServer: true.
  // webServer: {
  //   command: 'echo "noop - server provided by docker-compose"',
  //   url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
  //   reuseExistingServer: true,
  // },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  reporter: [['html']],
  timeout: 60_000, // per test timeout
  expect: {
    timeout: 20_000, // default expect timeout
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});