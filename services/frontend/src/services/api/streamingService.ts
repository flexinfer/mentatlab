import { v4 as uuidv4 } from 'uuid';
import { EnhancedStream } from '../streamingService.enhanced';
import { StreamingMessage, StreamConnectionState, StreamMessageHandler, ConnectionStateHandler } from '../../types/streaming'; // All imported from types/streaming
import { MediaType, MediaChunk, MediaReference } from '../../types/media'; // Corrected import for MediaType and MediaChunk

/**
 * Service for interacting with multimodal streaming endpoints.
 * This service wraps the EnhancedStream logic.
 */
export class StreamingService {
  private enhancedStream: EnhancedStream;

  constructor(streamId: string, wsUrl: string, sseUrl: string) {
    this.enhancedStream = new EnhancedStream(streamId, wsUrl, sseUrl);
  }

  /**
   * Connects to the streaming service.
   */
  async connect(): Promise<void> {
    return this.enhancedStream.connect();
  }

  /**
   * Disconnects from the streaming service.
   */
  disconnect(): void {
    this.enhancedStream.disconnect();
  }

  /**
   * Sends a streaming message.
   * @param message The message to send.
   * @returns True if the message was sent successfully, false otherwise.
   */
  send(message: StreamingMessage): boolean {
    return this.enhancedStream.send(message);
  }

  /**
   * Registers a handler for incoming streaming messages.
   * @param handler The message handler function.
   * @returns A function to unsubscribe the handler.
   */
  onMessage(handler: StreamMessageHandler): () => void {
    return this.enhancedStream.onMessage(handler);
  }

  /**
   * Registers a handler for connection state changes.
   * @param handler The connection state handler function.
   * @returns A function to unsubscribe the handler.
   */
  onConnectionStateChange(handler: ConnectionStateHandler): () => void {
    return this.enhancedStream.onConnectionStateChange(handler);
  }

  /**
   * Gets the current connection state.
   * @returns The current StreamConnectionState.
   */
  getConnectionState(): StreamConnectionState {
    return this.enhancedStream.getConnectionState();
  }

  /**
   * Gets streaming statistics.
   * @returns An object containing streaming statistics.
   */
  getStats(): any { // Return type can be more specific if needed
    return this.enhancedStream.getStats();
  }

  // Example of a specific streaming action
  async createMediaStream(streamId: string, mediaType: MediaType, totalSize?: number): Promise<void> {
    const initMessage: StreamingMessage = {
      id: uuidv4(),
      type: 'media:stream:init',
      timestamp: new Date().toISOString(),
      agent_id: 'webui', // Assuming 'webui' as agent_id for now
      stream_id: streamId,
      mediaType: mediaType,
      totalSize: totalSize,
    };
    this.send(initMessage);
  }

  // Example of sending media chunks
  sendMediaChunk(streamId: string, chunk: MediaChunk, mediaType: MediaType): boolean {
    const chunkMessage: StreamingMessage = {
      id: uuidv4(),
      type: 'media:stream:chunk',
      timestamp: new Date().toISOString(),
      agent_id: 'webui',
      stream_id: streamId,
      chunk: chunk,
      mediaType: mediaType,
    };
    return this.send(chunkMessage);
  }

  // Example of completing a media stream
  completeMediaStream(streamId: string, mediaRef: MediaReference, totalChunks: number, totalBytes: number, duration: number): boolean {
    const completeMessage: StreamingMessage = {
      id: uuidv4(),
      type: 'media:stream:complete',
      timestamp: new Date().toISOString(),
      agent_id: 'webui',
      stream_id: streamId,
      mediaRef: mediaRef,
      totalChunks: totalChunks,
      totalBytes: totalBytes,
      duration: duration,
    };
    return this.send(completeMessage);
  }
}

// Export a singleton instance for convenience
export const streamingService = new StreamingService(
  'default-stream-id', // Placeholder for streamId
  import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws',
  import.meta.env.VITE_WS_URL ? (import.meta.env.VITE_WS_URL + '/sse') : 'http://localhost:8000/ws/sse'
);

export default streamingService;