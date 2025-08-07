// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaService } from '../mediaService';

type OnProgress = (p: any) => void;
type OnStatus = (s: any) => void;

function makeFile(size: number, name = 'test.bin') {
  // Create a Blob with the requested size (filled with zeros)
  const chunk = new Uint8Array(size);
  return new File([chunk], name, { type: 'application/octet-stream' });
}

describe('MediaService - chunked upload (unit)', () => {
  let svc: any;

  beforeEach(() => {
    // Construct with any to avoid strict constructor typing in tests
    svc = new (MediaService as any)('https://api.example.com');
  });

  it('uploads multipart file and reports progress -> completes', async () => {
    const file = makeFile(10 * 1024); // 10KB
    const chunkSize = 4 * 1024; // 4KB -> 3 parts
    const partsCount = Math.ceil(file.size / chunkSize);

    // Stub requestPresignedUpload to return a multipart presign response
    vi.spyOn(svc as any, 'requestPresignedUpload').mockResolvedValue({
      strategy: 'multipart',
      uploadId: 'upload-123',
      parts: Array.from({ length: partsCount }).map((_, i) => ({
        partNumber: i + 1,
        url: `https://storage.example.com/upload/part/${i + 1}`,
      })),
      reference: {
        refId: 'ref-1',
        type: 'file',
        url: 'https://storage.example.com/ref-1',
        metadata: { size: file.size, createdAt: new Date().toISOString() },
      },
    } as any);

    // Spy on putChunkXHR to simulate progress and success for each chunk
    const putSpy = vi.spyOn(svc as any, 'putChunkXHR').mockImplementation(async (...args: any[]) => {
      const chunk: Blob = args[1];
      const onChunkProgress: (bytes: number) => void = args[4];
      // Simulate chunk upload progress in two steps
      const size = (chunk as Blob).size;
      onChunkProgress(Math.floor(size / 2));
      // small delay simulation
      await new Promise((r) => setTimeout(r, 1));
      onChunkProgress(size - Math.floor(size / 2));
      return Promise.resolve();
    });

    const progressEvents: any[] = [];
    const statusEvents: any[] = [];

    const options = {
      chunkSize,
      parallel: 2,
      maxRetries: 2,
      backoffBaseMs: 10,
      backoffMaxMs: 50,
      onProgress: (p: any) => progressEvents.push(p),
      onStatus: (s: any) => statusEvents.push(s),
    };

    const result: any = await (svc as any).uploadFile(file, options);

    // Expect putChunkXHR called partsCount times
    expect(putSpy).toHaveBeenCalledTimes(partsCount);

    // bytesUploaded equals total file size
    expect(result.bytesUploaded).toBe(file.size);

    // status events include uploading and completed (or processing then completed)
    const statuses = statusEvents.map((s) => s.status);
    expect(statuses).toContain('uploading');
    expect(statuses).toContain('completed');

    // final progress reached 100 in at least one progress event
    const finalProgress = progressEvents[progressEvents.length - 1];
    expect(finalProgress.progress).toBeGreaterThanOrEqual(100);
  });

  it('retries failed chunk and succeeds', async () => {
    const file = makeFile(6 * 1024); // 6KB
    const chunkSize = 4 * 1024; // 4KB -> 2 parts
    const partsCount = Math.ceil(file.size / chunkSize);

    vi.spyOn(svc as any, 'requestPresignedUpload').mockResolvedValue({
      strategy: 'multipart',
      uploadId: 'upload-456',
      parts: Array.from({ length: partsCount }).map((_, i) => ({
        partNumber: i + 1,
        url: `https://storage.example.com/upload/part/${i + 1}`,
      })),
      reference: {
        refId: 'ref-2',
        type: 'file',
        url: 'https://storage.example.com/ref-2',
        metadata: { size: file.size, createdAt: new Date().toISOString() },
      },
    } as any);

    // For the first chunk call fail once then succeed
    let callCount = 0;
    vi.spyOn(svc as any, 'putChunkXHR').mockImplementation(async (...args: any[]) => {
      callCount++;
      const chunk: Blob = args[1];
      const onChunkProgress: (bytes: number) => void = args[4];
      const size = (chunk as Blob).size;
      onChunkProgress(size); // report progress for simplicity

      if (callCount === 1) {
        // fail first time
        const err: any = new Error('Simulated network error');
        err.status = 500;
        throw err;
      }
      // succeed
      return Promise.resolve();
    });

    const options = {
      chunkSize,
      parallel: 1,
      maxRetries: 2,
      backoffBaseMs: 1,
      backoffMaxMs: 10,
      onProgress: () => {},
      onStatus: () => {},
    };

    const result: any = await (svc as any).uploadFile(file, options);

    // Expect putChunkXHR called at least partsCount + 1 times (one retry)
    expect(callCount).toBeGreaterThanOrEqual(partsCount + 1);
    expect(result.bytesUploaded).toBe(file.size);
  });

  it('aborts upload when signal is aborted', async () => {
    const file = makeFile(8 * 1024);
    const chunkSize = 4 * 1024;
    const partsCount = Math.ceil(file.size / chunkSize);

    vi.spyOn(svc as any, 'requestPresignedUpload').mockResolvedValue({
      strategy: 'multipart',
      uploadId: 'upload-abort',
      parts: Array.from({ length: partsCount }).map((_, i) => ({
        partNumber: i + 1,
        url: `https://storage.example.com/upload/part/${i + 1}`,
      })),
      reference: {
        refId: 'ref-abort',
        type: 'file',
        url: 'https://storage.example.com/ref-abort',
        metadata: { size: file.size, createdAt: new Date().toISOString() },
      },
    } as any);

    // putChunkXHR will wait until signal aborted to reject
    vi.spyOn(svc as any, 'putChunkXHR').mockImplementation(async (...args: any[]) => {
      const signal: AbortSignal = args[3];
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          const err: any = new Error('aborted');
          err.code = 'ABORT_ERR';
          return reject(err);
        }
        signal.addEventListener('abort', () => {
          const err: any = new Error('aborted');
          err.code = 'ABORT_ERR';
          reject(err);
        });
        // otherwise hang (we won't let it resolve)
      });
    });

    const controller = new AbortController();

    const options = {
      chunkSize,
      parallel: 2,
      maxRetries: 1,
      backoffBaseMs: 1,
      backoffMaxMs: 5,
      onProgress: () => {},
      onStatus: () => {},
      signal: controller.signal,
    };

    const uploadPromise = (svc as any).uploadFile(file, options);

    // abort shortly after
    setTimeout(() => controller.abort(), 5);

    await expect(uploadPromise).rejects.toMatchObject({ code: 'ABORT_ERR' });
  });
});