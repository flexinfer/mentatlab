/**
 * useDragDrop - lightweight drag & drop hook for FileUploader
 *
 * This hook enforces accept map and 1GB max size, validates files on drop,
 * and calls useFileUpload().enqueue(...) with accepted files.
 *
 * It returns:
 *  - getRootProps: props to spread on the drop root element (onDragEnter/Leave/Over/Drop)
 *  - getInputProps: props for a hidden file input (type=file)
 *  - isDragActive: boolean indicating drag state
 *  - onDropErrors: array of { fileName, reason } for UI display
 *
 * Note: This implementation avoids a hard dependency on `react-dropzone`.
 * If you prefer to use react-dropzone, replace this implementation with it.
 */
import { useState, useRef, useCallback } from 'react';
import useFileUpload from './useFileUpload';
import { ValidationResult, DragDropOptions } from '../FileUploader.types';

const ONE_GB = 1024 * 1024 * 1024;

const DEFAULT_ACCEPT = {
  'audio/*': ['.wav', '.mp3'],
  'image/*': ['.png', '.jpg', '.jpeg'],
  'video/*': ['.mp4', '.webm'],
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function useDragDrop() {
  const [isDragging, setIsDragging] = useState(false);
  const [onDropErrors, setOnDropErrors] = useState<Array<{ fileName: string; reason: string }>>([]);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { enqueue } = useFileUpload();

  const validateFile = useCallback((file: File): ValidationResult => {
    if (file.size > ONE_GB) {
      return { valid: false, error: `File ${file.name} exceeds maximum size of 1 GB` };
    }

    // Build accepted extensions/mime map
    const acceptedEntries = Object.entries(DEFAULT_ACCEPT);

    const isAccepted = acceptedEntries.some(([mime, extensions]) => {
      if (mime.includes('*')) {
        const baseType = mime.split('/')[0];
        if (file.type && file.type.startsWith(baseType + '/')) return true;
        // also check extension
        return extensions.some((ext) => file.name.toLowerCase().endsWith(ext.toLowerCase()));
      }
      // exact mime match
      if (file.type === mime) return true;
      return extensions.some((ext) => file.name.toLowerCase().endsWith(ext.toLowerCase()));
    });

    if (!isAccepted) {
      const allowed = acceptedEntries
        .map(([mime, exts]) => `${mime} (${exts.join(',')})`)
        .join(', ');
      return { valid: false, error: `File ${file.name} type not accepted. Allowed: ${allowed}` };
    }
    return { valid: true };
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer?.items) {
      const hasFiles = Array.from(e.dataTransfer.items).some((it) => it.kind === 'file');
      if (hasFiles) {
        setIsDragging(true);
        setOnDropErrors([]);
      }
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounter.current = 0;
    setIsDragging(false);
    setOnDropErrors([]);

    const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length === 0) return;

    const accepted: File[] = [];
    const errors: Array<{ fileName: string; reason: string }> = [];

    files.forEach((file) => {
      const res = validateFile(file);
      if (res.valid) accepted.push(file);
      else errors.push({ fileName: file.name, reason: res.error || 'Rejected' });
    });

    if (accepted.length > 0) {
      enqueue(accepted);
    }
    if (errors.length > 0) {
      setOnDropErrors(errors);
    }
  }, [enqueue, validateFile]);

  // input fallback for users who click to browse
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    const accepted: File[] = [];
    const errors: Array<{ fileName: string; reason: string }> = [];

    files.forEach((file) => {
      const res = validateFile(file);
      if (res.valid) accepted.push(file);
      else errors.push({ fileName: file.name, reason: res.error || 'Rejected' });
    });

    if (accepted.length > 0) enqueue(accepted);
    if (errors.length > 0) setOnDropErrors(errors);

    if (e.target) e.target.value = '';
  }, [enqueue, validateFile]);

  const getRootProps = useCallback(() => ({
    onDragEnter: handleDragEnter,
    onDragLeave: handleDragLeave,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
  }), [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  const getInputProps = useCallback(() => ({
    ref: fileInputRef,
    type: 'file',
    multiple: true,
    accept: Object.values(DEFAULT_ACCEPT).flat().join(','),
    onChange: handleInputChange,
    style: { display: 'none' } as React.CSSProperties,
  }), [handleInputChange]);

  const dragHandlers = getRootProps();
  const dragError = onDropErrors.length > 0
    ? `${onDropErrors[0].fileName}: ${onDropErrors[0].reason}`
    : null;

  return {
    // Modern API
    getRootProps,
    getInputProps,
    isDragActive: isDragging,
    onDropErrors,

    // Backwards-compatible aliases/helpers expected by DropZone
    isDragging: isDragging,        // alias of isDragActive
    dragHandlers,                  // same shape as getRootProps() result, spreadable on root element
    dragError,                     // first error formatted as "fileName: reason" or null
  };
}