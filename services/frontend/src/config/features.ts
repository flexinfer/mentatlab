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
} as const;