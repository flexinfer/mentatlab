/**
 * API Integration Types
 *
 * This file provides type mappings and adapters between the frontend type system
 * and the API service layer to ensure proper integration and backward compatibility.
 */

import type {
  Flow,
  Node,
  Edge,
  Agent,
  Pin,
  PinData,
  MediaPinValue,
  StreamPinValue
} from './graph';

import {
  MediaType,
  MediaReference,
  MediaMetadata,
  MediaUploadProgress,
  MediaStreamingSession,
  MediaProcessingOptions
} from './media';

import type {
  StreamSession,
  StreamingMessage,
  StreamingCapabilities
} from './streaming';

// Import API service types
import type { Agent as ApiAgent } from '@/services/api/agentService';
import type { MediaFile, MediaType as ApiMediaType } from '@/services/api/mediaService';

/**
 * Type mapping between frontend MediaType and API MediaType
 */
export const mediaTypeMap: Record<MediaType, ApiMediaType> = {
  [MediaType.IMAGE]: 'image',
  [MediaType.AUDIO]: 'audio',
  [MediaType.VIDEO]: 'video',
  [MediaType.DOCUMENT]: 'document',
  [MediaType.TEXT]: 'document', // Map text to document for API compatibility
};

/**
 * Convert frontend MediaType to API MediaType
 */
export function toApiMediaType(type: MediaType): ApiMediaType {
  return mediaTypeMap[type] || 'document';
}

/**
 * Convert API MediaType to frontend MediaType
 */
export function fromApiMediaType(type: ApiMediaType): MediaType {
  switch (type) {
    case 'image': return MediaType.IMAGE;
    case 'audio': return MediaType.AUDIO;
    case 'video': return MediaType.VIDEO;
    case 'document': return MediaType.DOCUMENT;
    default: return MediaType.DOCUMENT;
  }
}

/**
 * Convert MediaReference to API MediaFile format
 */
export function toApiMediaFile(ref: MediaReference): Partial<MediaFile> {
  return {
    id: ref.refId,
    filename: ref.metadata.filename || `media-${ref.refId}`,
    type: toApiMediaType(ref.type),
    mimeType: ref.metadata.mimeType,
    size: ref.metadata.size || 0,
    url: ref.url,
    thumbnailUrl: ref.thumbnailUrl,
    status: ref.status === 'ready' ? 'ready' :
           ref.status === 'uploading' ? 'uploading' :
           ref.status === 'processing' ? 'processing' : 'failed',
    metadata: extractApiMetadata(ref.metadata),
    createdAt: ref.metadata.createdAt,
    updatedAt: ref.metadata.updatedAt || ref.metadata.createdAt,
  };
}

/**
 * Convert API MediaFile to MediaReference format
 */
export function fromApiMediaFile(file: MediaFile): MediaReference {
  const mediaType = fromApiMediaType(file.type);

  return {
    type: mediaType,
    refId: file.id,
    storageLocation: 's3', // Default to S3 for API files
    url: file.url || '',
    metadata: {
      id: file.id,
      filename: file.filename,
      size: file.size,
      mimeType: file.mimeType,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      ...(file.metadata || {}),
    } as MediaMetadata,
    status: file.status === 'failed' ? 'error' : file.status as any,
    thumbnailUrl: file.thumbnailUrl,
  };
}

/**
 * Extract API-compatible metadata from MediaMetadata
 */
function extractApiMetadata(metadata: MediaMetadata): Record<string, any> {
  const { id, filename, size, mimeType, createdAt, updatedAt, url, checksum, ...rest } = metadata;
  return rest;
}

/**
 * Agent type adapter for converting between frontend and API agent representations.
 * This adapter ensures proper data transformation when communicating with the backend API.
 */
export interface AgentAdapter {
  /**
   * Convert frontend Agent to API Agent format.
   * @param agent - The frontend Agent object to convert
   * @returns Partial API Agent object with mapped properties
   */
  toApi(agent: Agent): Partial<ApiAgent>;

  /**
   * Convert API Agent to frontend Agent format.
   * @param apiAgent - The API Agent object to convert
   * @returns Partial frontend Agent object with mapped properties
   */
  fromApi(apiAgent: ApiAgent): Partial<Agent>;
}

export const agentAdapter: AgentAdapter = {
  toApi(agent: Agent): Partial<ApiAgent> {
    return {
      id: agent.id,
      name: agent.id, // Use ID as name for API
      type: agent.runtime || 'container',
      status: 'online', // Default status
      capabilities: extractCapabilities(agent),
      config: {
        image: agent.image,
        version: agent.version,
        env: agent.env,
        resources: agent.resources,
      },
      metadata: {
        description: agent.description,
        longRunning: agent.longRunning,
        ui: agent.ui,
        mediaCapabilities: agent.mediaCapabilities,
      },
    };
  },

  fromApi(apiAgent: ApiAgent): Partial<Agent> {
    const config = apiAgent.config || {};
    const metadata = apiAgent.metadata || {};

    return {
      id: apiAgent.id,
      version: config.version || '1.0.0',
      image: config.image || '',
      runtime: apiAgent.type,
      description: metadata.description || apiAgent.name,
      inputs: [], // Would need to be populated from manifest
      outputs: [], // Would need to be populated from manifest
      longRunning: metadata.longRunning,
      ui: metadata.ui,
      resources: config.resources,
      env: config.env,
      mediaCapabilities: metadata.mediaCapabilities,
    };
  },
};

/**
 * Extract capabilities from Agent based on its configuration and media support.
 * @param agent - The agent to extract capabilities from
 * @returns Array of capability strings (e.g., 'streaming', 'image-processing')
 * @private
 */
function extractCapabilities(agent: Agent): string[] {
  const capabilities: string[] = [];

  if (agent.mediaCapabilities) {
    if (agent.mediaCapabilities.supportsStreaming) {
      capabilities.push('streaming');
    }
    if (agent.mediaCapabilities.supportedInputTypes?.includes(MediaType.IMAGE)) {
      capabilities.push('image-processing');
    }
    if (agent.mediaCapabilities.supportedInputTypes?.includes(MediaType.AUDIO)) {
      capabilities.push('audio-processing');
    }
    if (agent.mediaCapabilities.supportedInputTypes?.includes(MediaType.VIDEO)) {
      capabilities.push('video-processing');
    }
  }

  if (agent.longRunning) {
    capabilities.push('long-running');
  }

  if (agent.resources?.gpu) {
    capabilities.push('gpu-accelerated');
  }

  return capabilities;
}

/**
 * Flow execution adapter for API integration.
 * Handles the preparation and processing of flows for execution via the API.
 */
export interface FlowExecutionAdapter {
  /**
   * Prepare flow for API execution by extracting media references and formatting inputs.
   * @param flow - The flow to prepare for execution
   * @param inputs - Optional input values for the flow
   * @returns Object containing the prepared flow, inputs, and extracted media references
   */
  prepareForExecution(flow: Flow, inputs?: Record<string, any>): {
    flow: Flow;
    inputs: Record<string, any>;
    mediaReferences: MediaReference[];
  };

  /**
   * Process execution results from the API and convert them to frontend format.
   * @param results - Raw execution results from the API
   * @returns Object containing formatted outputs and any media references
   */
  processExecutionResults(results: Record<string, any>): {
    outputs: Record<string, PinData>;
    mediaReferences: MediaReference[];
  };
}

/**
 * Streaming session adapter for managing real-time data streams.
 * Provides conversion and handling capabilities for streaming sessions.
 */
export interface StreamingAdapter {
  /**
   * Convert StreamSession to API-compatible format.
   * @param session - The streaming session to convert
   * @returns API-formatted session object
   */
  toApiSession(session: StreamSession): Record<string, any>;

  /**
   * Handle incoming streaming messages from the API.
   * @param message - The streaming message to process
   */
  handleMessage(message: StreamingMessage): void;

  /**
   * Get the streaming capabilities of the current system.
   * @returns StreamingCapabilities object describing supported features
   */
  getCapabilities(): StreamingCapabilities;
}

/**
 * Media upload adapter for progress tracking.
 * Manages callbacks for tracking the progress of media uploads.
 *
 * @example
 * ```typescript
 * const adapter = new MediaUploadAdapter();
 * adapter.onProgress('upload-123', (progress) => {
 *   console.log(`Upload progress: ${progress.progress}%`);
 * });
 * ```
 */
export class MediaUploadAdapter {
  private progressCallbacks = new Map<string, (progress: MediaUploadProgress) => void>();

  /**
   * Register a progress callback for a specific file upload.
   * @param fileId - The ID of the file being uploaded
   * @param callback - Callback function to invoke on progress updates
   */
  onProgress(fileId: string, callback: (progress: MediaUploadProgress) => void): void {
    this.progressCallbacks.set(fileId, callback);
  }

  /**
   * Remove a progress callback for a specific file upload.
   * @param fileId - The ID of the file to stop tracking
   */
  offProgress(fileId: string): void {
    this.progressCallbacks.delete(fileId);
  }

  /**
   * Handle a progress update by invoking the appropriate callback.
   * @param progress - The progress update to handle
   */
  handleProgress(progress: MediaUploadProgress): void {
    const callback = this.progressCallbacks.get(progress.uploadId);
    if (callback) {
      callback(progress);
    }
  }
}

/**
 * Convert pin data to API-compatible format.
 * Handles special cases for media and stream pins.
 *
 * @param pinData - The pin data to convert
 * @param pin - The pin definition containing type information
 * @returns API-compatible representation of the pin data
 *
 * @example
 * ```typescript
 * const apiData = convertPinDataForApi(
 *   { value: imageData, mediaRef: mediaReference },
 *   { name: 'input', type: 'image' }
 * );
 * ```
 */
export function convertPinDataForApi(pinData: PinData, pin: Pin): any {
  // Handle media pins
  if (pin.type === 'image' || pin.type === 'audio' || pin.type === 'video' || pin.type === 'media') {
    if (pinData.mediaRef) {
      return {
        ref: pinData.mediaRef.refId,
        url: pinData.mediaRef.url,
        type: pinData.mediaRef.type,
      };
    }
    return pinData.value;
  }

  // Handle stream pins
  if (pin.type === 'stream' && pinData.streamId) {
    return {
      streamId: pinData.streamId,
      type: 'stream',
    };
  }

  // Handle regular data
  return pinData.value;
}

/**
 * Convert API data to frontend PinData format.
 * Automatically detects and handles media references and stream data.
 *
 * @param apiData - The API data to convert
 * @param pin - The pin definition (currently unused but kept for future compatibility)
 * @returns PinData object with proper metadata and references
 *
 * @example
 * ```typescript
 * const pinData = convertPinDataFromApi(
 *   { ref: 'media-123', url: 'https://...', type: 'image' },
 *   { name: 'output', type: 'image' }
 * );
 * ```
 */
export function convertPinDataFromApi(apiData: any, pin: Pin): PinData {
  const baseData: PinData = {
    value: apiData,
    metadata: {
      timestamp: new Date().toISOString(),
      status: 'ready',
    },
  };

  // Check if it's a media reference
  if (apiData && typeof apiData === 'object' && 'ref' in apiData && 'url' in apiData) {
    baseData.mediaRef = {
      type: apiData.type || MediaType.DOCUMENT,
      refId: apiData.ref,
      storageLocation: 's3',
      url: apiData.url,
      metadata: {} as MediaMetadata,
      status: 'ready',
    };
  }

  // Check if it's a stream reference
  if (apiData && typeof apiData === 'object' && 'streamId' in apiData) {
    baseData.streamId = apiData.streamId;
  }

  return baseData;
}

/**
 * Map API error responses to user-friendly error messages.
 * Handles common HTTP status codes and provides appropriate error messages.
 *
 * @param error - The error object from the API response
 * @returns A new Error object with a user-friendly message
 *
 * @example
 * ```typescript
 * try {
 *   await apiCall();
 * } catch (error) {
 *   throw mapApiError(error);
 * }
 * ```
 */
export function mapApiError(error: any): Error {
  if (error.response) {
    const status = error.response.status;
    const message = error.response.data?.message || error.message;

    switch (status) {
      case 400:
        return new Error(`Invalid request: ${message}`);
      case 401:
        return new Error('Authentication required');
      case 403:
        return new Error('Permission denied');
      case 404:
        return new Error('Resource not found');
      case 413:
        return new Error('File too large');
      case 415:
        return new Error('Unsupported media type');
      default:
        return new Error(`API error: ${status} - ${message}`);
    }
  }
  return new Error('An unknown error occurred');
}