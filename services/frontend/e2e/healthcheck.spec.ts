import { test, expect } from '@playwright/test';

test.describe('Health Check Tests', () => {
  test('should check gateway health endpoint', async ({ request }) => {
    const response = await request.get('http://localhost:8000/healthz');
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('status', 'ok');
    expect(data).toHaveProperty('streaming_enabled', true);
  });

  test('should check orchestrator health endpoint', async ({ request }) => {
    const response = await request.get('http://localhost:8001/healthz');
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('status', 'healthy');
  });

  test('should check gateway root endpoint', async ({ request }) => {
    const response = await request.get('http://localhost:8000/');
    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);
    
    const data = await response.json();
    expect(data).toHaveProperty('message');
    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('features');
  });
});