import React, { useEffect } from 'react';
import { StreamingCanvas } from './StreamingCanvas';
import { StreamingControls } from './StreamingControls';
import { StreamingConsole } from './StreamingConsole';
import { useStreamingStore } from '../store/streamingStore';
import { streamingService } from '../services/streamingService.new';

const StreamingPage: React.FC = () => {
  const { activeStreamId, streams, connectionStatus } = useStreamingStore();
  
  // Convert streams object to array and get active stream's messages
  const streamArray = Object.values(streams);
  const activeStream = activeStreamId ? streams[activeStreamId] : null;
  
  // Convert console messages to StreamMessage format
  const messages = (activeStream?.console || []).map(msg => ({
    type: 'stream_data' as const,
    data: msg.message,
    timestamp: msg.timestamp,
    agent_id: 'system',
    stream_id: activeStreamId || '',
    sequence: 0
  }));
  
  // Map status to expected format
  const getGlobalStatus = (status?: string) => {
    switch (status) {
      case 'active': return 'running';
      case 'paused': return 'pausing';
      case 'stopped': return 'stopped';
      case 'error': return 'error';
      default: return 'starting';
    }
  };

  useEffect(() => {
    console.log('[StreamingPage] Component mounted. ActiveStreamId:', activeStreamId);
    // Initialize streaming service when component mounts
    if (activeStreamId) {
      console.log('[StreamingPage] Connecting to stream:', activeStreamId);
      streamingService.connect(activeStreamId);
    } else {
      console.log('[StreamingPage] No active stream ID, creating default stream');
      // Create a default stream ID for testing
      const defaultStreamId = `stream-${Date.now()}`;
      useStreamingStore.getState().setActiveStreamId(defaultStreamId);
    }

    return () => {
      console.log('[StreamingPage] Component unmounting, disconnecting stream');
      streamingService.disconnect();
    };
  }, [activeStreamId]);

  useEffect(() => {
    console.log('[StreamingPage] Connection status changed:', connectionStatus);
  }, [connectionStatus]);

  useEffect(() => {
    console.log('[StreamingPage] Streams updated:', streams);
  }, [streams]);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-800">Streaming Mode</h1>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              connectionStatus === 'connected' ? 'bg-green-100 text-green-800' :
              connectionStatus === 'connecting' ? 'bg-yellow-100 text-yellow-800' :
              'bg-red-100 text-red-800'
            }`}>
              {connectionStatus}
            </span>
            {activeStreamId && (
              <span className="text-xs text-gray-500">
                Stream: {activeStreamId}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col">
          <StreamingControls
            sessions={[]}
            globalStatus={getGlobalStatus(activeStream?.status)}
          />
          <div className="flex-1 p-4">
            <StreamingCanvas />
          </div>
        </div>
        <div className="w-96 border-l border-gray-200 bg-white">
          <StreamingConsole messages={messages} />
        </div>
      </div>
    </div>
  );
};

export default StreamingPage;