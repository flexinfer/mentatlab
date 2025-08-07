/**
 * Media Service - Handles multimodal media upload, processing, and streaming
 */
 
import { BaseService } from './baseService';
import { HttpClient } from './httpClient';
import { WebSocketClient } from './websocketClient'; // Keep for now, might be removed later
import { MediaReference } from '../../types/media'; // Import MediaReference
import { v4 as uuidv4 } from 'uuid'; // Import uuidv4 for file IDs
 
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
 
// Define CHUNK_SIZE as per rearchitecture plan (Section 9.2)
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
 
export class MediaService extends BaseService {
  private uploadAbortControllers = new Map<string, AbortController>();
 
  constructor(http: HttpClient, ws: WebSocketClient | null) {
    super(http, ws, { basePath: '/api/media', enableStreaming: true });
  }
 
  /**
   * Upload a media file with presigned URLs and chunking
   */
  async uploadFile(
    file: File,
    options?: {
      onProgress?: (progress: MediaUploadProgress) => void;
      metadata?: Record<string, any>;
    }
  ): Promise<MediaReference> { // Return MediaReference as per plan
    const fileId = uuidv4(); // Generate a unique ID for this upload
    this.uploadAbortControllers.set(fileId, new AbortController());
    const abortSignal = this.uploadAbortControllers.get(fileId)?.signal;
 
    try {
      // 1. Request presigned URL
      const { uploadUrl, reference } = await this.getPresignedUrl({
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        fileId: fileId,
        metadata: options?.metadata,
      });
 
      // 2. Chunk file if needed and upload
      const chunks = this.chunkFile(file);
      await this.uploadChunks(fileId, chunks, uploadUrl, options?.onProgress, abortSignal);
      
      // 3. Return reference
      return reference;
    } finally {
      this.uploadAbortControllers.delete(fileId);
    }
  }
 
  /**
   * Request a presigned URL from the backend
   */
  private async getPresignedUrl(params: {
    filename: string;
    mimeType: string;
    size: number;
    fileId: string;
    metadata?: Record<string, any>;
  }): Promise<{ uploadUrl: string; reference: MediaReference }> {
    const response = await this.http.post<{ uploadUrl: string; reference: MediaReference }>(
      this.buildPath('/upload-url'),
      params
    );
    return response;
  }
 
  /**
   * Chunk a file into smaller parts
   */
  private chunkFile(file: File): Blob[] {
    const chunks: Blob[] = [];
    let offset = 0;
    while (offset < file.size) {
      chunks.push(file.slice(offset, offset + CHUNK_SIZE));
      offset += CHUNK_SIZE;
    }
    return chunks;
  }
 
  /**
   * Upload file chunks with progress tracking
   */
  private async uploadChunks(
    fileId: string,
    chunks: Blob[],
    uploadUrl: string,
    onProgress?: (progress: MediaUploadProgress) => void,
    abortSignal?: AbortSignal
  ): Promise<void> {
    let loaded = 0;
    const total = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
 
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      try {
        const xhr = new XMLHttpRequest();
        await new Promise<void>((resolve, reject) => {
          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', chunk.type);
          
          // Add auth headers if available
          const authHeader = this.http.defaults.headers.common['Authorization'];
          if (authHeader) {
            xhr.setRequestHeader('Authorization', authHeader);
          }
 
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable && onProgress) {
              // Calculate progress for the entire file, not just the current chunk
              const currentLoaded = loaded + event.loaded;
              onProgress({
                fileId: fileId,
                loaded: currentLoaded,
                total: total,
                percentage: Math.round((currentLoaded / total) * 100)
              });
            }
          };
 
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              loaded += chunk.size; // Update total loaded bytes
              resolve();
            } else {
              reject(new Error(`Upload of chunk ${i + 1} failed with status ${xhr.status}`));
            }
          };
 
          xhr.onerror = () => reject(new Error(`Upload of chunk ${i + 1} failed`));
          xhr.onabort = () => reject(new Error('Upload cancelled'));
 
          abortSignal?.addEventListener('abort', () => xhr.abort());
 
          xhr.send(chunk);
        });
      } catch (error) {
        console.error(`Error uploading chunk ${i + 1}:`, error);
        throw error; // Re-throw to stop the entire upload
      }
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