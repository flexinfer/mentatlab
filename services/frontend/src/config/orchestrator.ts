const env = import.meta.env as any;

/**
 * Return the orchestrator base URL used by the frontend.
 *
 * Resolution order (first non-empty wins):
 * - VITE_ORCHESTRATOR_URL
 * - VITE_ORCHESTRATOR_BASE_URL (alias)
 * - VITE_API_URL (legacy name used by some panels)
 * - http://localhost:7070 (dev default)
 */
export function getOrchestratorBaseUrl(): string {
  const fromEnv =
    (env?.VITE_ORCHESTRATOR_URL as string) ||
    (env?.VITE_ORCHESTRATOR_BASE_URL as string) ||
    (env?.VITE_API_URL as string) ||
    '';
  const base = (fromEnv || 'http://localhost:7070').toString();
  return base.replace(/\/+$/, '');
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
