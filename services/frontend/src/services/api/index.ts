/**
 * Centralized API module exports
 */

export * from "./httpClient";
export * from "./websocketClient";
export * from "./apiService";
export * from "./baseService";

export * from "./agentService";
export * from "./flowService";
export * from "./mediaService";
export * from "./streamingService"; // Export the new streaming service
export * from "./orchestratorService";
// Export default instances
export { httpClient as defaultHttpClient } from "./httpClient";
// Removed websocketClient export as it's now internal to ApiService
export { apiService as defaultApiService } from "./apiService";
export { streamingService as defaultStreamingService } from "./streamingService"; // Export defaultStreamingService

// Export service factories

export { getAgentService } from "./agentService";
export { getFlowService } from "./flowService";
export { getMediaService } from "./mediaService";
export { orchestratorService } from "./orchestratorService";
