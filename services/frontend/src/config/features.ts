/**
 * Feature flags (Vite-style)
 *
 * Use import.meta.env.VITE_FF_* to control feature toggles at build time.
 * In dev, defaults enable primary demos if not explicitly set.
 */
const env = import.meta.env as any;

export const FeatureFlags = {
  // Enable in dev by default so demos work without manual .env
  MULTIMODAL_UPLOAD: (env.VITE_FF_MULTIMODAL_UPLOAD ?? 'true') === 'true',
  NEW_STREAMING: (env.VITE_FF_NEW_STREAMING ?? 'true') === 'true',
  // Storage integrations should stay opt-in by default
  S3_STORAGE: (env.VITE_FF_S3_STORAGE ?? 'false') === 'true',
  // Runtime connection control: when false, UI shows streaming surfaces without attempting WS connect
  // Default ON in dev so the live connect control is available immediately
  CONNECT_WS: (env.VITE_CONNECT_WS ?? 'true') === 'true',
  // Auto-connect live stream on page load (off by default in prod)
  AUTO_CONNECT: (env.VITE_FF_AUTO_CONNECT ?? 'false') === 'true',
  // Visual contract checking overlay
  CONTRACT_OVERLAY: (env.VITE_FF_CONTRACT_OVERLAY ?? (env.DEV ? 'true' : 'false')) === 'true',
  // Orchestrator Runs panel (dev/demo only)
  ORCHESTRATOR_PANEL: (env.VITE_FF_ORCHESTRATOR_PANEL ?? 'true') === 'true',
  // Network panel (enabled by default)
  NETWORK_PANEL: (env.VITE_FF_NETWORK_PANEL ?? (env.DEV ? 'true' : 'true')) === 'true',
  // Allow loading remote CogPak UI scripts (can bring their own WebGL).
  // Default ON in dev so the "UI" buttons work out of the box.
  ALLOW_REMOTE_COGPAK_UI: (env.VITE_FF_ALLOW_REMOTE_COGPAK_UI ?? (env.DEV ? 'true' : 'false')) === 'true',
  // NEW: Mission Control Graph (React Flow DAG) – default on in dev
  MISSION_GRAPH: (env.VITE_FF_MISSION_GRAPH ?? 'true') === 'true',
  // NEW: Mission Control Console – default on in dev
  MISSION_CONSOLE: (env.VITE_FF_MISSION_CONSOLE ?? 'true') === 'true',
} as const;

/**
 * Getter: Whether CloudEvents envelopes are expected from gateway.
 * Backed by VITE_FF_CE_ENVELOPE; defaults to false when unset/invalid.
 */
export function isCloudEventsEnabled(): boolean {
  const v = env?.VITE_FF_CE_ENVELOPE ?? 'false';
  return String(v).toLowerCase() === 'true';
}

/**
 * Getter: Whether to use a Web Worker to parse inbound streaming messages.
 * Backed by VITE_FF_STREAM_WORKER; defaults to false when unset/invalid.
 */
export function isStreamWorkerEnabled(): boolean {
  const v = env?.VITE_FF_STREAM_WORKER ?? 'false';
  return String(v).toLowerCase() === 'true';
}

// Whether to start a local simulation when transports fail
export function isSimFallbackEnabled(): boolean {
  const v = env?.VITE_FF_STREAM_SIM ?? 'false';
  return String(v).toLowerCase() === 'true';
}

// Whether to auto-record a run into the flight recorder on connect
export function isAutoRecordEnabled(): boolean {
  const v = env?.VITE_FF_STREAM_AUTORECORD ?? 'false';
  return String(v).toLowerCase() === 'true';
}

/**
 * Getter: Placeholder for an alternative fast store toggling (no-op here).
 * Backed by VITE_FF_FAST_STORE; defaults to false when unset/invalid.
 */
export function isFastStoreEnabled(): boolean {
  const v = env?.VITE_FF_FAST_STORE ?? 'false';
  return String(v).toLowerCase() === 'true';
}

/**
 * Getter: Whether to use virtualized console rendering with react-window.
 * Backed by VITE_FF_CONSOLE_VIRTUALIZATION; defaults to false in production.
 * Note: Requires react-window dependency which is CommonJS, so disabled by default.
 */
export function isConsoleVirtualizationEnabled(): boolean {
  const v = env?.VITE_FF_CONSOLE_VIRTUALIZATION ?? (env.DEV ? 'true' : 'false');
  return String(v).toLowerCase() === 'true';
}
