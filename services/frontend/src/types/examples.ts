/**
 * Examples demonstrating the usage of multimodal type system
 * This file is for documentation and testing purposes
 */

import {
  // Pin types
  Pin,
  PinData,
  MediaPinValue,
  
  // Media types
  MediaType,
  MediaReference,
  ImageMetadata,
  MediaProcessingOptions,
  
  // Node types
  Node,
  MediaNodeType,
  NodeCategory,
  NodeExecutionContext,
  NodeExecutionResult,
  
  // Streaming types
  MediaStreamInitMessage,
  MediaChunkMessage,
  TextStreamMessage,
  StreamingMessage,
} from './index';

// Example 1: Creating a media upload node
export const createMediaUploadNode = (): Node => {
  const node: Node = {
    id: 'upload-1',
    type: MediaNodeType.MEDIA_UPLOAD,
    position: { x: 100, y: 100 },
    isMediaNode: true,
    category: NodeCategory.INPUT,
    mediaCapabilities: {
      supportedInputTypes: [MediaType.IMAGE],
      supportedOutputTypes: [MediaType.IMAGE],
      maxFileSize: 10 * 1024 * 1024, // 10MB
      supportsStreaming: false,
    },
    params: {
      acceptedFormats: ['image/jpeg', 'image/png', 'image/webp'],
    },
  };
  
  return node;
};

// Example 2: Creating an image processing node
export const createImageResizeNode = (): Node => {
  const node: Node = {
    id: 'resize-1',
    type: MediaNodeType.IMAGE_RESIZE,
    position: { x: 300, y: 100 },
    isMediaNode: true,
    category: NodeCategory.PROCESSING,
    params: {
      width: 800,
      height: 600,
      mode: 'fit',
    },
    mediaCapabilities: {
      supportedInputTypes: [MediaType.IMAGE],
      supportedOutputTypes: [MediaType.IMAGE],
      supportsStreaming: false,
      processingOptions: {
        resize: {
          width: 800,
          height: 600,
          mode: 'fit',
        },
        quality: 85,
      },
    },
  };
  
  return node;
};

// Example 3: Creating a media-aware pin
export const createImageInputPin = (): Pin => {
  const pin: Pin = {
    name: 'imageInput',
    type: 'image',
    description: 'Input image for processing',
    required: true,
    supportedMediaTypes: [MediaType.IMAGE],
    maxSize: 50 * 1024 * 1024, // 50MB
    streaming: false,
    validation: {
      mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      maxDimensions: {
        width: 4096,
        height: 4096,
      },
    },
  };
  
  return pin;
};

// Example 4: Creating a media reference
export const createImageReference = (): MediaReference => {
  const metadata: ImageMetadata = {
    id: 'img-123',
    filename: 'example.jpg',
    size: 1024 * 500, // 500KB
    mimeType: 'image/jpeg',
    createdAt: new Date().toISOString(),
    width: 1920,
    height: 1080,
    colorDepth: 24,
    colorSpace: 'RGB',
  };
  
  const mediaRef: MediaReference = {
    type: MediaType.IMAGE,
    refId: 'ref-img-123',
    storageLocation: 's3',
    url: 's3://bucket/images/example.jpg',
    metadata,
    status: 'ready',
    thumbnailUrl: 's3://bucket/thumbnails/example-thumb.jpg',
    alternates: {
      small: {
        url: 's3://bucket/images/example-small.jpg',
        mimeType: 'image/jpeg',
        quality: 'small',
      },
      medium: {
        url: 's3://bucket/images/example-medium.jpg',
        mimeType: 'image/jpeg',
        quality: 'medium',
      },
    },
  };
  
  return mediaRef;
};

// Example 5: Using PinData with media
export const createMediaPinData = (): PinData<MediaPinValue> => {
  const pinData: PinData<MediaPinValue> = {
    value: {
      ref: createImageReference(),
      processing: {
        resize: {
          width: 400,
          height: 300,
          mode: 'fill',
        },
        quality: 90,
      },
    },
    mediaRef: createImageReference(),
    metadata: {
      timestamp: new Date().toISOString(),
      source: 'user-upload',
      status: 'ready',
    },
  };
  
  return pinData;
};

// Example 6: Node execution with media
export const executeMediaNode = async (
  context: NodeExecutionContext
): Promise<NodeExecutionResult> => {
  // Extract media from inputs
  const inputImage = context.inputs['imageInput'];
  
  if (!inputImage.mediaRef) {
    throw new Error('No media reference found in input');
  }
  
  // Simulate processing
  const startTime = Date.now();
  
  // Create output media reference
  const outputRef: MediaReference = {
    ...inputImage.mediaRef,
    refId: `processed-${inputImage.mediaRef.refId}`,
    url: `s3://bucket/processed/${inputImage.mediaRef.refId}.jpg`,
  };
  
  const result: NodeExecutionResult = {
    outputs: {
      'processedImage': {
        value: { ref: outputRef },
        mediaRef: outputRef,
        metadata: {
          timestamp: new Date().toISOString(),
          source: context.nodeId,
          status: 'ready',
        },
      },
    },
    metrics: {
      executionTime: Date.now() - startTime,
      mediaMetrics: {
        bytesProcessed: inputImage.mediaRef.metadata.size || 0,
        processingTime: Date.now() - startTime,
      },
    },
    sideEffects: {
      filesCreated: [outputRef.url],
    },
  };
  
  return result;
};

// Example 7: Streaming messages
export const createStreamingMessages = (): StreamingMessage[] => {
  const messages: StreamingMessage[] = [];
  
  // Initialize media stream
  const initMsg: MediaStreamInitMessage = {
    type: 'media:stream:init',
    timestamp: new Date().toISOString(),
    agent_id: 'agent-123',
    stream_id: 'stream-123',
    mediaType: MediaType.IMAGE,
    totalSize: 1024 * 1024 * 5, // 5MB
    chunkSize: 1024 * 64, // 64KB chunks
    metadata: {
      filename: 'large-image.jpg',
      dimensions: { width: 4096, height: 3072 },
    },
    options: {
      compress: true,
      quality: 90,
    },
  };
  messages.push(initMsg);
  
  // Send chunks
  for (let i = 0; i < 3; i++) {
    const chunkMsg: MediaChunkMessage = {
      type: 'media:stream:chunk',
      timestamp: new Date().toISOString(),
      agent_id: 'agent-123',
      stream_id: 'stream-123',
      mediaType: MediaType.IMAGE,
      chunk: {
        sequence: i,
        data: 'base64encodeddata...',
        isFinal: i === 2,
        totalChunks: 3,
        size: 1024 * 64,
      },
    };
    messages.push(chunkMsg);
  }
  
  // Text streaming for AI responses
  const textMsg: TextStreamMessage = {
    type: 'text:stream',
    timestamp: new Date().toISOString(),
    agent_id: 'agent-456',
    stream_id: 'stream-456',
    content: 'This is a streaming response from the AI model...',
    isComplete: false,
    tokens: 12,
    model: {
      name: 'gpt-4',
      provider: 'openai',
    },
  };
  messages.push(textMsg);
  
  return messages;
};

// Example 8: Creating an AI image generation node
export const createImageGenerationNode = (): Node => {
  const node: Node = {
    id: 'ai-gen-1',
    type: MediaNodeType.IMAGE_GENERATION,
    position: { x: 500, y: 100 },
    isMediaNode: true,
    category: NodeCategory.AI,
    params: {
      model: 'dall-e-3',
      size: '1024x1024',
      quality: 'hd',
    },
    mediaCapabilities: {
      supportedOutputTypes: [MediaType.IMAGE],
      supportsStreaming: true,
    },
  };
  
  return node;
};

// Example 9: Media processing options
export const createProcessingOptions = (): MediaProcessingOptions => {
  const options: MediaProcessingOptions = {
    resize: {
      width: 1280,
      height: 720,
      mode: 'fit',
    },
    quality: 85,
    format: 'webp',
    video: {
      fps: 30,
      bitRate: 5000,
      codec: 'h264',
    },
    audio: {
      sampleRate: 44100,
      channels: 2,
      bitRate: 192,
    },
  };
  
  return options;
};

// Example 10: Speech-to-Text node
export const createSpeechToTextNode = (): Node => {
  const node: Node = {
    id: 'stt-1',
    type: MediaNodeType.SPEECH_TO_TEXT,
    position: { x: 200, y: 200 },
    isMediaNode: true,
    category: NodeCategory.AI,
    params: {
      model: 'whisper-1',
      language: 'auto',
    },
    mediaCapabilities: {
      supportedInputTypes: [MediaType.AUDIO],
      supportedOutputTypes: [MediaType.TEXT],
      supportsStreaming: true,
      maxFileSize: 25 * 1024 * 1024, // 25MB
    },
  };
  
  return node;
};

// Example 11: Video streaming node
export const createVideoStreamNode = (): Node => {
  const node: Node = {
    id: 'video-stream-1',
    type: MediaNodeType.MEDIA_STREAM,
    position: { x: 400, y: 200 },
    isMediaNode: true,
    category: NodeCategory.OUTPUT,
    params: {
      protocol: 'webrtc',
      quality: 'adaptive',
    },
    mediaCapabilities: {
      supportedInputTypes: [MediaType.VIDEO, MediaType.AUDIO],
      supportsStreaming: true,
      processingOptions: {
        video: {
          fps: 30,
          bitRate: 2500,
          codec: 'h264',
        },
        audio: {
          sampleRate: 48000,
          channels: 2,
          bitRate: 128,
        },
      },
    },
    mediaDisplay: {
      showPreview: true,
      previewType: 'video',
    },
  };
  
  return node;
};