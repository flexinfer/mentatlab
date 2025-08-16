import React, { useEffect, useState, useRef } from 'react';
import { Box, Typography, Paper, Chip, Stack, LinearProgress } from '@mui/material';
import { PlayArrow, CheckCircle, Error as ErrorIcon } from '@mui/icons-material';

interface StreamEvent {
  id: string;
  timestamp: string;
  type: string;
  data: any;
  source?: string;
}

interface AgentState {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress?: number;
  lastEvent?: string;
}

export const StreamingEventViewer: React.FC = () => {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [agents, setAgents] = useState<Map<string, AgentState>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const connectWebSocket = () => {
      // Check if WebSocket is enabled
      const connectWS = import.meta.env.VITE_CONNECT_WS === 'true' || import.meta.env.VITE_CONNECT_WS === true;
      
      if (!connectWS) {
        console.log('[StreamingEventViewer] WebSocket disabled by config');
        setConnectionStatus('disconnected');
        return;
      }

      setConnectionStatus('connecting');
      
      // Build WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//localhost:8080/ws`;
      
      console.log('[StreamingEventViewer] Connecting to:', wsUrl);
      
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('[StreamingEventViewer] WebSocket connected');
          setConnectionStatus('connected');
          
          // Clear any reconnection timeout
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('[StreamingEventViewer] Received:', data);
            
            const streamEvent: StreamEvent = {
              id: data.id || `${Date.now()}-${Math.random()}`,
              timestamp: data.timestamp || new Date().toISOString(),
              type: data.type || data.event_type || 'unknown',
              data: data.data || data,
              source: data.source || data.agent_id
            };
            
            // Update events list
            setEvents(prev => [...prev, streamEvent].slice(-50)); // Keep last 50 events
            
            // Update agent states
            if (streamEvent.type.includes('agent')) {
              const agentId = data.data?.agent_id || data.agent_id || 'unknown';
              const agentName = data.data?.agent_name || data.agent_name || agentId;
              
              setAgents(prev => {
                const newAgents = new Map(prev);
                const existing = newAgents.get(agentId) || {
                  id: agentId,
                  name: agentName,
                  status: 'idle',
                  lastEvent: streamEvent.type
                };
                
                if (streamEvent.type.includes('started')) {
                  existing.status = 'running';
                  existing.progress = 0;
                } else if (streamEvent.type.includes('completed')) {
                  existing.status = 'completed';
                  existing.progress = 100;
                } else if (streamEvent.type.includes('failed')) {
                  existing.status = 'failed';
                }
                
                existing.lastEvent = streamEvent.type;
                newAgents.set(agentId, existing);
                return newAgents;
              });
            }
            
            // Update progress from telemetry
            if (streamEvent.type === 'telemetry' && data.data?.progress !== undefined) {
              const agentId = data.data?.agent_id || data.agent_id;
              if (agentId) {
                setAgents(prev => {
                  const newAgents = new Map(prev);
                  const existing = newAgents.get(agentId);
                  if (existing) {
                    existing.progress = data.data.progress;
                    newAgents.set(agentId, existing);
                  }
                  return newAgents;
                });
              }
            }
          } catch (err) {
            console.error('[StreamingEventViewer] Error parsing message:', err);
          }
        };

        ws.onerror = (error) => {
          console.error('[StreamingEventViewer] WebSocket error:', error);
          setConnectionStatus('error');
        };

        ws.onclose = () => {
          console.log('[StreamingEventViewer] WebSocket closed');
          setConnectionStatus('disconnected');
          wsRef.current = null;
          
          // Attempt to reconnect after 3 seconds
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[StreamingEventViewer] Attempting to reconnect...');
            connectWebSocket();
          }, 3000);
        };
      } catch (err) {
        console.error('[StreamingEventViewer] Failed to create WebSocket:', err);
        setConnectionStatus('error');
        
        // Retry after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 5000);
      }
    };

    connectWebSocket();

    // Cleanup
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, []);

  // Auto-scroll to latest event
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'success';
      case 'connecting': return 'warning';
      case 'error': return 'error';
      default: return 'default';
    }
  };

  const getAgentStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return <PlayArrow />;
      case 'completed': return <CheckCircle />;
      case 'failed': return <ErrorIcon />;
      default: return null;
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', gap: 2, p: 2 }}>
      {/* Left Panel: Event Stream */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" spacing={2} alignItems="center" mb={2}>
          <Typography variant="h6">Event Stream</Typography>
          <Chip 
            label={connectionStatus} 
            color={getStatusColor()} 
            size="small"
          />
        </Stack>
        
        <Paper sx={{ flex: 1, overflow: 'auto', p: 2, bgcolor: 'background.default' }}>
          {events.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No events yet. Waiting for agent activity...
            </Typography>
          ) : (
            <Stack spacing={1}>
              {events.map((event) => (
                <Paper 
                  key={event.id} 
                  sx={{ 
                    p: 1, 
                    bgcolor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'divider'
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip label={event.type} size="small" />
                    {event.source && (
                      <Typography variant="caption" color="text.secondary">
                        {event.source}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </Typography>
                  </Stack>
                  <Typography 
                    variant="body2" 
                    component="pre" 
                    sx={{ 
                      mt: 1,
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word'
                    }}
                  >
                    {typeof event.data === 'object' 
                      ? JSON.stringify(event.data, null, 2) 
                      : String(event.data)}
                  </Typography>
                </Paper>
              ))}
              <div ref={eventsEndRef} />
            </Stack>
          )}
        </Paper>
      </Box>

      {/* Right Panel: Agent Status */}
      <Box sx={{ width: 300, display: 'flex', flexDirection: 'column' }}>
        <Typography variant="h6" mb={2}>Active Agents</Typography>
        
        <Stack spacing={2}>
          {agents.size === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No active agents
            </Typography>
          ) : (
            Array.from(agents.values()).map(agent => (
              <Paper key={agent.id} sx={{ p: 2 }}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                  {getAgentStatusIcon(agent.status)}
                  <Typography variant="subtitle2">{agent.name}</Typography>
                </Stack>
                
                <Chip 
                  label={agent.status} 
                  size="small" 
                  color={
                    agent.status === 'running' ? 'primary' :
                    agent.status === 'completed' ? 'success' :
                    agent.status === 'failed' ? 'error' : 'default'
                  }
                />
                
                {agent.progress !== undefined && agent.status === 'running' && (
                  <LinearProgress 
                    variant="determinate" 
                    value={agent.progress} 
                    sx={{ mt: 1 }}
                  />
                )}
                
                {agent.lastEvent && (
                  <Typography variant="caption" display="block" mt={1}>
                    Last: {agent.lastEvent}
                  </Typography>
                )}
              </Paper>
            ))
          )}
        </Stack>
      </Box>
    </Box>
  );
};

export default StreamingEventViewer;