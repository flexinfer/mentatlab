import { getGatewayBaseUrl } from '@/config/orchestrator';

/**
 * Resolve a remote UI entry script to an absolute URL.
 * - Absolute http/https remains unchanged
 * - Relative paths are resolved against Gateway base to work in dev/preview/prod
 */
export function resolveRemoteEntry(remoteEntry: string, base?: string): string {
  const b = (base || getGatewayBaseUrl() || '').replace(/\/+$/, '');
  if (/^https?:\/\//i.test(remoteEntry)) return remoteEntry;
  return `${b}/${String(remoteEntry).replace(/^\/+/, '')}`;
}

/**
 * Dispatch a window event to open a CogPak UI overlay.
 * Consumers can listen for `openCogpak` and mount into #cogpak-mount.
 */
export function openCogpakUi(remoteEntry: string, title = 'CogPak UI'): void {
  const url = resolveRemoteEntry(remoteEntry);
  const detail = { url, title };
  try {
    window.dispatchEvent(new CustomEvent('openCogpak', { detail }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[remoteUi] Failed to dispatch openCogpak', err);
  }
}

