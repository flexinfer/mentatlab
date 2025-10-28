import { describe, expect, test, vi } from 'vitest';
import { resolveRemoteEntry, openCogpakUi } from './remoteUi';

describe('remoteUi helpers', () => {
  test('resolveRemoteEntry passes through absolute URL', () => {
    const abs = 'https://cdn.example.com/agent/ui/remoteEntry.js';
    expect(resolveRemoteEntry(abs)).toBe(abs);
  });

  test('resolveRemoteEntry prefixes relative with provided base', () => {
    const rel = 'agents/ctm-cogpack/ui/remoteEntry.js';
    expect(resolveRemoteEntry(rel, 'http://gw.local:8080')).toBe('http://gw.local:8080/agents/ctm-cogpack/ui/remoteEntry.js');
  });

  test('openCogpakUi dispatches openCogpak with resolved URL', () => {
    const events: any[] = [];
    const listener = (e: any) => events.push(e as any);
    window.addEventListener('openCogpak', listener as any);
    openCogpakUi('agents/demo/ui/remoteEntry.js', 'Demo UI');
    window.removeEventListener('openCogpak', listener as any);
    expect(events.length).toBe(1);
    const evt: any = events[0];
    // If no explicit base set, url should be resolved against window.location.origin in tests
    expect(evt.detail?.url.endsWith('/agents/demo/ui/remoteEntry.js')).toBe(true);
    expect(evt.detail?.title).toBe('Demo UI');
  });
});
