const env = import.meta.env as any;

function stripTrailingSlash(value: string): string {
  return String(value || '').replace(/\/+$/, '');
}

function toWsProtocolUrl(value: string): string {
  const normalized = stripTrailingSlash(value);
  try {
    const url = new URL(normalized);
    if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    } else if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    }
    return stripTrailingSlash(url.toString());
  } catch {
    return stripTrailingSlash(
      normalized.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:'),
    );
  }
}

function toHttpProtocolUrl(value: string): string {
  const normalized = stripTrailingSlash(value);
  try {
    const url = new URL(normalized);
    if (url.protocol === 'wss:') {
      url.protocol = 'https:';
    } else if (url.protocol === 'ws:') {
      url.protocol = 'http:';
    }
    return stripTrailingSlash(url.toString());
  } catch {
    return stripTrailingSlash(
      normalized.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'),
    );
  }
}

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
  return stripTrailingSlash(base);
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

  // If we have a usable runtime origin (browser), prefer it for production
  // when the build-time URL appears to be cluster-internal (e.g., http://gateway:8080).
  const origin = (typeof window !== 'undefined' && window.location?.origin)
    ? window.location.origin.replace(/\/+$/, '')
    : '';

  const isClusterInternal = (u: string): boolean => {
    try {
      if (!u) return false;
      const url = new URL(u);
      const h = String(url.hostname || '').toLowerCase();
      const isIp = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(h);
      const looksSvc = h.endsWith('.svc') || h.endsWith('.svc.cluster.local');
      const isBareSvc = (h === 'gateway' || h === 'orchestrator' || h === 'redis');
      const isLocalHost = (h === 'localhost');
      return !isLocalHost && (isIp || looksSvc || isBareSvc);
    } catch {
      return false;
    }
  };

  if (fromEnv) {
    const norm = stripTrailingSlash(String(fromEnv));
    // If build-time URL points at an internal host but we are in a browser
    // (public runtime), prefer the current origin so that /api and /ws resolve
    // via the Ingress/controller.
    if (origin && isClusterInternal(norm)) return origin;
    return norm;
  }

  // Dev: if the page is served by Vite dev server, default to localhost:8080
  if (origin) {
    const port = String((new URL(origin)).port || '');
    const isViteDev = /^(5173|5174|5175)$/.test(port);
    return isViteDev ? 'http://localhost:8080' : origin;
  }

  return 'http://127.0.0.1:8080';
}

export const GATEWAY_BASE_URL = getGatewayBaseUrl();

/**
 * Return the API base URL used by frontend HTTP clients.
 * Uses VITE_API_URL for compatibility, then falls back to Gateway base.
 */
export function getApiBaseUrl(): string {
  const fromEnv = (env?.VITE_API_URL as string) || '';
  if (fromEnv) {
    return stripTrailingSlash(String(fromEnv));
  }
  return getGatewayBaseUrl();
}

/**
 * Derive WebSocket hub URL.
 * Priority:
 * 1) VITE_WS_URL (accepts ws(s) or http(s), appends /ws if path omitted)
 * 2) Gateway base URL converted to ws(s) + /ws
 */
export function getGatewayWsUrl(): string {
  const explicitWsUrl = (env?.VITE_WS_URL as string) || '';
  if (explicitWsUrl) {
    const converted = toWsProtocolUrl(explicitWsUrl);
    try {
      const url = new URL(converted);
      const pathname = stripTrailingSlash(url.pathname || '');
      if (!pathname || pathname === '/') {
        url.pathname = '/ws';
      }
      return stripTrailingSlash(url.toString());
    } catch {
      return converted.endsWith('/ws') ? converted : `${converted}/ws`;
    }
  }

  const base = toWsProtocolUrl(getGatewayBaseUrl());
  return `${base}/ws`;
}

/**
 * Derive SSE URL from the resolved WebSocket hub URL.
 * ws(s)://host:port/ws -> http(s)://host:port/ws/sse
 */
export function getGatewaySseUrl(): string {
  const wsHubUrl = getGatewayWsUrl();
  const httpHubUrl = toHttpProtocolUrl(wsHubUrl);
  return `${httpHubUrl}/sse`;
}
