/**
 * Feature flags (Vite-style)
 *
 * Use import.meta.env.VITE_FF_* to control feature toggles at build time.
 * In dev, defaults enable primary demos if not explicitly set.
 */
const env = import.meta.env as any;

export const FeatureFlags = {
  // Enable in dev by default so demos work without manual .env
  MULTIMODAL_UPLOAD: (env.VITE_FF_MULTIMODAL_UPLOAD ?? (env.DEV ? 'true' : 'false')) === 'true',
  NEW_STREAMING: (env.VITE_FF_NEW_STREAMING ?? (env.DEV ? 'true' : 'false')) === 'true',
  // Storage integrations should stay opt-in by default
  S3_STORAGE: (env.VITE_FF_S3_STORAGE ?? 'false') === 'true',
  // Runtime connection control: when false, UI shows streaming surfaces without attempting WS connect
  CONNECT_WS: (env.VITE_CONNECT_WS ?? 'false') === 'true',
  // Visual contract checking overlay
  CONTRACT_OVERLAY: (env.VITE_FF_CONTRACT_OVERLAY ?? (env.DEV ? 'true' : 'false')) === 'true',
  // Orchestrator Runs panel (dev/demo only)
  ORCHESTRATOR_PANEL: (env.VITE_FF_ORCHESTRATOR_PANEL ?? (env.DEV ? 'true' : 'false')) === 'true',
  // Network panel (enabled by default)
  NETWORK_PANEL: (env.VITE_FF_NETWORK_PANEL ?? (env.DEV ? 'true' : 'true')) === 'true',
  // Allow loading remote CogPak UI scripts (can bring their own WebGL). Default disabled for stability.
  ALLOW_REMOTE_COGPAK_UI: (env.VITE_FF_ALLOW_REMOTE_COGPAK_UI ?? 'false') === 'true',
} as const;