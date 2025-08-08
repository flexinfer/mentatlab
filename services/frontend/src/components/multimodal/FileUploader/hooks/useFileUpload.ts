/**
 * useFileUpload hook - wired to MediaService and MediaStore
 *
 * Provides:
 *  - enqueue(files, metadata?)
 *  - start(id)
 *  - startAll()
 *  - cancel(id)
 *  - retry(id)
 *  - remove(id)
 *
 * Notes:
 *  - Uses MediaService.getMediaService(httpClient, websocketClient)
 *  - Persists upload state into useMediaStore
 *  - Keeps derived metrics locally in a ref (speed/eta)
 */
import { useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getMediaService } from '../../../../services/api/mediaService';
import { httpClient } from '../../../../services/api/httpClient';
import { websocketClient } from '../../../../services/api/websocketClient';
import { UploadOptions, UploadProgress, FileUploadState } from '../FileUploader.types';
import useMediaStore from '../../../../store';

const MB = 1024 * 1024;

function chooseChunkSize(bytes: number): number {
  if (bytes <= 100 * MB) return 5 * MB;
  if (bytes <= 500 * MB) return 8 * MB;
  return 12 * MB;
}

export default function useFileUpload() {
  const mediaServiceRef = useRef(getMediaService(httpClient, websocketClient));
  const progressMetaRef = useRef(new Map<string, { speedBps?: number; etaSeconds?: number }>());
  const store = useMediaStore();

  // enqueue(files, metadata?)
  const enqueue = useCallback((files: File[], metadata?: Record<string, any>) => {
    const add = (useMediaStore.getState() as any).addToUploadQueue;
    files.forEach((file) => {
      const state: FileUploadState = {
        id: uuidv4(),
        file,
        status: 'queued',
        progress: 0,
        startTime: Date.now(),
        metadata: { ...(metadata || {}), originalName: file.name, size: file.size, type: file.type },
        chunkSize: chooseChunkSize(file.size),
        parallel: 3,
      };
      add(state);
    });
  }, []);

  // start(id)
  const start = useCallback(async (id: string) => {
    const item = (store as any).uploadQueue.find((u: FileUploadState) => u.id === id);
    if (!item) return;
    if (!['queued', 'error', 'canceled'].includes(item.status)) return;

    // Create AbortController and store on queue item
    const controller = new AbortController();
    useMediaStore.setState((s: any) => {
      const idx = s.uploadQueue.findIndex((f: FileUploadState) => f.id === id);
      if (idx !== -1) {
        s.uploadQueue[idx].abortController = controller;
        s.uploadQueue[idx].attempts = (s.uploadQueue[idx].attempts || 0) + 1;
        s.uploadQueue[idx].status = 'uploading';
      }
      return s;
    });

    // inform processing state
    (store as any).setProcessingState?.(id, 'uploading');

    // progress bridge
    const onProgress = (p: any) => {
      const percentage =
        typeof p?.percentage === 'number'
          ? p.percentage
          : Math.round(((p?.loaded || 0) / (p?.total || item.file.size)) * 100);
      (store as any).setUploadProgress?.(id, percentage);
 
      // store derived metrics locally if desired
      const meta = progressMetaRef.current.get(id) || {};
      progressMetaRef.current.set(id, meta);
    };

    // Build UploadOptions (note: MediaService.uploadFile accepts onProgress + metadata)
    const options: Partial<UploadOptions & { onProgress?: any; onStatus?: any; signal?: AbortSignal }> = {
      chunkSize: item.chunkSize || chooseChunkSize(item.file.size),
      parallel: item.parallel || 3,
      onProgress,
      onStatus: (s: UploadProgress) => {
        (store as any).setProcessingState?.(id, s.status);
      },
      signal: controller.signal,
      contentType: item.file.type || undefined,
      metadata: item.metadata,
    };

    try {
      // Call MediaService (it accepts { onProgress, metadata } per current implementation)
      const reference = await mediaServiceRef.current.uploadFile(item.file, {
        onProgress: (p: any) => {
          // Normalize and forward progress updates
          if (p && typeof p.percentage === 'number') {
            onProgress(p);
          } else {
            onProgress(p);
          }
        },
        metadata: item.metadata,
      } as any);

      // Success
      (store as any).setProcessingState?.(id, 'completed');
      (store as any).addMediaItem?.(reference);
      (store as any).removeFromUploadQueue?.(id);
      progressMetaRef.current.delete(id);
    } catch (err: any) {
      const isAborted =
        err?.code === 'ABORT_ERR' ||
        err?.name === 'AbortError' ||
        String(err?.message || '').toLowerCase().includes('abort');

      if (isAborted) {
        (store as any).setProcessingState?.(id, 'canceled');
        return;
      }

      // Persist error on queue item
      useMediaStore.setState((s: any) => {
        const idx = s.uploadQueue.findIndex((f: FileUploadState) => f.id === id);
        if (idx !== -1) {
          s.uploadQueue[idx].status = 'error';
          s.uploadQueue[idx].error = {
            code: err?.code || 'UPLOAD_ERROR',
            message: err?.message || String(err),
            retriable: true,
          };
        }
        return s;
      });
      (useMediaStore.getState() as any).setProcessingState?.(id, 'error');
    }
  }, []);

  // startAll(): serial for simplicity (concurrency <=2 could be added)
  const startAll = useCallback(async () => {
    const queued = (((useMediaStore.getState() as any).uploadQueue) as FileUploadState[]).filter((u: FileUploadState) => u.status === 'queued');
    for (const item of queued) {
      // serial to keep concurrency small
      // eslint-disable-next-line no-await-in-loop
      await start(item.id);
    }
  }, [start]);

  // cancel(id)
  const cancel = useCallback((id: string) => {
    const state: any = useMediaStore.getState();
    const item = state.uploadQueue.find((u: FileUploadState) => u.id === id);
    if (!item) return;
    try {
      item.abortController?.abort();
    } catch {
      // ignore
    }
    (useMediaStore.getState() as any).setProcessingState?.(id, 'canceled');
  }, []);

  // retry(id)
  const retry = useCallback(async (id: string) => {
    useMediaStore.setState((s: any) => {
      const idx = s.uploadQueue.findIndex((f: FileUploadState) => f.id === id);
      if (idx !== -1) {
        s.uploadQueue[idx].progress = 0;
        s.uploadQueue[idx].error = undefined;
        s.uploadQueue[idx].status = 'queued';
      }
      return s;
    });
    await start(id);
  }, [start]);

  // remove(id)
  const remove = useCallback((id: string) => {
    (useMediaStore.getState() as any).removeFromUploadQueue?.(id);
    progressMetaRef.current.delete(id);
  }, []);

  return {
    enqueue,
    start,
    startAll,
    cancel,
    retry,
    remove,
  };
}