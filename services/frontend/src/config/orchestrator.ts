const env = import.meta.env as any;

/**
 * Return the orchestrator base URL.
 * Reads VITE_ORCHESTRATOR_URL and falls back to http://127.0.0.1:7070 (matches orchestrator logs)
 */
export function getOrchestratorBaseUrl(): string {
  return (env.VITE_ORCHESTRATOR_URL as string) || 'http://127.0.0.1:7070';
}

export const ORCHESTRATOR_BASE_URL = getOrchestratorBaseUrl();

/**
 * Return the Gateway base URL.
 * Priority:
 * 1) VITE_GATEWAY_BASE_URL (preferred)
 * 2) VITE_GATEWAY_URL (legacy var used elsewhere in demo code)
 * 3) window.location.origin in browser contexts
 * 4) http://127.0.0.1:8080 (local dev default)
 */
export function getGatewayBaseUrl(): string {
  const fromEnv =
    (env?.VITE_GATEWAY_BASE_URL as string) ||
    (env?.VITE_GATEWAY_URL as string) ||
    '';

  if (fromEnv) return String(fromEnv).replace(/\/+$/, '');

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return 'http://127.0.0.1:8080';
}

export const GATEWAY_BASE_URL = getGatewayBaseUrl();