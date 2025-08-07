/**
 * Feature flags (Vite-style)
 *
 * Use import.meta.env.VITE_FF_* to control feature toggles at build time.
 */
export const FeatureFlags = {
  MULTIMODAL_UPLOAD: import.meta.env.VITE_FF_MULTIMODAL_UPLOAD === 'true',
  NEW_STREAMING: import.meta.env.VITE_FF_NEW_STREAMING === 'true',
  S3_STORAGE: import.meta.env.VITE_FF_S3_STORAGE === 'true',
} as const;