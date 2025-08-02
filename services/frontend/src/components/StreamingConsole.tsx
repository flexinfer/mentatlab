/**
 * StreamingConsole - Live streaming output display with filtering and controls
 * Phase 2 Beta milestone component for MentatLab
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

interface StreamMessage {
  type: 'stream_start' | 'stream_data' | 'stream_end' | 'stream_error' | 'heartbeat';
  data: any;
  timestamp: string;
  agent_id: string;
  stream_id: string;
  sequence?: number;
}

interface StreamingConsoleProps {
  messages: StreamMessage[];
  height?: number;
  showTimestamps?: boolean;
  filterTypes?: string[];
  maxMessages?: number;
  onMessageClick?: (message: StreamMessage) => void;
  className?: string;
}

export const StreamingConsole: React.FC<StreamingConsoleProps> = ({
  messages = [],
  height = 400,
  showTimestamps = true,
  filterTypes = [],
  maxMessages = 1000,
  onMessageClick,
  className = ''
}) => {
  const [filteredMessages, setFilteredMessages] = useState<StreamMessage[]>([]);
  const [selectedFilters, setSelectedFilters] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Available message types for filtering
  const messageTypes = ['stream_start', 'stream_data', 'stream_end', 'stream_error', 'heartbeat'];

  // Filter and process messages
  useEffect(() => {
    let processed = [...messages];

    // Apply type filters
    if (selectedFilters.size > 0) {
      processed = processed.filter(msg => selectedFilters.has(msg.type));
    }

    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      processed = processed.filter(msg => 
        JSON.stringify(msg.data).toLowerCase().includes(searchLower) ||
        msg.agent_id.toLowerCase().includes(searchLower) ||
        msg.stream_id.toLowerCase().includes(searchLower)
      );
    }

    // Sort by sequence and timestamp
    processed.sort((a, b) => {
      if (a.sequence !== undefined && b.sequence !== undefined) {
        return a.sequence - b.sequence;
      }
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });

    // Limit messages for performance
    if (processed.length > maxMessages) {
      processed = processed.slice(-maxMessages);
    }

    setFilteredMessages(processed);
  }, [messages, selectedFilters, searchTerm, maxMessages]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && !isPaused && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredMessages, autoScroll, isPaused]);

  const handleFilterToggle = (type: string) => {
    setSelectedFilters(prev => {
      const newFilters = new Set(prev);
      if (newFilters.has(type)) {
        newFilters.delete(type);
      } else {
        newFilters.add(type);
      }
      return newFilters;
    });
  };

  const clearFilters = () => {
    setSelectedFilters(new Set());
    setSearchTerm('');
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
  };

  const formatMessageData = (data: any): string => {
    if (typeof data === 'string') {
      return data;
    }
    return JSON.stringify(data, null, 2);
  };

  const getMessageTypeColor = (type: string): string => {
    switch (type) {
      case 'stream_start': return 'text-green-600';
      case 'stream_data': return 'text-blue-600';
      case 'stream_end': return 'text-purple-600';
      case 'stream_error': return 'text-red-600';
      case 'heartbeat': return 'text-yellow-600';
      default: return 'text-gray-600';
    }
  };

  const getMessageTypeIcon = (type: string): string => {
    switch (type) {
      case 'stream_start': return '▶️';
      case 'stream_data': return '📊';
      case 'stream_end': return '⏹️';
      case 'stream_error': return '❌';
      case 'heartbeat': return '💓';
      default: return '📝';
    }
  };

  return (
    <div className={`streaming-console ${className}`}>
      {/* Console Header */}
      <div className="bg-gray-50 border-b border-gray-200 p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Streaming Console</h3>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsPaused(!isPaused)}
              className={`px-3 py-1 rounded text-sm font-medium ${
                isPaused
                  ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                  : 'bg-green-100 text-green-800 hover:bg-green-200'
              }`}
            >
              {isPaused ? '▶️ Resume' : '⏸️ Pause'}
            </button>
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`px-3 py-1 rounded text-sm font-medium ${
                autoScroll
                  ? 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search messages..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 min-w-64 px-3 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">Filter:</span>
            {messageTypes.map(type => (
              <button
                key={type}
                onClick={() => handleFilterToggle(type)}
                className={`px-2 py-1 rounded text-xs font-medium ${
                  selectedFilters.has(type)
                    ? 'bg-blue-100 text-blue-800 border border-blue-300'
                    : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
                }`}
              >
                {getMessageTypeIcon(type)} {type}
              </button>
            ))}
            
            <button
              onClick={clearFilters}
              className="px-2 py-1 rounded text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
          <span>
            Showing {filteredMessages.length} of {messages.length} messages
          </span>
          <span>
            {isPaused ? '⏸️ Paused' : '🔴 Live'}
          </span>
        </div>
      </div>

      {/* Console Body */}
      <div
        ref={consoleRef}
        className="bg-gray-900 text-green-400 font-mono text-sm overflow-y-auto"
        style={{ height }}
      >
        <div className="p-2">
          {filteredMessages.length === 0 ? (
            <div className="text-gray-500 text-center py-8">
              {messages.length === 0 ? 'No messages received yet...' : 'No messages match the current filters'}
            </div>
          ) : (
            filteredMessages.map((message, index) => (
              <div
                key={`${message.stream_id}-${message.sequence || index}`}
                className={`mb-1 cursor-pointer hover:bg-gray-800 rounded px-2 py-1 ${getMessageTypeColor(message.type)}`}
                onClick={() => onMessageClick?.(message)}
              >
                <div className="flex items-start space-x-2">
                  {/* Timestamp */}
                  {showTimestamps && (
                    <span className="text-gray-500 text-xs flex-shrink-0 w-20">
                      {formatTimestamp(message.timestamp)}
                    </span>
                  )}
                  
                  {/* Message Type Icon */}
                  <span className="flex-shrink-0 w-6">
                    {getMessageTypeIcon(message.type)}
                  </span>
                  
                  {/* Agent/Stream Info */}
                  <span className="text-gray-400 text-xs flex-shrink-0 w-32 truncate">
                    {message.agent_id.substring(0, 8)}.../{message.stream_id.substring(0, 8)}...
                  </span>
                  
                  {/* Message Data */}
                  <div className="flex-1 min-w-0">
                    <pre className="whitespace-pre-wrap break-words text-xs">
                      {formatMessageData(message.data)}
                    </pre>
                  </div>
                  
                  {/* Sequence Number */}
                  {message.sequence !== undefined && (
                    <span className="text-gray-500 text-xs flex-shrink-0">
                      #{message.sequence}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
};

export default StreamingConsole;