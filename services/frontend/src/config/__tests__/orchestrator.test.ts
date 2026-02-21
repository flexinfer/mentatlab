import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Each test re-imports the module after env changes so module-scope `env` is fresh.

function loadModule() {
  return import('../orchestrator');
}

// These env vars may be set by .env.local; clear them before each test
// so we control the resolution path precisely.
const VITE_KEYS = [
  'VITE_ORCHESTRATOR_URL',
  'VITE_ORCHESTRATOR_BASE_URL',
  'VITE_API_URL',
  'VITE_GATEWAY_BASE_URL',
  'VITE_GATEWAY_URL',
  'VITE_WS_URL',
] as const;

describe('config/orchestrator URL resolvers', () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear all VITE_ vars so tests start from a clean slate
    for (const key of VITE_KEYS) {
      vi.stubEnv(key, '');
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── getOrchestratorBaseUrl ────────────────────────────────────────────

  describe('getOrchestratorBaseUrl', () => {
    it('returns VITE_ORCHESTRATOR_URL when set', async () => {
      vi.stubEnv('VITE_ORCHESTRATOR_URL', 'http://custom-orch:9090');
      const { getOrchestratorBaseUrl } = await loadModule();
      expect(getOrchestratorBaseUrl()).toBe('http://custom-orch:9090');
    });

    it('falls back to VITE_ORCHESTRATOR_BASE_URL', async () => {
      vi.stubEnv('VITE_ORCHESTRATOR_BASE_URL', 'http://orch-alias:9090');
      const { getOrchestratorBaseUrl } = await loadModule();
      expect(getOrchestratorBaseUrl()).toBe('http://orch-alias:9090');
    });

    it('falls back to VITE_API_URL', async () => {
      vi.stubEnv('VITE_API_URL', 'http://api:3000');
      const { getOrchestratorBaseUrl } = await loadModule();
      expect(getOrchestratorBaseUrl()).toBe('http://api:3000');
    });

    it('defaults to localhost:7070 when no env vars set', async () => {
      const { getOrchestratorBaseUrl } = await loadModule();
      expect(getOrchestratorBaseUrl()).toBe('http://localhost:7070');
    });

    it('strips trailing slashes', async () => {
      vi.stubEnv('VITE_ORCHESTRATOR_URL', 'http://orch:7070///');
      const { getOrchestratorBaseUrl } = await loadModule();
      expect(getOrchestratorBaseUrl()).toBe('http://orch:7070');
    });
  });

  // ── getGatewayBaseUrl ─────────────────────────────────────────────────

  describe('getGatewayBaseUrl', () => {
    it('returns VITE_GATEWAY_BASE_URL when set', async () => {
      vi.stubEnv('VITE_GATEWAY_BASE_URL', 'http://gw:8080');
      const { getGatewayBaseUrl } = await loadModule();
      expect(getGatewayBaseUrl()).toBe('http://gw:8080');
    });

    it('returns VITE_GATEWAY_URL as fallback', async () => {
      vi.stubEnv('VITE_GATEWAY_URL', 'http://legacy-gw:8080');
      const { getGatewayBaseUrl } = await loadModule();
      expect(getGatewayBaseUrl()).toBe('http://legacy-gw:8080');
    });

    it('strips trailing slashes from env URL', async () => {
      vi.stubEnv('VITE_GATEWAY_BASE_URL', 'https://gw.example.com//');
      const { getGatewayBaseUrl } = await loadModule();
      expect(getGatewayBaseUrl()).toBe('https://gw.example.com');
    });

    it('defaults to a sensible local URL (no port 8000)', async () => {
      const { getGatewayBaseUrl } = await loadModule();
      const url = getGatewayBaseUrl();
      expect(url).not.toContain(':8000');
      expect(url).toMatch(/^https?:\/\//);
    });
  });

  // ── getGatewayWsUrl ───────────────────────────────────────────────────

  describe('getGatewayWsUrl', () => {
    it('derives ws:// URL from http gateway base', async () => {
      vi.stubEnv('VITE_GATEWAY_BASE_URL', 'http://gw:8080');
      const { getGatewayWsUrl } = await loadModule();
      expect(getGatewayWsUrl()).toBe('ws://gw:8080/ws');
    });

    it('derives wss:// URL from https gateway base', async () => {
      vi.stubEnv('VITE_GATEWAY_BASE_URL', 'https://gw.example.com');
      const { getGatewayWsUrl } = await loadModule();
      expect(getGatewayWsUrl()).toBe('wss://gw.example.com/ws');
    });

    it('always appends /ws suffix', async () => {
      vi.stubEnv('VITE_GATEWAY_BASE_URL', 'http://myhost:3000');
      const { getGatewayWsUrl } = await loadModule();
      expect(getGatewayWsUrl()).toMatch(/\/ws$/);
    });
  });

  // ── getGatewaySseUrl ──────────────────────────────────────────────────

  describe('getGatewaySseUrl', () => {
    it('derives SSE URL from gateway base', async () => {
      vi.stubEnv('VITE_GATEWAY_BASE_URL', 'http://gw:8080');
      const { getGatewaySseUrl } = await loadModule();
      expect(getGatewaySseUrl()).toBe('http://gw:8080/ws/sse');
    });

    it('derives https SSE URL from https gateway base', async () => {
      vi.stubEnv('VITE_GATEWAY_BASE_URL', 'https://gw.example.com');
      const { getGatewaySseUrl } = await loadModule();
      expect(getGatewaySseUrl()).toBe('https://gw.example.com/ws/sse');
    });

    it('always appends /ws/sse suffix', async () => {
      vi.stubEnv('VITE_GATEWAY_BASE_URL', 'http://myhost:3000');
      const { getGatewaySseUrl } = await loadModule();
      expect(getGatewaySseUrl()).toMatch(/\/ws\/sse$/);
    });
  });

  // ── No localhost:8000 anywhere ────────────────────────────────────────

  describe('no localhost:8000 drift', () => {
    it('no URL resolver returns port 8000 with defaults', async () => {
      const mod = await loadModule();
      const urls = [
        mod.getOrchestratorBaseUrl(),
        mod.getGatewayBaseUrl(),
        mod.getGatewayWsUrl(),
        mod.getGatewaySseUrl(),
      ];
      for (const url of urls) {
        expect(url).not.toContain(':8000');
      }
    });

    it('exported constants do not contain port 8000', async () => {
      const mod = await loadModule();
      expect(mod.ORCHESTRATOR_BASE_URL).not.toContain(':8000');
      expect(mod.GATEWAY_BASE_URL).not.toContain(':8000');
    });
  });
});
