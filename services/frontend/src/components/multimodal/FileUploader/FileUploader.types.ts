/**
 * FileUploader TypeScript interfaces
 * Based on Phase 2 Core Features Architecture
 */

import { MediaReference } from '../../../types/media';

export interface FileValidationConfig { // Define FileValidationConfig
  maxSize?: number; // Max file size in bytes
  allowedTypes?: string[]; // Allowed MIME types or file extensions
  maxFiles?: number; // Max number of files allowed
}

export interface FileUploaderProps {
  // Configuration
  validation?: Partial<FileValidationConfig>; // Use the new interface
  accept?: Record<string, string[]>;  // MIME types and extensions
  maxSize?: number;                   // Max file size in bytes
  maxFiles?: number;                  // Max concurrent files
  multiple?: boolean;                 // Allow multiple file selection
  
  // Handlers
  onUpload?: (files: File[]) => void;
  onProgress?: (progress: UploadProgress) => void;
  onComplete?: (results: UploadResult[]) => void;
  onError?: (error: UploadError) => void;
  
  // Customization
  className?: string;
  disabled?: boolean;
  showPreview?: boolean;
  showProgress?: boolean;
  
  // S3 Configuration
  getPresignedUrl?: (file: File) => Promise<PresignedUrlResponse>;
  chunkSize?: number;  // Default: 5MB
}

export interface UploadProgress {
  id: string;
  status: 'queued' | 'uploading' | 'processing' | 'completed' | 'error' | 'canceled';
  progress: number; // 0-100
  bytesUploaded?: number;
  bytesTotal?: number;
  speedBps?: number;
  etaSeconds?: number;
  error?: { code: string; message: string; retriable: boolean };
}

export interface UploadResult {
  fileId: string;
  reference: MediaReference;
  duration: number;     // Upload duration in ms
  averageSpeed: number; // bytes/second
}

export interface UploadError {
  fileId: string;
  fileName: string;
  message: string;
  code?: string;
  details?: any;
}

export interface ChunkingStrategy {
  chunkSize: number;
  maxConcurrentChunks: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface PresignedUrlResponse {
  uploadUrl: string;
  key: string;
  expiresAt: string;
}

export interface FileUploadState {
  id: string;
  file: File;
  status: UploadProgress['status'];
  progress: number;
  startTime: number;
  endTime?: number;
  metadata?: Record<string, any>;
  error?: UploadProgress['error'];
  abortController?: AbortController;
  chunkSize?: number;
  parallel?: number;
  attempts?: number;
}

export interface DragDropOptions {
  allowedTypes?: string[]; // Added: Accepted MIME types or file extensions
  maxSize?: number; // Added: Max file size in bytes
  multiple?: boolean;
  onFilesSelected?: (files: File[]) => void; // Renamed from onDrop
  onDragError?: (error: string) => void; // Renamed from onError
}

// File validation result
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// Upload task for internal queue management
export interface UploadTask {
  id: string;
  file: File;
  status: UploadProgress['status'];
  progress: number;
  startTime: number;
  metadata: any;
}

// Configuration for upload controller
export interface UploadConfig {
  chunkSize: number;
  onProgress?: (progress: UploadProgress) => void;
  onComplete?: (result: UploadResult) => void;
  onError?: (error: UploadError) => void;
}

export interface UploadOptions {
  chunkSize: number;            // bytes, default 5 * 1024 * 1024
  parallel: number;             // 1-5, default 3
  maxRetries: number;           // per chunk, default 3
  backoffBaseMs: number;        // default 500
  backoffMaxMs: number;         // default 5000
  onProgress?: (p: UploadProgress) => void;
  onStatus?: (s: UploadProgress) => void;
  signal?: AbortSignal;
  contentType?: string;         // optional override
  metadata?: Record<string, any>;
}