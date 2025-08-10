/**
 * StreamingControls - Global and individual stream management controls
 * Phase 2 Beta milestone component for MentatLab
 */

import React, { useState, useCallback } from 'react';

import { StreamSession } from '../types/streaming';

interface StreamingControlsProps {
  sessions: StreamSession[];
  globalStatus: 'stopped' | 'starting' | 'running' | 'pausing' | 'error';
  onStartAll?: () => void;
  onStopAll?: () => void;
  onPauseAll?: () => void;
  onResumeAll?: () => void;
  onStartStream?: (streamId: string) => void;
  onStopStream?: (streamId: string) => void;
  onPauseStream?: (streamId: string) => void;
  onResumeStream?: (streamId: string) => void;
  onRemoveStream?: (streamId: string) => void;
  className?: string;
}

export const StreamingControls: React.FC<StreamingControlsProps> = ({
  sessions = [],
  globalStatus = 'stopped',
  onStartAll,
  onStopAll,
  onPauseAll,
  onResumeAll,
  onStartStream,
  onStopStream,
  onPauseStream,
  onResumeStream,
  onRemoveStream,
  className = ''
}) => {
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [showDetails, setShowDetails] = useState(false);

  const handleSelectAll = () => {
    if (selectedSessions.size === sessions.length) {
      setSelectedSessions(new Set());
    } else {
      setSelectedSessions(new Set(sessions.map(s => s.stream_id)));
    }
  };

  const handleSelectSession = (streamId: string) => {
    setSelectedSessions(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(streamId)) {
        newSelection.delete(streamId);
      } else {
        newSelection.add(streamId);
      }
      return newSelection;
    });
  };

  const handleBulkAction = (action: 'start' | 'stop' | 'pause' | 'resume' | 'remove') => {
    selectedSessions.forEach(streamId => {
      switch (action) {
        case 'start':
          onStartStream?.(streamId);
          break;
        case 'stop':
          onStopStream?.(streamId);
          break;
        case 'pause':
          onPauseStream?.(streamId);
          break;
        case 'resume':
          onResumeStream?.(streamId);
          break;
        case 'remove':
          onRemoveStream?.(streamId);
          break;
      }
    });
    setSelectedSessions(new Set());
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case 'initializing': return '🔄';
      case 'active': return '▶️';
      case 'paused': return '⏸️';
      case 'completed': return '✅';
      case 'error': return '❌';
      default: return '⚪';
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'initializing': return 'text-yellow-600 bg-yellow-50 dark:mc-card-bg';
      case 'active': return 'text-green-600 bg-green-50 dark:mc-card-bg';
      case 'paused': return 'text-gray-600 bg-gray-50 dark:mc-card-bg';
      case 'completed': return 'text-blue-600 bg-blue-50 dark:mc-card-bg';
      case 'error': return 'text-red-600 bg-red-50 dark:mc-card-bg';
      default: return 'text-gray-400 bg-gray-50 dark:mc-card-bg';
    }
  };

  const formatDuration = (timestamp: string): string => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const activeSessionsCount = sessions.filter(s => s.status === 'active').length;
  const pausedSessionsCount = sessions.filter(s => s.status === 'paused').length;
  const errorSessionsCount = sessions.filter(s => s.status === 'error').length;

  return (
    <div className={`streaming-controls bg-white dark:mc-card-bg border border-gray-200 dark:border-border rounded-lg ${className}`}>
      {/* Global Controls Header */}
      <div className="border-b border-gray-200 dark:border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Streaming Controls</h3>
          <div className="flex items-center space-x-2">
            <span className={`px-2 py-1 rounded text-sm font-medium ${
              globalStatus === 'running' ? 'bg-green-100 dark:mc-card-bg text-green-800' :
              globalStatus === 'starting' ? 'bg-yellow-100 dark:mc-card-bg text-yellow-800' :
              globalStatus === 'pausing' ? 'bg-orange-100 dark:mc-card-bg text-orange-800' :
              globalStatus === 'error' ? 'bg-red-100 dark:mc-card-bg text-red-800' :
              'bg-gray-100 dark:mc-card-bg text-gray-800'
            }`}>
              {globalStatus.charAt(0).toUpperCase() + globalStatus.slice(1)}
            </span>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center space-x-2 mb-4">
          <button
            onClick={onStartAll}
            disabled={globalStatus === 'starting' || globalStatus === 'running'}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-1"
          >
            <span>▶️</span>
            <span>Start All</span>
          </button>
          
          <button
            onClick={onPauseAll}
            disabled={globalStatus !== 'running'}
            className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-1"
          >
            <span>⏸️</span>
            <span>Pause All</span>
          </button>
          
          <button
            onClick={onResumeAll}
            disabled={pausedSessionsCount === 0}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-1"
          >
            <span>⏯️</span>
            <span>Resume All</span>
          </button>
          
          <button
            onClick={onStopAll}
            disabled={globalStatus === 'stopped'}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-1"
          >
            <span>⏹️</span>
            <span>Stop All</span>
          </button>
        </div>

        {/* Session Summary */}
        <div className="grid grid-cols-4 gap-4 text-center">
          <div className="bg-green-50 dark:mc-card-bg p-2 rounded">
            <div className="text-lg font-bold text-green-600">{activeSessionsCount}</div>
            <div className="text-xs text-green-600">Active</div>
          </div>
          <div className="bg-gray-50 dark:mc-card-bg p-2 rounded">
            <div className="text-lg font-bold text-gray-600">{pausedSessionsCount}</div>
            <div className="text-xs text-gray-600">Paused</div>
          </div>
          <div className="bg-red-50 dark:mc-card-bg p-2 rounded">
            <div className="text-lg font-bold text-red-600">{errorSessionsCount}</div>
            <div className="text-xs text-red-600">Errors</div>
          </div>
          <div className="bg-blue-50 dark:mc-card-bg p-2 rounded">
            <div className="text-lg font-bold text-blue-600">{sessions.length}</div>
            <div className="text-xs text-blue-600">Total</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StreamingControls;