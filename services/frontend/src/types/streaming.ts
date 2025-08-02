export interface StreamSession {
  stream_id: string;
  node_id: string;
  status: 'initializing' | 'active' | 'paused' | 'completed' | 'error';
  ws_url: string;
  sse_url: string;
  agent_id: string;
  created_at: string;
}

export interface StreamMessage {
  type: 'stream_start' | 'stream_data' | 'stream_end' | 'stream_error' | 'heartbeat';
  data: any;
  timestamp: string;
  agent_id: string;
  stream_id: string;
  sequence?: number;
}