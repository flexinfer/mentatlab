import { MediaReference, MediaType, MediaProcessingOptions } from './media';

export interface NodeIO {
  name: string;
  type: string;
}

export interface AgentSpec {
  id: string;
  version: string;
  image: string;
  runtime: string;
  description?: string;
  inputs?: NodeIO[];
  outputs?: NodeIO[];
  longRunning?: boolean;
  ui?: Record<string, unknown>;
}

export interface ToolSpec {
  id: string;
  description?: string;
  inputs?: NodeIO[];
  outputs?: NodeIO[];
}

/**
 * Extended pin types with multimodal support
 */
export type PinType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "binary"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "media"   // Generic media type
  | "stream"; // For streaming data

export interface Pin {
  name: string;
  type: PinType;
  /** Optional description for the pin */
  description?: string;
  /** Whether this pin is required */
  required?: boolean;
  /** Default value if any */
  defaultValue?: any;
  /** Supported media types if this is a media pin */
  supportedMediaTypes?: MediaType[];
  /** Maximum size in bytes for media pins */
  maxSize?: number;
  /** Whether this pin supports streaming */
  streaming?: boolean;
  /** Validation rules */
  validation?: {
    /** Allowed MIME types for media pins */
    mimeTypes?: string[];
    /** Maximum dimensions for image/video */
    maxDimensions?: {
      width: number;
      height: number;
    };
    /** Minimum dimensions for image/video */
    minDimensions?: {
      width: number;
      height: number;
    };
    /** Maximum duration in seconds for audio/video */
    maxDuration?: number;
    /** Minimum duration in seconds for audio/video */
    minDuration?: number;
    /** Sample rate constraints for audio */
    sampleRateRange?: {
      min: number;
      max: number;
    };
    /** Bit rate constraints for audio/video */
    bitRateRange?: {
      min: number;
      max: number;
    };
    /** Frame rate constraints for video */
    frameRateRange?: {
      min: number;
      max: number;
    };
    /** Other validation rules */
    min?: number;
    max?: number;
    pattern?: string;
    enum?: any[];
    /** Custom validation function name */
    customValidator?: string;
  };
  /** Processing options for media pins */
  processingOptions?: MediaProcessingOptions;
  /** Metadata specific to the pin type */
  metadata?: {
    /** For stream pins: expected message frequency */
    streamFrequency?: 'realtime' | 'periodic' | 'on-demand';
    /** For media pins: whether to auto-generate thumbnails */
    generateThumbnails?: boolean;
    /** For media pins: whether to extract metadata automatically */
    extractMetadata?: boolean;
    /** For document pins: supported document types */
    documentTypes?: string[];
    /** Encoding preferences */
    encoding?: string;
    /** Compression settings */
    compression?: {
      enabled: boolean;
      algorithm?: string;
      level?: number;
    };
  };
}

/**
 * Pin data wrapper for runtime values
 */
export interface PinData<T = any> {
  /** The actual data value */
  value: T;
  /** Media reference if the data is a media asset */
  mediaRef?: MediaReference;
  /** Stream ID if the data is being streamed */
  streamId?: string;
  /** Metadata about the data */
  metadata?: {
    /** Timestamp when the data was set */
    timestamp: string;
    /** Source of the data */
    source?: string;
    /** Processing status */
    status?: 'pending' | 'processing' | 'ready' | 'error';
    /** Error details if status is error */
    error?: string;
    /** Size in bytes for binary data */
    size?: number;
    /** Checksum for integrity verification */
    checksum?: string;
    /** Encoding used for the data */
    encoding?: string;
    /** Whether the data is compressed */
    compressed?: boolean;
    /** Processing duration in milliseconds */
    processingTime?: number;
  };
}

/**
 * Media-aware pin value
 */
export type MediaPinValue = {
  /** Direct data for small media (base64) */
  data?: string;
  /** Reference for large media assets */
  ref?: MediaReference;
  /** Processing options to apply */
  processing?: MediaProcessingOptions;
  /** Inline metadata for quick access */
  inlineMetadata?: {
    mimeType: string;
    size: number;
    dimensions?: { width: number; height: number };
    duration?: number;
  };
};

/**
 * Stream-aware pin value
 */
export interface StreamPinValue {
  /** Stream identifier */
  streamId: string;
  /** Stream protocol */
  protocol: 'websocket' | 'sse' | 'grpc' | 'http-streaming';
  /** Connection URL */
  url: string;
  /** Stream configuration */
  config?: {
    bufferSize?: number;
    reconnectInterval?: number;
    maxRetries?: number;
  };
}

/**
 * Type guards for pin types
 */
export const isPinMediaType = (type: PinType): boolean => {
  return ['image', 'audio', 'video', 'document', 'media'].includes(type);
};

export const isPinStreamType = (type: PinType): boolean => {
  return type === 'stream';
};

export interface Agent {
  id: string;
  version: string;
  image: string;
  runtime?: string;
  description: string;
  inputs: Pin[];
  outputs: Pin[];
  longRunning?: boolean;
  ui?: {
    remoteEntry?: string;
  };
  resources?: {
    gpu?: boolean;
  };
  env?: string[];
  /** Media capabilities for agents */
  mediaCapabilities?: {
    /** Supported input media types */
    supportedInputTypes?: MediaType[];
    /** Supported output media types */
    supportedOutputTypes?: MediaType[];
    /** Whether this agent can handle streaming */
    supportsStreaming?: boolean;
    /** Maximum file size in bytes */
    maxFileSize?: number;
  };
}

export interface Position {
  x: number;
  y: number;
}

/**
 * Node categories with media support
 */
export enum NodeCategory {
  INPUT = 'input',
  OUTPUT = 'output',
  PROCESSING = 'processing',
  LOGIC = 'logic',
  MEDIA = 'media',
  AI = 'ai',
  INTEGRATION = 'integration',
  UTILITY = 'utility',
}

/**
 * Media-specific node types
 */
export enum MediaNodeType {
  // Input nodes
  MEDIA_UPLOAD = 'media:upload',
  CAMERA_CAPTURE = 'media:camera',
  MICROPHONE_CAPTURE = 'media:microphone',
  SCREEN_CAPTURE = 'media:screen',
  FILE_WATCHER = 'media:file:watcher',
  STREAM_RECEIVER = 'media:stream:receiver',
  
  // Processing nodes
  IMAGE_RESIZE = 'media:image:resize',
  IMAGE_FILTER = 'media:image:filter',
  IMAGE_CROP = 'media:image:crop',
  IMAGE_TRANSFORM = 'media:image:transform',
  IMAGE_ENHANCE = 'media:image:enhance',
  AUDIO_TRANSCODE = 'media:audio:transcode',
  AUDIO_FILTER = 'media:audio:filter',
  AUDIO_MIX = 'media:audio:mix',
  AUDIO_NORMALIZE = 'media:audio:normalize',
  VIDEO_TRANSCODE = 'media:video:transcode',
  VIDEO_TRIM = 'media:video:trim',
  VIDEO_MERGE = 'media:video:merge',
  VIDEO_EFFECTS = 'media:video:effects',
  DOCUMENT_PARSE = 'media:document:parse',
  DOCUMENT_CONVERT = 'media:document:convert',
  
  // AI nodes
  IMAGE_RECOGNITION = 'ai:image:recognition',
  OBJECT_DETECTION = 'ai:object:detection',
  FACE_RECOGNITION = 'ai:face:recognition',
  OCR = 'ai:ocr',
  SPEECH_TO_TEXT = 'ai:speech:text',
  TEXT_TO_SPEECH = 'ai:text:speech',
  IMAGE_GENERATION = 'ai:image:generation',
  VIDEO_GENERATION = 'ai:video:generation',
  AUDIO_GENERATION = 'ai:audio:generation',
  SENTIMENT_ANALYSIS = 'ai:sentiment:analysis',
  CONTENT_MODERATION = 'ai:content:moderation',
  
  // Analysis nodes
  MEDIA_ANALYZER = 'media:analyze',
  QUALITY_CHECKER = 'media:quality:check',
  METADATA_EXTRACTOR = 'media:metadata:extract',
  
  // Output nodes
  MEDIA_DISPLAY = 'media:display',
  MEDIA_DOWNLOAD = 'media:download',
  MEDIA_STREAM = 'media:stream',
  MEDIA_STORAGE = 'media:storage',
  WEBHOOK_SENDER = 'media:webhook:send',
}

export interface Node {
  id: string;
  type: string;
  position: Position;
  inputs?: Record<string, Pin>; // Explicitly add inputs
  outputs?: Record<string, Pin>; // Explicitly type outputs
  params?: Record<string, unknown>;
  /** Node category for organization */
  category?: NodeCategory;
  /** Whether this is a media-aware node */
  isMediaNode?: boolean;
  /** Media capabilities */
  mediaCapabilities?: {
    /** Supported input media types */
    supportedInputTypes?: MediaType[];
    /** Supported output media types */
    supportedOutputTypes?: MediaType[];
    /** Whether this node can handle streaming */
    supportsStreaming?: boolean;
    /** Maximum file size in bytes */
    maxFileSize?: number;
    /** Processing options available */
    processingOptions?: MediaProcessingOptions;
  };
  /** Runtime state for media nodes */
  mediaState?: {
    /** Current media being processed */
    currentMedia?: MediaReference;
    /** Processing progress (0-100) */
    progress?: number;
    /** Processing status */
    status?: 'idle' | 'processing' | 'completed' | 'error';
    /** Error details */
    error?: string;
  };
  /** Visual state for media nodes */
  mediaDisplay?: {
    /** Show preview of media */
    showPreview?: boolean;
    /** Preview URL */
    previewUrl?: string;
    /** Preview type */
    previewType?: 'image' | 'video' | 'audio' | 'waveform';
  };
}

export interface Edge {
  from: string;      // Frontend representation
  to: string;        // Frontend representation
  sourceHandle?: string;
  targetHandle?: string;
}

// Backend API representation
export interface ApiEdge {
  from_node: string;  // Backend expects this format (nodeId.pinName)
  to_node: string;    // Backend expects this format (nodeId.pinName)
}

export interface FlowMeta {
  id: string;
  name: string;
  version: string;
  description?: string;
  createdBy?: string;
  createdAt: string;
}

export interface FlowGraph {
  nodes: Node[];
  edges: Edge[];
}

export interface FlowLayout {
  zoom?: number;
  viewport?: Position;
}

export interface FlowRunConfig {
  maxTokens?: number;
  temperature?: number;
  secrets?: string[];
  /** Media-specific runtime configuration */
  mediaConfig?: {
    /** Maximum file size allowed in bytes */
    maxFileSize?: number;
    /** Allowed media types */
    allowedMediaTypes?: MediaType[];
    /** Processing timeout in seconds */
    processingTimeout?: number;
    /** Whether to use GPU acceleration */
    useGPU?: boolean;
    /** Memory limit for media processing */
    memoryLimit?: number;
  };
  /** Streaming configuration */
  streamingConfig?: {
    /** Enable real-time streaming */
    enableRealtime?: boolean;
    /** Maximum concurrent streams */
    maxConcurrentStreams?: number;
    /** Default chunk size */
    defaultChunkSize?: number;
    /** Reconnection settings */
    reconnection?: {
      maxAttempts?: number;
      delay?: number;
      backoffMultiplier?: number;
    };
  };
}

export interface Flow {
  apiVersion: string;
  kind: "Flow";
  meta: FlowMeta;
  graph: FlowGraph;
  layout?: FlowLayout;
  runConfig?: FlowRunConfig;
  /** Flow-level media settings */
  mediaSettings?: {
    /** Default quality for media processing */
    defaultQuality?: number;
    /** Storage preferences */
    storage?: {
      /** Where to store intermediate results */
      intermediateStorage?: 'memory' | 'disk' | 's3';
      /** Cleanup policy */
      cleanupPolicy?: 'immediate' | 'on-complete' | 'manual';
      /** Maximum storage size in bytes */
      maxStorageSize?: number;
    };
    /** Streaming settings */
    streaming?: {
      /** Enable streaming for compatible nodes */
      enabled?: boolean;
      /** Chunk size for streaming */
      chunkSize?: number;
      /** Buffer size */
      bufferSize?: number;
    };
  };
}

/**
 * Node execution context with media support
 */
export interface NodeExecutionContext {
  /** Node being executed */
  nodeId: string;
  /** Input values */
  inputs: Record<string, PinData>;
  /** Node configuration */
  config: Record<string, any>;
  /** Flow-level context */
  flowContext: {
    flowId: string;
    executionId: string;
    variables: Record<string, any>;
  };
  /** Media context */
  mediaContext?: {
    /** Temporary storage path */
    tempPath: string;
    /** Media processing queue */
    processingQueue?: MediaReference[];
    /** GPU availability */
    gpuAvailable: boolean;
    /** Memory limits */
    memoryLimit: number;
  };
}

/**
 * Node execution result with media outputs
 */
export interface NodeExecutionResult {
  /** Output values */
  outputs: Record<string, PinData>;
  /** Execution metrics */
  metrics?: {
    executionTime: number;
    memoryUsed?: number;
    /** Media processing metrics */
    mediaMetrics?: {
      bytesProcessed?: number;
      framesProcessed?: number;
      processingTime?: number;
    };
  };
  /** Side effects (e.g., files created) */
  sideEffects?: {
    filesCreated?: string[];
    streamsOpened?: string[];
    resourcesAllocated?: string[];
  };
}

/**
 * Type guards for media nodes
 */
export const isMediaNode = (node: Node): boolean => {
  return node.isMediaNode === true ||
         node.type.startsWith('media:') ||
         node.type.startsWith('ai:');
};

export const hasMediaCapabilities = (node: Node): boolean => {
  return node.mediaCapabilities !== undefined;
};

export const isStreamingNode = (node: Node): boolean => {
  return node.mediaCapabilities?.supportsStreaming === true;
};
