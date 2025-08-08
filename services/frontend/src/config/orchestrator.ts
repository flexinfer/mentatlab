const env = import.meta.env as any;

/**
 * Return the orchestrator base URL.
 * Reads VITE_ORCHESTRATOR_URL and falls back to http://localhost:7070
 */
export function getOrchestratorBaseUrl(): string {
  return (env.VITE_ORCHESTRATOR_URL as string) || 'http://localhost:7070';
}

export const ORCHESTRATOR_BASE_URL = getOrchestratorBaseUrl();