/**
 * FileUploader Component - Main component for file upload functionality
 * Based on Phase 2 Core Features Architecture
 */

import React, { useCallback, useRef } from 'react';
import { useMediaStore } from '../../../store/index';
import { DropZone } from './components/DropZone';
import { UploadConfig, FileUploadState, FileValidationConfig } from './FileUploader.types';

interface FileUploaderProps {
  /** Configuration for file validation */
  validation?: Partial<FileValidationConfig>;
  /** Upload options */
  options?: Partial<UploadConfig>;
  /** Callback when files are selected */
  onFilesSelected?: (files: File[]) => void;
  /** Callback when upload starts */
  onUploadStart?: (file: FileUploadState) => void;
  /** Callback when upload completes */
  onUploadComplete?: (file: FileUploadState) => void;
  /** Callback when upload fails */
  onUploadError?: (file: FileUploadState, error: Error) => void;
  /** Custom CSS classes */
  className?: string;
  /** Whether to show upload queue */
  showQueue?: boolean;
  /** Whether to allow multiple files */
  multiple?: boolean;
  /** Disabled state */
  disabled?: boolean;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  validation = {},
  options = {},
  onFilesSelected,
  onUploadStart,
  onUploadComplete,
  onUploadError,
  className = '',
  showQueue = true,
  multiple = true,
  disabled = false,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadQueue, addToUploadQueue, removeFromUploadQueue } = useMediaStore();

  // Default validation config
  const validationConfig: FileValidationConfig = {
    maxSize: validation.maxSize || 100 * 1024 * 1024, // 100MB default
    allowedTypes: validation.allowedTypes || ['image/*', 'video/*', 'audio/*', 'text/*'],
    maxFiles: validation.maxFiles || (multiple ? 10 : 1),
    ...validation,
  };

  // Default upload options
  const uploadOptions: UploadConfig = {
    chunkSize: options.chunkSize || 5 * 1024 * 1024, // 5MB chunks
    ...options,
  };

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      if (disabled) return;

      // Create upload files from selected files
      const uploadFiles: FileUploadState[] = files.map((file, index) => ({
        id: `${Date.now()}-${index}`,
        file,
        status: 'queued', // Initial status is 'queued'
        progress: 0,
        startTime: Date.now(),
        metadata: {
          originalName: file.name,
          size: file.size,
          type: file.type,
          createdAt: new Date().toISOString(),
        },
      }));

      // Add to upload queue
      uploadFiles.forEach((uploadFile) => {
        addToUploadQueue(uploadFile);
      });

      // Notify parent component
      onFilesSelected?.(files);

      // Start uploads (this will be handled by the upload service)
      uploadFiles.forEach((uploadFile) => {
        onUploadStart?.(uploadFile);
      });
    },
    [disabled, addToUploadQueue, onFilesSelected, onUploadStart]
  );

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        handleFilesSelected(Array.from(files));
      }
      // Reset input value to allow re-selecting same files
      if (event.target) {
        event.target.value = '';
      }
    },
    [handleFilesSelected]
  );

  const handleBrowseFiles = useCallback(() => {
    if (disabled) return;
    fileInputRef.current?.click();
  }, [disabled]);

  const handleRemoveFile = useCallback(
    (fileId: string) => {
      removeFromUploadQueue(fileId);
    },
    [removeFromUploadQueue]
  );

  return (
    <div className={`file-uploader ${className}`}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        accept={(validationConfig.allowedTypes ?? ['image/*', 'video/*', 'audio/*', 'text/*']).join(',')}
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        disabled={disabled}
      />

      {/* Drop zone */}
      <DropZone
        validation={validationConfig}
        onFilesSelected={handleFilesSelected}
        onBrowseFiles={handleBrowseFiles}
        disabled={disabled}
        multiple={multiple}
      />

      {/* Upload queue */}
      {showQueue && uploadQueue.length > 0 && (
        <div className="upload-queue">
          <h3 className="upload-queue__title">Upload Queue</h3>
          <div className="upload-queue__list">
            {uploadQueue.map((uploadFile: FileUploadState) => (
              <FileUploadItem
                key={uploadFile.id}
                uploadFile={uploadFile}
                onRemove={handleRemoveFile}
                onComplete={onUploadComplete}
                onError={onUploadError}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// File upload item component for the queue
interface FileUploadItemProps {
  uploadFile: FileUploadState;
  onRemove: (fileId: string) => void;
  onComplete?: (file: FileUploadState) => void;
  onError?: (file: FileUploadState, error: Error) => void;
}

const FileUploadItem: React.FC<FileUploadItemProps> = ({
  uploadFile,
  onRemove,
  onComplete,
  onError,
}) => {
  const { file, status, progress, error } = uploadFile;

  const getStatusColor = () => {
    switch (status) {
      case 'queued':
        return '#6b7280'; // gray
      case 'uploading':
        return '#2563eb'; // blue
      case 'processing':
        return '#f59e0b'; // amber
      case 'completed':
        return '#16a34a'; // green
      case 'error':
        return '#dc2626'; // red
      case 'canceled':
        return '#9ca3af'; // light gray
      default:
        return '#6b7280'; // gray
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="file-upload-item">
      <div className="file-upload-item__info">
        <div className="file-upload-item__name" title={file.name}>
          {file.name}
        </div>
        <div className="file-upload-item__size">
          {formatFileSize(file.size)}
        </div>
      </div>

      <div className="file-upload-item__progress">
        <div className="file-upload-item__progress-bar">
          <div
            className="file-upload-item__progress-fill"
            style={{
              width: `${progress}%`,
              backgroundColor: getStatusColor(),
            }}
          />
        </div>
        <div className="file-upload-item__progress-text">
          {status === 'completed' ? 'Complete' : `${Math.round(progress)}%`}
        </div>
      </div>

      <div className="file-upload-item__status">
        <span
          className="file-upload-item__status-indicator"
          style={{ backgroundColor: getStatusColor() }}
        />
        <span className="file-upload-item__status-text">
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      </div>

      {error && (
        <div className="file-upload-item__error" title={error.message}>
          {error.message}
        </div>
      )}

      <button
        onClick={() => onRemove(uploadFile.id)}
        className="file-upload-item__remove-button"
        title="Remove file"
      >
        &times;
      </button>
    </div>
  );
};