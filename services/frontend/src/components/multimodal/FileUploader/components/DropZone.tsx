/**
 * DropZone component for FileUploader
 * Based on Phase 2 Core Features Architecture
 */

import React, { useRef } from 'react';
import { useDragDrop, formatFileSize } from '../hooks/useDragDrop';
import { DragDropOptions, FileValidationConfig } from '../FileUploader.types';
 
interface DropZoneProps { // Removed extends DragDropOptions
  validation: FileValidationConfig; // Added validation prop
  onFilesSelected: (files: File[]) => void; // Renamed from onDrop
  onBrowseFiles: () => void; // New prop
  disabled?: boolean;
  multiple?: boolean;
  className?: string;
  children?: React.ReactNode;
}
 
export const DropZone: React.FC<DropZoneProps> = ({
  validation, // Destructure validation
  onFilesSelected, // Renamed from onDrop
  onBrowseFiles, // New prop
  disabled = false,
  multiple = true,
  className = '',
  children,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { isDragging, dragError, dragHandlers } = (useDragDrop as any)({
    allowedTypes: validation.allowedTypes, // Pass validation props
    maxSize: validation.maxSize, // Pass validation props
    multiple,
    onFilesSelected, // Pass renamed prop
    onDragError: (error: any) => { /* handle error */ }, // Add specific error handler
  });

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFilesSelected(Array.from(files)); // Use onFilesSelected
      // Reset input to allow selecting the same files again
      e.target.value = '';
    }
  };

  const handleClick = () => {
    if (!disabled) {
      onBrowseFiles(); // Use onBrowseFiles prop
    }
  };

  const getAcceptString = () => {
    if (!validation.allowedTypes) return undefined;
    
    return validation.allowedTypes.join(',');
  };

  const getDropZoneClasses = () => {
    const baseClasses = [
      'dropzone',
      'border-2',
      'border-dashed',
      'rounded-lg',
      'p-8',
      'text-center',
      'transition-all',
      'duration-200',
      'cursor-pointer',
      'min-h-[200px]',
      'flex',
      'flex-col',
      'items-center',
      'justify-center',
      'gap-4'
    ];

    if (disabled) {
      // Disabled: dim and use card background in dark mode
      baseClasses.push('opacity-50', 'cursor-not-allowed', 'border-gray-600', 'dark:border-border', 'bg-gray-50', 'dark:mc-card-bg');
    } else if (dragError) {
      // Error state: keep red indicators but use darker bg in dark mode
      baseClasses.push('border-red-400', 'bg-red-50', 'dark:bg-red-900/20', 'text-red-600');
    } else if (isDragging) {
      // Dragging state: highlight, but avoid very bright bg in dark mode
      baseClasses.push('border-blue-400', 'bg-blue-50', 'dark:mc-card-bg', 'text-blue-600', 'scale-105');
    } else {
      // Default: gentle gray that becomes card background in dark mode
      baseClasses.push('border-gray-300', 'hover:border-gray-400', 'hover:bg-gray-50', 'dark:mc-card-bg', 'dark:border-border', 'dark:hover:opacity-90');
    }

    return baseClasses.join(' ') + (className ? ` ${className}` : '');
  };

  const renderContent = () => {
    if (children) {
      return children;
    }

    if (dragError) {
      return (
        <div className="text-center">
          <div className="text-red-500 mb-2">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-red-600">{dragError}</p>
        </div>
      );
    }

    if (isDragging) {
      return (
        <div className="text-center">
          <div className="text-blue-500 mb-2">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="text-lg font-medium text-blue-600">Drop files here</p>
        </div>
      );
    }

    return (
      <div className="text-center">
        <div className="text-gray-400 mb-4">
          <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
        <div className="space-y-2">
          <p className="text-lg font-medium text-gray-700">
            Drag & drop files here, or{' '}
            <span className="text-blue-600 underline">browse</span>
          </p>
          {renderFileConstraints()}
        </div>
      </div>
    );
  };

  const renderFileConstraints = () => {
    const constraints = [];
    
    if (validation.maxSize) {
      constraints.push(`Max size: ${formatFileSize(validation.maxSize)}`);
    }
    
    if (validation.allowedTypes && validation.allowedTypes.length > 0) {
      constraints.push(`Accepted types: ${validation.allowedTypes.join(', ')}`);
    }
    
    if (!multiple) {
      constraints.push('Single file only');
    }

    if (constraints.length === 0) return null;

    return (
      <p className="text-sm text-gray-500">
        {constraints.join(' • ')}
      </p>
    );
  };

  return (
    <>
      <div
        className={getDropZoneClasses()}
        onClick={handleClick}
        {...(disabled ? {} : dragHandlers)}
      >
        {renderContent()}
      </div>
      
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={getAcceptString()}
        multiple={multiple}
        onChange={handleFileInputChange}
        disabled={disabled}
      />
    </>
  );
};

export default DropZone;