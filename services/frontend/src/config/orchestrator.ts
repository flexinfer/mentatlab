const env = import.meta.env as any;

/**
 * Return the orchestrator base URL.
 * Reads VITE_ORCHESTRATOR_URL and falls back to http://127.0.0.1:8081 (matches orchestrator logs)
 */
export function getOrchestratorBaseUrl(): string {
  return (env.VITE_ORCHESTRATOR_URL as string) || 'http://127.0.0.1:8081';
}

export const ORCHESTRATOR_BASE_URL = getOrchestratorBaseUrl();