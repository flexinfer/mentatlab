import { MediaType, MediaChunk, MediaReference, MediaProcessingOptions } from './media';

export enum StreamConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

export type StreamMessageHandler = (message: StreamingMessage) => void;
export type ConnectionStateHandler = (state: StreamConnectionState) => void;

export interface StreamSession {
  stream_id: string;
  node_id: string;
  status: 'initializing' | 'active' | 'paused' | 'completed' | 'error' | 'reconnecting';
  ws_url: string;
  sse_url: string;
  agent_id: string;
  created_at: string;
  updated_at?: string;
  /** Media-specific streaming information */
  mediaInfo?: {
    mediaType: MediaType;
    totalSize?: number;
    chunksExpected?: number;
    chunksReceived?: number;
    protocol?: 'websocket' | 'http-streaming' | 'webrtc' | 'sse' | 'grpc';
    encoding?: string;
    compression?: boolean;
  };
  /** Connection quality */
  connectionQuality?: {
    latency?: number;
    bandwidth?: number;
    reliability?: 'excellent' | 'good' | 'fair' | 'poor';
  };
  /** Session configuration */
  config?: {
    timeout?: number;
    maxRetries?: number;
    bufferSize?: number;
    priority?: 'low' | 'normal' | 'high';
  };
}

/**
 * Base message structure for all streaming messages
 */
export interface BaseStreamMessage {
  /** Unique message ID */
  id?: string;
  /** Message type */
  type: string;
  /** Timestamp */
  timestamp: string;
  /** Agent ID */
  agent_id: string;
  /** Stream ID */
  stream_id: string;
  /** Sequence number for ordering */
  sequence?: number;
  /** Correlation ID for request/response pairing */
  correlationId?: string;
}

/**
 * Legacy stream message for backward compatibility
 */
export interface StreamMessage extends BaseStreamMessage {
  type: 'stream_start' | 'stream_data' | 'stream_end' | 'stream_error' | 'heartbeat';
  data: any;
}

/**
 * Stream control messages
 */
export interface StreamControlMessage extends BaseStreamMessage {
  type: 'stream:control';
  action: 'start' | 'pause' | 'resume' | 'stop' | 'cancel' | 'seek' | 'speed';
  /** Additional control parameters */
  params?: {
    /** For seek action: position in seconds */
    position?: number;
    /** For speed action: playback speed multiplier */
    speed?: number;
    /** Force action even if in incompatible state */
    force?: boolean;
    /** Reason for the control action */
    reason?: string;
  };
}

/**
 * Stream negotiation message
 */
export interface StreamNegotiationMessage extends BaseStreamMessage {
  type: 'stream:negotiate';
  /** Offered capabilities */
  offer?: {
    protocols: string[];
    codecs: {
      audio?: string[];
      video?: string[];
      image?: string[];
    };
    resolutions?: Array<{ width: number; height: number }>;
    frameRates?: number[];
    sampleRates?: number[];
    bitRates?: Array<{ min: number; max: number }>;
    mediaTypes?: MediaType[];
    maxChunkSize?: number;
    ackMechanism?: boolean;
    compression?: string[];
    protocolVersion?: string;
  };
  /** Selected capabilities */
  answer?: {
    protocol: string;
    codec: {
      audio?: string;
      video?: string;
      image?: string;
    };
    resolution?: { width: number; height: number };
    frameRate?: number;
    sampleRate?: number;
    bitRate?: number;
    mediaTypes?: MediaType[];
    maxChunkSize?: number;
    ackMechanism?: boolean;
    compression?: string[];
    protocolVersion?: string;
  };
}

/**
 * Stream status messages
 */
export interface StreamStatusMessage extends BaseStreamMessage {
  type: 'stream:status';
  status: 'initializing' | 'active' | 'paused' | 'completed' | 'error';
  /** Progress information */
  progress?: {
    current: number;
    total: number;
    percentage: number;
  };
  /** Error details if status is error */
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

/**
 * Media stream initialization message
 */
export interface MediaStreamInitMessage extends BaseStreamMessage {
  type: 'media:stream:init';
  mediaType: MediaType;
  /** Expected total size if known */
  totalSize?: number;
  /** Expected chunk size */
  chunkSize?: number;
  /** Media metadata */
  metadata?: Record<string, any>;
  /** Streaming options */
  options?: {
    /** Enable compression */
    compress?: boolean;
    /** Encryption settings */
    encrypt?: boolean;
    /** Quality settings */
    quality?: number;
  };
}

/**
 * Media chunk message
 */
export interface MediaChunkMessage extends BaseStreamMessage {
  type: 'media:stream:chunk';
  chunk: MediaChunk;
  /** Media type for this chunk */
  mediaType: MediaType;
}

/**
 * Media stream complete message
 */
export interface MediaStreamCompleteMessage extends BaseStreamMessage {
  type: 'media:stream:complete';
  /** Final media reference */
  mediaRef: MediaReference;
  /** Total chunks sent */
  totalChunks: number;
  /** Total bytes transferred */
  totalBytes: number;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Text streaming message (for LLM responses, etc.)
 */
export interface TextStreamMessage extends BaseStreamMessage {
  type: 'text:stream';
  /** Text content chunk */
  content: string;
  /** Whether this completes the stream */
  isComplete: boolean;
  /** Token count if applicable */
  tokens?: number;
  /** Model information if from LLM */
  model?: {
    name: string;
    provider: string;
  };
}

/**
 * Audio streaming message for real-time audio
 */
export interface AudioStreamMessage extends BaseStreamMessage {
  type: 'audio:stream';
  /** Audio data (base64 encoded or ArrayBuffer) */
  data: string | ArrayBuffer;
  /** Audio format details */
  format: {
    sampleRate: number;
    channels: number;
    bitDepth: number;
    codec: string;
    /** Duration of this audio chunk in milliseconds */
    duration?: number;
  };
  /** Timestamp in the audio stream */
  streamTime: number;
  /** Whether this is a key frame */
  isKeyFrame?: boolean;
  /** Audio levels for visualization */
  levels?: {
    peak?: number;
    rms?: number;
    channels?: number[];
  };
}

/**
 * Video streaming message for real-time video
 */
export interface VideoStreamMessage extends BaseStreamMessage {
  type: 'video:stream';
  /** Video frame data (base64 encoded) */
  data: string;
  /** Frame information */
  frame: {
    number: number;
    timestamp: number;
    width: number;
    height: number;
    isKeyFrame: boolean;
  };
  /** Video format */
  format: {
    codec: string;
    fps: number;
    bitRate?: number;
  };
}

/**
 * Progress update message
 */
export interface ProgressMessage extends BaseStreamMessage {
  type: 'progress';
  /** Operation being tracked */
  operation: string;
  /** Current progress (0-100) */
  progress: number;
  /** Status message */
  message?: string;
  /** Detailed progress data */
  details?: {
    bytesProcessed?: number;
    totalBytes?: number;
    itemsProcessed?: number;
    totalItems?: number;
    estimatedTimeRemaining?: number;
  };
}

/**
 * Error message
 */
export interface ErrorMessage extends BaseStreamMessage {
  type: 'error';
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Which operation failed */
  operation?: string;
  /** Stack trace for debugging */
  stack?: string;
  /** Additional error context */
  context?: Record<string, any>;
  /** Whether the error is recoverable */
  recoverable?: boolean;
}

/**
 * Acknowledgment message
 */
export interface AckMessage extends BaseStreamMessage {
  type: 'ack';
  /** ID of the message being acknowledged */
  ackId: string;
  /** Whether the message was successfully processed */
  success: boolean;
  /** Error details if not successful */
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Heartbeat message for connection keep-alive
 */
export interface HeartbeatMessage extends BaseStreamMessage {
  type: 'heartbeat';
  /** Client/server identifier */
  from: string;
  /** Additional health data */
  health?: {
    memoryUsage?: number;
    cpuUsage?: number;
    activeStreams?: number;
  };
}

/**
 * Quality adaptation message
 */
export interface QualityAdaptationMessage extends BaseStreamMessage {
  type: 'stream:quality';
  /** Current quality level */
  currentQuality: 'auto' | 'low' | 'medium' | 'high' | 'ultra';
  /** Reason for quality change */
  reason: 'bandwidth' | 'cpu' | 'manual' | 'initial';
  /** Current metrics */
  metrics: {
    bandwidth?: number;
    cpuUsage?: number;
    bufferHealth?: number;
    droppedFrames?: number;
  };
  /** Available quality levels */
  availableLevels: string[];
}

/**
 * Stream statistics message
 */
export interface StreamStatsMessage extends BaseStreamMessage {
  type: 'stream:stats';
  /** Comprehensive statistics */
  stats: {
    /** Data transfer stats */
    transfer: {
      bytesReceived: number;
      bytesSent: number;
      packetsReceived: number;
      packetsSent: number;
      packetsLost: number;
    };
    /** Timing stats */
    timing: {
      roundTripTime?: number;
      jitter?: number;
      processingDelay?: number;
    };
    /** Quality stats */
    quality: {
      bitrate?: number;
      framerate?: number;
      resolution?: { width: number; height: number };
      codecInfo?: string;
    };
    /** Buffer stats */
    buffer: {
      currentLevel: number;
      targetLevel: number;
      stalls: number;
      totalStallDuration: number;
    };
  };
}

/**
 * Stream metadata update message
 */
export interface StreamMetadataMessage extends BaseStreamMessage {
  type: 'stream:metadata';
  /** Metadata updates */
  metadata: {
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
    chapters?: Array<{
      title: string;
      startTime: number;
      endTime: number;
    }>;
    subtitles?: Array<{
      language: string;
      url: string;
      format: string;
    }>;
    thumbnails?: Array<{
      url: string;
      width: number;
      height: number;
      time?: number;
    }>;
  };
}

/**
 * Stream synchronization message
 */
export interface StreamSyncMessage extends BaseStreamMessage {
  type: 'stream:sync';
  /** Server time for synchronization */
  serverTime: number;
  /** Stream position */
  streamPosition: number;
  /** Playback state */
  playbackState: 'playing' | 'paused' | 'buffering';
  /** Sync accuracy required in milliseconds */
  syncAccuracy?: number;
}

/**
 * Media transformation message
 */
export interface MediaTransformMessage extends BaseStreamMessage {
  type: 'media:transform';
  /** Transformation to apply */
  transform: MediaProcessingOptions;
  /** Target media reference */
  targetRef?: MediaReference;
  /** Whether to apply in real-time */
  realtime?: boolean;
}

/**
 * Union type for all streaming messages
 */
export type StreamingMessage =
  | StreamMessage
  | StreamControlMessage
  | StreamNegotiationMessage
  | StreamStatusMessage
  | MediaStreamInitMessage
  | MediaChunkMessage
  | MediaStreamCompleteMessage
  | TextStreamMessage
  | AudioStreamMessage
  | VideoStreamMessage
  | ProgressMessage
  | ErrorMessage
  | AckMessage
  | HeartbeatMessage
  | QualityAdaptationMessage
  | StreamStatsMessage
  | StreamMetadataMessage
  | StreamSyncMessage
  | MediaTransformMessage;

/**
 * Type guards for streaming messages
 */
export const isMediaStreamMessage = (
  msg: StreamingMessage
): msg is MediaStreamInitMessage | MediaChunkMessage | MediaStreamCompleteMessage => {
  return msg.type.startsWith('media:stream:');
};

export const isControlMessage = (
  msg: StreamingMessage
): msg is StreamControlMessage => {
  return msg.type === 'stream:control';
};

export const isErrorMessage = (
  msg: StreamingMessage
): msg is ErrorMessage => {
  return msg.type === 'error';
};

/**
 * Streaming session configuration
 */
export interface StreamingConfig {
  /** Maximum chunk size in bytes */
  maxChunkSize: number;
  /** Timeout in milliseconds */
  timeout: number;
  /** Number of retry attempts */
  retryAttempts: number;
  /** Backoff multiplier for retries */
  retryBackoff: number;
  /** Enable compression */
  compression: boolean;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval: number;
  /** Buffer size for streaming */
  bufferSize: number;
}

/**
 * Default streaming configuration
 */
export const DEFAULT_STREAMING_CONFIG: StreamingConfig = {
  maxChunkSize: 1024 * 1024, // 1MB
  timeout: 30000, // 30 seconds
  retryAttempts: 3,
  retryBackoff: 1.5,
  compression: true,
  heartbeatInterval: 5000, // 5 seconds
  bufferSize: 1024 * 1024 * 10, // 10MB
};

/**
 * Streaming capabilities interface
 */
export interface StreamingCapabilities {
  /** Supported protocols */
  protocols: Array<'websocket' | 'sse' | 'grpc' | 'http-streaming' | 'webrtc'>;
  /** Supported media types */
  mediaTypes: MediaType[];
  /** Maximum concurrent streams */
  maxConcurrentStreams: number;
  /** Supported codecs */
  codecs: {
    audio?: string[];
    video?: string[];
    image?: string[];
  };
  /** Supported features */
  features: {
    adaptiveBitrate?: boolean;
    realTimeProcessing?: boolean;
    encryption?: boolean;
    compression?: boolean;
    multiTrack?: boolean;
    lowLatencyMode?: boolean;
  };
  /** Performance limits */
  limits: {
    maxBitrate?: number;
    maxResolution?: { width: number; height: number };
    maxFrameRate?: number;
    maxSampleRate?: number;
  };
}

/**
 * Stream event types for event-driven architecture
 */
export enum StreamEventType {
  // Connection events
  CONNECTED = 'stream:connected',
  DISCONNECTED = 'stream:disconnected',
  RECONNECTING = 'stream:reconnecting',
  
  // Data events
  DATA_RECEIVED = 'stream:data:received',
  DATA_SENT = 'stream:data:sent',
  CHUNK_COMPLETE = 'stream:chunk:complete',
  
  // Quality events
  QUALITY_CHANGED = 'stream:quality:changed',
  BUFFER_LOW = 'stream:buffer:low',
  BUFFER_RECOVERED = 'stream:buffer:recovered',
  
  // Error events
  ERROR_NETWORK = 'stream:error:network',
  ERROR_DECODE = 'stream:error:decode',
  ERROR_PERMISSION = 'stream:error:permission',
  
  // State events
  STATE_CHANGED = 'stream:state:changed',
  METADATA_UPDATED = 'stream:metadata:updated',
  STATS_UPDATED = 'stream:stats:updated',
}