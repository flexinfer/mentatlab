import React, { useEffect } from 'react';
import StreamingCanvas from './StreamingCanvas';
import StreamingControls from './StreamingControls';
import useStore from '../store';
import { streamingService } from '../services/streamingService';
// import StreamingConsole from './StreamingConsole';

const StreamingPage: React.FC = () => {
  const { streamingSessions, addStreamingSession, updateStreamingSession, removeStreamingSession } = useStore();

  useEffect(() => {
    // Example of how to create a stream. In a real scenario, this would be triggered by a user action.
    const stream = streamingService.createStream('ws://localhost:8001/ws/streams/some_stream_id');
    addStreamingSession({
      stream_id: stream.streamId,
      node_id: 'example-node',
      status: 'initializing',
      ws_url: 'ws://localhost:8001/ws/streams/some_stream_id',
      sse_url: 'http://localhost:8001/api/v1/streams/some_stream_id',
      agent_id: 'example-agent',
      created_at: new Date().toISOString(),
    });

    stream.onMessage(message => {
      console.log('Received message:', message);
      updateStreamingSession(stream.streamId, 'active');
    });

    return () => {
      streamingService.closeStream(stream.streamId);
      removeStreamingSession(stream.streamId);
    };
  }, [addStreamingSession, updateStreamingSession, removeStreamingSession]);

  return (
    <div className="flex flex-col h-screen">
      <header className="flex items-center justify-between p-4 border-b">
        <h1 className="text-xl font-bold">Real-time Streaming</h1>
      </header>
      <div className="flex-grow p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
          <div className="lg:col-span-2 h-full">
            <StreamingCanvas streamingSessions={Array.from(streamingSessions.values())} />
          </div>
          <div className="h-full">
            <StreamingControls sessions={Array.from(streamingSessions.values())} globalStatus="running" />
          </div>
        </div>
        {/* <div className="mt-4">
          <StreamingConsole />
        </div> */}
      </div>
    </div>
  );
};

export default StreamingPage;