import { test, expect } from '@playwright/test';
import { GATEWAY_BASE, ORCHESTRATOR_BASE } from './testUtils';

test.describe('Health Check Tests', () => {
  test('should check gateway health endpoint', async ({ request }) => {
    const response = await request.get(`${GATEWAY_BASE}/healthz`);
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('status', 'ok');
    expect(data).toHaveProperty('streaming_enabled', true);
  });

  test('should check orchestrator health endpoint', async ({ request }) => {
    const response = await request.get(`${ORCHESTRATOR_BASE}/healthz`);
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('status', 'healthy');
  });

  test('should check gateway root endpoint', async ({ request }) => {
    const response = await request.get(`${GATEWAY_BASE}/`);
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('message');
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('features');
  });
});
