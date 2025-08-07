/**
 * Centralized API module exports
 */

export * from './httpClient';
export * from './websocketClient';
export * from './apiService';
export * from './baseService';
export * from './flowService';
export * from './agentService';
export * from './mediaService';
export * from './streamingService'; // Export the new streaming service

// Export default instances
export { httpClient as defaultHttpClient } from './httpClient';
// Removed websocketClient export as it's now internal to ApiService
export { apiService as defaultApiService } from './apiService';
export { streamingService as defaultStreamingService } from './streamingService'; // Export defaultStreamingService

// Export service factories
export { getFlowService } from './flowService';
export { getAgentService } from './agentService';
export { getMediaService } from './mediaService';