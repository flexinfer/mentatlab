/**
 * Feature flags for gradual rollout of new multimodal features
 * These flags allow us to enable/disable features without code changes
 */

export const FeatureFlags = {
  // Multimodal features
  MULTIMODAL_UPLOAD: process.env.REACT_APP_FF_MULTIMODAL_UPLOAD === 'true',
  NEW_STREAMING: process.env.REACT_APP_FF_NEW_STREAMING === 'true',
  S3_STORAGE: process.env.REACT_APP_FF_S3_STORAGE === 'true',
  
  // Enhanced state management
  ENHANCED_STATE: process.env.REACT_APP_FF_ENHANCED_STATE === 'true',
  
  // Service layer
  NEW_API_LAYER: process.env.REACT_APP_FF_NEW_API_LAYER === 'true',
  
  // UI Components
  MULTIMODAL_COMPONENTS: process.env.REACT_APP_FF_MULTIMODAL_COMPONENTS === 'true',
} as const;

// Type for feature flag keys
export type FeatureFlagKey = keyof typeof FeatureFlags;

// Helper to check if a feature is enabled
export const isFeatureEnabled = (flag: FeatureFlagKey): boolean => {
  return FeatureFlags[flag];
};

// Helper to get all enabled features
export const getEnabledFeatures = (): FeatureFlagKey[] => {
  return (Object.keys(FeatureFlags) as FeatureFlagKey[])
    .filter(key => FeatureFlags[key]);
};