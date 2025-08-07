/**
 * Media-related type definitions for multimodal support in MentatLab
 */

/**
 * Supported media types in the system
 */
export enum MediaType {
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
  DOCUMENT = 'document',
  TEXT = 'text',
}

/**
 * Common metadata for all media types
 */
export interface MediaMetadata {
  /** Unique identifier for the media */
  id: string;
  /** Original filename */
  filename?: string;
  /** File size in bytes */
  size?: number;
  /** MIME type */
  mimeType: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last modified timestamp */
  updatedAt?: string;
  /** Storage location/URL */
  url?: string;
  /** Checksum for integrity verification */
  checksum?: string;
  /** Additional custom metadata */
  custom?: Record<string, any>;
}

/**
 * Image-specific metadata
 */
export interface ImageMetadata extends MediaMetadata {
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Color depth (bits per pixel) */
  colorDepth?: number;
  /** Color space (e.g., RGB, CMYK) */
  colorSpace?: string;
  /** EXIF data */
  exif?: Record<string, any>;
}

/**
 * Audio-specific metadata
 */
export interface AudioMetadata extends MediaMetadata {
  /** Duration in seconds */
  duration: number;
  /** Sample rate in Hz */
  sampleRate?: number;
  /** Number of channels (mono, stereo, etc.) */
  channels?: number;
  /** Bit rate in kbps */
  bitRate?: number;
  /** Audio codec */
  codec?: string;
}

/**
 * Video-specific metadata
 */
export interface VideoMetadata extends MediaMetadata {
  /** Duration in seconds */
  duration: number;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Frame rate (fps) */
  frameRate?: number;
  /** Video codec */
  videoCodec?: string;
  /** Audio codec */
  audioCodec?: string;
  /** Bit rate in kbps */
  bitRate?: number;
}

/**
 * Document-specific metadata
 */
export interface DocumentMetadata extends MediaMetadata {
  /** Number of pages */
  pageCount?: number;
  /** Document format (pdf, docx, etc.) */
  format?: string;
  /** Document language */
  language?: string;
  /** Author information */
  author?: string;
  /** Document title */
  title?: string;
}

/**
 * Storage location details
 */
export interface StorageLocation {
  /** Type of storage */
  type: 'local' | 'remote' | 's3' | 'memory' | 'cache' | 'cdn';
  /** Storage-specific configuration */
  config?: {
    /** S3 bucket name */
    bucket?: string;
    /** S3 region */
    region?: string;
    /** CDN endpoint */
    cdnEndpoint?: string;
    /** Cache TTL in seconds */
    cacheTTL?: number;
    /** Custom headers for access */
    headers?: Record<string, string>;
  };
}

/**
 * Media reference for efficient handling of large media assets
 */
export interface MediaReference {
  /** Canonical type used by the store and architect spec.
   * Keep existing MediaType values available, but ensure 'file' is also allowed.
   */
  type: MediaType | 'file';

  /** Reference ID for the media asset (required) */
  refId: string;

  /** Storage location (retain existing field for backwards compatibility) */
  storageLocation?: 'local' | 'remote' | 's3' | 'memory' | 'cache' | 'cdn';

  /** Detailed storage information */
  storage?: StorageLocation;

  /** URL or path to the media (optional per architect minimum) */
  url?: string;

  /** Thumbnail URL for preview (optional) */
  thumbnailUrl?: string;

  /** Signed URL for temporary access */
  signedUrl?: {
    url: string;
    expiresAt: string;
  };

  /**
   * Metadata: preserve the richer typed metadata but also ensure the
   * canonical minimal shape required by the Architect spec is present.
   */
  metadata?: {
    size?: number;
    createdAt?: string;
    mimeType?: string;
    duration?: number;
    waveform?: number[];
    [k: string]: any;
  } | ImageMetadata | AudioMetadata | VideoMetadata | DocumentMetadata | MediaMetadata;

  /** Processing status (retain existing statuses) */
  status?: 'pending' | 'uploading' | 'processing' | 'ready' | 'error' | 'archived';

  /** Error message if status is error */
  error?: string;

  /** Processing progress (0-100) */
  progress?: number;

  /** Multiple thumbnail sizes (retain existing structure) */
  thumbnails?: {
    small?: string;
    medium?: string;
    large?: string;
    custom?: Record<string, string>;
  };

  /** Alternative representations */
  alternates?: {
    [key: string]: {
      url: string;
      mimeType: string;
      quality?: string;
      size?: number;
      dimensions?: { width: number; height: number };
    };
  };

  /** Access control */
  access?: {
    /** Whether the media is public */
    public?: boolean;
    /** Access permissions */
    permissions?: string[];
    /** Expiration date for the media */
    expiresAt?: string;
    /** Required authentication */
    requiresAuth?: boolean;
  };

  /** Related media references (retain existing structure) */
  related?: {
    /** Parent media reference */
    parent?: string;
    /** Child media references */
    children?: string[];
    /** Associated media (e.g., subtitles for video) */
    associated?: Array<{
      refId: string;
      type: string;
      relationship: string;
    }>;
  };

  /** Processing history */
  processingHistory?: Array<{
    timestamp: string;
    operation: string;
    status: 'success' | 'failure';
    details?: any;
  }>;
}

/**
 * Media processing options
 */
export interface MediaProcessingOptions {
  /** Resize options for images/video */
  resize?: {
    width?: number;
    height?: number;
    mode?: 'fit' | 'fill' | 'stretch' | 'crop' | 'pad';
    /** Maintain aspect ratio */
    maintainAspectRatio?: boolean;
    /** Background color for padding */
    backgroundColor?: string;
  };
  /** Crop options */
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Rotation in degrees */
  rotate?: number;
  /** Flip options */
  flip?: {
    horizontal?: boolean;
    vertical?: boolean;
  };
  /** Compression quality (0-100) */
  quality?: number;
  /** Format conversion */
  format?: string;
  /** Audio processing options */
  audio?: {
    sampleRate?: number;
    channels?: number;
    bitRate?: number;
    /** Volume adjustment (1.0 = normal) */
    volume?: number;
    /** Noise reduction */
    noiseReduction?: boolean;
    /** Audio effects */
    effects?: Array<{
      type: 'echo' | 'reverb' | 'pitch' | 'tempo';
      params: Record<string, any>;
    }>;
  };
  /** Video processing options */
  video?: {
    fps?: number;
    bitRate?: number;
    codec?: string;
    /** Video filters */
    filters?: Array<{
      type: 'brightness' | 'contrast' | 'saturation' | 'blur' | 'sharpen';
      value: number;
    }>;
    /** Watermark options */
    watermark?: {
      type: 'text' | 'image';
      content: string;
      position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';
      opacity?: number;
      size?: number;
    };
    /** Trim options */
    trim?: {
      start: number;
      end: number;
    };
  };
  /** Advanced processing options */
  advanced?: {
    /** Use GPU acceleration if available */
    useGPU?: boolean;
    /** Multi-threading options */
    threads?: number;
    /** Priority level */
    priority?: 'low' | 'normal' | 'high';
    /** Processing preset */
    preset?: string;
  };
}

/**
 * Media upload progress
 */
export interface MediaUploadProgress {
  /** Upload ID */
  uploadId: string;
  /** Progress percentage (0-100) */
  progress: number;
  /** Bytes uploaded */
  bytesUploaded: number;
  /** Total bytes */
  totalBytes: number;
  /** Upload speed in bytes/second */
  speed?: number;
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number;
  /** Current status */
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  /** Error message if failed */
  error?: string;
}

/**
 * Media chunk for streaming
 */
export interface MediaChunk {
  /** Chunk sequence number */
  sequence: number;
  /** Chunk data (base64 encoded for binary data) */
  data: string | ArrayBuffer;
  /** Indicates if this is the final chunk */
  isFinal: boolean;
  /** Total expected chunks */
  totalChunks?: number;
  /** Chunk size in bytes */
  size: number;
  /** Checksum for this chunk */
  checksum?: string;
}

/**
 * Media streaming session
 */
export interface MediaStreamingSession {
  /** Session ID */
  sessionId: string;
  /** Media type being streamed */
  mediaType: MediaType;
  /** Streaming protocol */
  protocol: 'websocket' | 'http-streaming' | 'webrtc' | 'hls' | 'dash' | 'rtmp';
  /** Session status */
  status: 'initializing' | 'active' | 'paused' | 'buffering' | 'completed' | 'error' | 'reconnecting';
  /** Start timestamp */
  startedAt: string;
  /** End timestamp */
  endedAt?: string;
  /** Chunks received/sent */
  chunksProcessed: number;
  /** Total bytes processed */
  bytesProcessed: number;
  /** Current bitrate */
  currentBitrate?: number;
  /** Associated media reference */
  mediaRef?: MediaReference;
  /** Stream quality settings */
  quality?: {
    /** Current quality level */
    current: 'auto' | 'low' | 'medium' | 'high' | 'ultra';
    /** Available quality levels */
    available: string[];
    /** Adaptive bitrate enabled */
    adaptiveBitrate?: boolean;
  };
  /** Stream metrics */
  metrics?: {
    /** Latency in milliseconds */
    latency?: number;
    /** Packet loss percentage */
    packetLoss?: number;
    /** Jitter in milliseconds */
    jitter?: number;
    /** Buffer health (0-100) */
    bufferHealth?: number;
    /** Frames per second */
    fps?: number;
    /** Dropped frames */
    droppedFrames?: number;
  };
  /** Client information */
  client?: {
    /** Client ID */
    id: string;
    /** Client IP */
    ip?: string;
    /** User agent */
    userAgent?: string;
    /** Connection type */
    connectionType?: 'wifi' | 'cellular' | 'ethernet' | 'unknown';
  };
}

/**
 * Media analytics data
 */
export interface MediaAnalytics {
  /** Media reference ID */
  mediaRefId: string;
  /** View/play count */
  viewCount: number;
  /** Total watch time in seconds */
  totalWatchTime: number;
  /** Average watch percentage */
  averageWatchPercentage: number;
  /** Engagement metrics */
  engagement?: {
    likes?: number;
    shares?: number;
    comments?: number;
  };
  /** Performance metrics */
  performance?: {
    /** Average load time in milliseconds */
    averageLoadTime?: number;
    /** Error rate percentage */
    errorRate?: number;
    /** Buffering events */
    bufferingEvents?: number;
  };
  /** Geographic distribution */
  geoDistribution?: Record<string, number>;
  /** Device distribution */
  deviceDistribution?: {
    desktop?: number;
    mobile?: number;
    tablet?: number;
    tv?: number;
  };
}

/**
 * Media collection/playlist
 */
export interface MediaCollection {
  /** Collection ID */
  id: string;
  /** Collection name */
  name: string;
  /** Description */
  description?: string;
  /** Collection type */
  type: 'playlist' | 'album' | 'gallery' | 'series';
  /** Media references in order */
  items: MediaReference[];
  /** Total duration for time-based media */
  totalDuration?: number;
  /** Cover image */
  coverImage?: MediaReference;
  /** Creation date */
  createdAt: string;
  /** Last updated */
  updatedAt: string;
  /** Metadata */
  metadata?: Record<string, any>;
}