import { v4 as uuidv4 } from 'uuid';

export interface StreamMessage {
  type: 'data' | 'control';
  payload: any;
  stream_id: string;
  timestamp: string;
}

export type StreamMessageHandler = (message: StreamMessage) => void;

class Stream {
  private ws: WebSocket;
  private messageHandlers: Set<StreamMessageHandler> = new Set();

  constructor(public readonly streamId: string, private url: string) {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = this.handleMessage.bind(this);
  }

  private handleMessage(event: MessageEvent) {
    const message = JSON.parse(event.data) as StreamMessage;
    this.messageHandlers.forEach(handler => handler(message));
  }

  public onMessage(handler: StreamMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  public send(data: any) {
    const message: StreamMessage = {
      type: 'data',
      payload: data,
      stream_id: this.streamId,
      timestamp: new Date().toISOString(),
    };
    this.ws.send(JSON.stringify(message));
  }

  public close() {
    this.ws.close();
  }
}

class StreamingService {
  private streams: Map<string, Stream> = new Map();

  public createStream(url: string): Stream {
    const streamId = uuidv4();
    const stream = new Stream(streamId, url);
    this.streams.set(streamId, stream);
    return stream;
  }

  public getStream(streamId: string): Stream | undefined {
    return this.streams.get(streamId);
  }

  public closeStream(streamId: string) {
    const stream = this.streams.get(streamId);
    if (stream) {
      stream.close();
      this.streams.delete(streamId);
    }
  }

  public closeAllStreams() {
    this.streams.forEach(stream => stream.close());
    this.streams.clear();
  }
}

export const streamingService = new StreamingService();