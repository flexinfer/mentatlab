// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaService } from '../mediaService';

/**
 * Unit tests for MediaService.
 *
 * The current implementation uses:
 *   constructor(http: HttpClient, ws: WebSocketClient | null)
 *   uploadFile(file, { onProgress?, metadata? }) -> Promise<MediaReference>
 *
 * Internally it calls:
 *   getPresignedUrl(params) -> { uploadUrl, reference }
 *   chunkFile(file) -> Blob[]
 *   uploadChunks(fileId, chunks, uploadUrl, onProgress?, abortSignal?) -> void
 *
 * uploadChunks uses XMLHttpRequest internally. We mock the private methods
 * getPresignedUrl and the XHR layer to exercise the public API.
 */

function makeFile(size: number, name = 'test.bin') {
  const chunk = new Uint8Array(size);
  return new File([chunk], name, { type: 'application/octet-stream' });
}

// Minimal HttpClient stub satisfying BaseService constructor
function makeMockHttp(): any {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    defaults: {
      baseURL: '',
      headers: { common: {} },
    },
  };
}

describe('MediaService - upload (unit)', () => {
  let svc: MediaService;
  let mockHttp: any;

  beforeEach(() => {
    mockHttp = makeMockHttp();
    svc = new MediaService(mockHttp, null);
  });

  it('uploads file via getPresignedUrl + uploadChunks and returns reference', async () => {
    const file = makeFile(1024); // 1KB - well under chunk size, so one chunk

    const fakeReference = {
      refId: 'ref-1',
      type: 'file' as const,
      url: 'https://storage.example.com/ref-1',
      metadata: { size: file.size, createdAt: new Date().toISOString() },
    };

    // Stub the private getPresignedUrl method
    vi.spyOn(svc as any, 'getPresignedUrl').mockResolvedValue({
      uploadUrl: 'https://storage.example.com/upload',
      reference: fakeReference,
    });

    // Stub uploadChunks to simulate a successful upload
    const uploadChunksSpy = vi.spyOn(svc as any, 'uploadChunks').mockResolvedValue(undefined);

    const progressEvents: any[] = [];
    const result = await svc.uploadFile(file, {
      onProgress: (p) => progressEvents.push(p),
    });

    // getPresignedUrl should have been called with the file metadata
    expect((svc as any).getPresignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'test.bin',
        mimeType: 'application/octet-stream',
        size: 1024,
      })
    );

    // uploadChunks should have been called
    expect(uploadChunksSpy).toHaveBeenCalled();

    // Return value should be the MediaReference from getPresignedUrl
    expect(result).toEqual(fakeReference);
    expect(result.refId).toBe('ref-1');
  });

  it('propagates errors from getPresignedUrl', async () => {
    const file = makeFile(512);

    vi.spyOn(svc as any, 'getPresignedUrl').mockRejectedValue(
      new Error('Presign failed')
    );

    await expect(svc.uploadFile(file)).rejects.toThrow('Presign failed');
  });

  it('propagates errors from uploadChunks', async () => {
    const file = makeFile(512);

    vi.spyOn(svc as any, 'getPresignedUrl').mockResolvedValue({
      uploadUrl: 'https://storage.example.com/upload',
      reference: { refId: 'ref-err', type: 'file' },
    });

    vi.spyOn(svc as any, 'uploadChunks').mockRejectedValue(
      new Error('Chunk upload failed')
    );

    await expect(svc.uploadFile(file)).rejects.toThrow('Chunk upload failed');
  });

  it('cancelUpload aborts an in-progress upload', async () => {
    const file = makeFile(512);

    vi.spyOn(svc as any, 'getPresignedUrl').mockResolvedValue({
      uploadUrl: 'https://storage.example.com/upload',
      reference: { refId: 'ref-cancel', type: 'file' },
    });

    // Make uploadChunks hang until abort
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(svc as any, 'uploadChunks').mockImplementation(
      async (_fileId: string, _chunks: Blob[], _url: string, _onProgress: any, signal?: AbortSignal) => {
        capturedSignal = signal;
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            return reject(new Error('Upload cancelled'));
          }
          signal?.addEventListener('abort', () => {
            reject(new Error('Upload cancelled'));
          });
        });
      }
    );

    // Start upload (don't await yet)
    const uploadPromise = svc.uploadFile(file);

    // Wait a tick for the internal fileId to be set
    await new Promise((r) => setTimeout(r, 0));

    // The uploadAbortControllers map should have one entry; cancel it
    // We need to get the fileId from the map. Since it's a UUID, iterate.
    const controllers = (svc as any).uploadAbortControllers as Map<string, AbortController>;
    expect(controllers.size).toBe(1);

    const fileId = [...controllers.keys()][0];
    svc.cancelUpload(fileId);

    await expect(uploadPromise).rejects.toThrow('Upload cancelled');
  });

  it('chunkFile splits large files into CHUNK_SIZE pieces', () => {
    // CHUNK_SIZE is 5MB (5 * 1024 * 1024)
    const chunkSize = 5 * 1024 * 1024;
    const fileSize = chunkSize * 2 + 100; // 2 full chunks + partial
    const file = makeFile(fileSize);

    const chunks = (svc as any).chunkFile(file) as Blob[];
    expect(chunks.length).toBe(3);
    expect(chunks[0].size).toBe(chunkSize);
    expect(chunks[1].size).toBe(chunkSize);
    expect(chunks[2].size).toBe(100);
  });
});
