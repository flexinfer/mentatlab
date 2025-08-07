/**
 * Media Service - Handles multimodal media upload, processing, and streaming
 */

import { BaseService } from './baseService';
import { HttpClient } from './httpClient';
import { WebSocketClient } from './websocketClient';

export type MediaType = 'image' | 'audio' | 'video' | 'document';
export type MediaStatus = 'uploading' | 'processing' | 'ready' | 'failed';

export interface MediaFile {
  id: string;
  filename: string;
  type: MediaType;
  mimeType: string;
  size: number;
  url?: string;
  thumbnailUrl?: string;
  status: MediaStatus;
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
    format?: string;
    [key: string]: any;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MediaUploadProgress {
  fileId: string;
  loaded: number;
  total: number;
  percentage: number;
}

export interface MediaStreamConfig {
  mediaId: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  startTime?: number;
  endTime?: number;
}

export interface MediaProcessingOptions {
  resize?: { width: number; height: number };
  format?: string;
  quality?: number;
  trim?: { start: number; end: number };
  watermark?: { text: string; position: string };
}

export class MediaService extends BaseService {
  private uploadAbortControllers = new Map<string, AbortController>();

  constructor(http: HttpClient, ws: WebSocketClient | null) {
    super(http, ws, { basePath: '/api/media', enableStreaming: true });
  }

  /**
   * Upload a media file
   */
  async uploadFile(
    file: File,
    options?: {
      onProgress?: (progress: MediaUploadProgress) => void;
      metadata?: Record<string, any>;
    }
  ): Promise<MediaFile> {
    const formData = new FormData();
    formData.append('file', file);
    
    if (options?.metadata) {
      formData.append('metadata', JSON.stringify(options.metadata));
    }

    const abortController = new AbortController();
    const tempId = `upload-${Date.now()}-${Math.random()}`;
    this.uploadAbortControllers.set(tempId, abortController);

    try {
      // Create XMLHttpRequest for progress tracking
      const xhr = new XMLHttpRequest();
      
      return new Promise((resolve, reject) => {
        // Progress handler
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && options?.onProgress) {
            options.onProgress({
              fileId: tempId,
              loaded: event.loaded,
              total: event.total,
              percentage: Math.round((event.loaded / event.total) * 100)
            });
          }
        });

        // Success handler
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        // Error handler
        xhr.addEventListener('error', () => {
          reject(new Error('Upload failed'));
        });

        // Abort handler
        abortController.signal.addEventListener('abort', () => {
          xhr.abort();
          reject(new Error('Upload cancelled'));
        });

        // Send request
        const url = this.buildPath('/upload');
        xhr.open('POST', url);
        
        // Add auth headers if available
        const authHeader = this.http.defaults.headers.common['Authorization'];
        if (authHeader) {
          xhr.setRequestHeader('Authorization', authHeader);
        }
        
        xhr.send(formData);
      });
    } finally {
      this.uploadAbortControllers.delete(tempId);
    }
  }

  /**
   * Cancel an ongoing upload
   */
  cancelUpload(fileId: string): void {
    const controller = this.uploadAbortControllers.get(fileId);
    if (controller) {
      controller.abort();
      this.uploadAbortControllers.delete(fileId);
    }
  }

  /**
   * Get media file details
   */
  async getMedia(mediaId: string): Promise<MediaFile> {
    return this.get<MediaFile>(`/${mediaId}`);
  }

  /**
   * List media files
   */
  async listMedia(params?: {
    type?: MediaType;
    status?: MediaStatus;
    limit?: number;
    offset?: number;
  }): Promise<{ items: MediaFile[]; total: number }> {
    return this.get<{ items: MediaFile[]; total: number }>('', params);
  }

  /**
   * Delete media file
   */
  async deleteMedia(mediaId: string): Promise<void> {
    return this.delete<void>(`/${mediaId}`);
  }

  /**
   * Process media file (resize, convert, etc.)
   */
  async processMedia(
    mediaId: string,
    options: MediaProcessingOptions
  ): Promise<MediaFile> {
    const response = await this.post<MediaFile>(`/${mediaId}/process`, options);
    
    // Subscribe to processing updates if streaming is available
    if (this.isStreamingAvailable) {
      this.subscribeToProcessingUpdates(response.id);
    }
    
    return response;
  }

  /**
   * Get media thumbnail
   */
  async getMediaThumbnail(
    mediaId: string,
    size: 'small' | 'medium' | 'large' = 'medium'
  ): Promise<string> {
    return this.get<string>(`/${mediaId}/thumbnail`, { size });
  }

  /**
   * Start media streaming
   */
  async startStreaming(config: MediaStreamConfig): Promise<{
    streamId: string;
    url: string;
    protocol: 'hls' | 'dash' | 'webrtc';
  }> {
    const response = await this.post<{
      streamId: string;
      url: string;
      protocol: 'hls' | 'dash' | 'webrtc';
    }>('/stream/start', config);
    
    // Subscribe to stream events
    if (this.isStreamingAvailable && response.streamId) {
      this.subscribeToStreamEvents(response.streamId);
    }
    
    return response;
  }

  /**
   * Stop media streaming
   */
  async stopStreaming(streamId: string): Promise<void> {
    return this.post<void>(`/stream/${streamId}/stop`);
  }

  /**
   * Get signed URL for direct upload (S3)
   */
  async getUploadUrl(params: {
    filename: string;
    mimeType: string;
    size: number;
  }): Promise<{
    uploadUrl: string;
    fileId: string;
    expires: string;
  }> {
    return this.post<{
      uploadUrl: string;
      fileId: string;
      expires: string;
    }>('/upload-url', params);
  }

  /**
   * Subscribe to media processing updates
   */
  subscribeToProcessingUpdates(
    mediaId: string,
    onUpdate?: (update: { status: MediaStatus; progress?: number }) => void
  ): (() => void) | null {
    return this.subscribeToStream(`media:${mediaId}:processing`, (data) => {
      if (onUpdate) {
        onUpdate(data);
      }
    });
  }

  /**
   * Subscribe to stream events
   */
  subscribeToStreamEvents(
    streamId: string,
    onEvent?: (event: { type: string; data: any }) => void
  ): (() => void) | null {
    return this.subscribeToStream(`stream:${streamId}:event`, (data) => {
      if (onEvent) {
        onEvent(data);
      }
    });
  }

  /**
   * Subscribe to media upload progress via WebSocket
   */
  subscribeToUploadProgress(
    fileId: string,
    onProgress: (progress: MediaUploadProgress) => void
  ): (() => void) | null {
    return this.subscribeToStream(`upload:${fileId}:progress`, onProgress);
  }

  /**
   * Analyze media content (AI-powered)
   */
  async analyzeMedia(mediaId: string, analysisType: 'transcription' | 'object-detection' | 'sentiment'): Promise<{
    type: string;
    results: any;
    confidence?: number;
  }> {
    return this.post<{
      type: string;
      results: any;
      confidence?: number;
    }>(`/${mediaId}/analyze`, { type: analysisType });
  }

  /**
   * Get media usage statistics
   */
  async getMediaStats(): Promise<{
    totalSize: number;
    fileCount: Record<MediaType, number>;
    storageUsed: number;
    bandwidthUsed: number;
  }> {
    return this.get<{
      totalSize: number;
      fileCount: Record<MediaType, number>;
      storageUsed: number;
      bandwidthUsed: number;
    }>('/stats');
  }
}

// Export singleton instance
let mediaServiceInstance: MediaService;

export function getMediaService(http: HttpClient, ws: WebSocketClient | null): MediaService {
  if (!mediaServiceInstance) {
    mediaServiceInstance = new MediaService(http, ws);
  }
  return mediaServiceInstance;
}