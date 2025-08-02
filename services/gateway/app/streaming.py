"""
Streaming API implementation for MentatLab Phase 2 Beta milestone.

Provides WebSocket and Server-Sent Events (SSE) support for real-time
agent data streaming with multimodal support.
"""

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Any, Union
from enum import Enum

import redis.asyncio as redis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()

# Configuration
REDIS_URL = "redis://localhost"
STREAM_REGISTRY_KEY = "mentatlab:streams"
STREAM_EVENTS_PREFIX = "mentatlab:stream:"
MAX_BUFFER_SIZE = 1000
HEARTBEAT_INTERVAL = 30  # seconds


class StreamEventType(str, Enum):
    """Stream event types for protocol specification."""
    STREAM_START = "stream_start"
    STREAM_DATA = "stream_data" 
    STREAM_END = "stream_end"
    STREAM_ERROR = "stream_error"
    HEARTBEAT = "heartbeat"


class StreamStatus(str, Enum):
    """Stream session status."""
    INITIALIZING = "initializing"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    ERROR = "error"


class StreamMessage(BaseModel):
    """Standardized stream message format."""
    type: StreamEventType
    data: Dict[str, Any]
    timestamp: str
    agent_id: str
    stream_id: str
    sequence: Optional[int] = None


class StreamSession(BaseModel):
    """Stream session metadata."""
    stream_id: str
    agent_id: str
    pin_name: str
    status: StreamStatus
    created_at: str
    subscriber_count: int = 0
    message_count: int = 0
    last_activity: str


class StreamingConnectionManager:
    """Enhanced connection manager for streaming with multimodal support."""
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.stream_sessions: Dict[str, StreamSession] = {}
        self.stream_subscriptions: Dict[str, Set[str]] = {}  # stream_id -> set of connection_ids
        self.connection_streams: Dict[str, Set[str]] = {}  # connection_id -> set of stream_ids
        self.message_buffers: Dict[str, List[StreamMessage]] = {}
        self.redis_client: Optional[redis.Redis] = None
        self._heartbeat_task: Optional[asyncio.Task] = None
        
    async def initialize(self):
        """Initialize Redis connection and start background tasks."""
        try:
            # Create Redis connection pool for better concurrency handling
            self.redis_client = redis.from_url(
                REDIS_URL,
                decode_responses=True,
                max_connections=10,
                retry_on_timeout=True,
                health_check_interval=30
            )
            await self.redis_client.ping()
            logger.info("StreamingConnectionManager initialized with Redis")
            
            # Start heartbeat task
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            
        except Exception as e:
            logger.warning(f"Redis connection failed, running without persistence: {e}")
            # Continue without Redis - use in-memory only
            self.redis_client = None
    
    async def shutdown(self):
        """Cleanup resources on shutdown."""
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            
        if self.redis_client:
            await self.redis_client.close()
        
        # Close all active connections
        for connection in self.active_connections.values():
            try:
                await connection.close(code=1000, reason="Server shutdown")
            except Exception:
                pass
    
    async def connect_websocket(self, websocket: WebSocket, connection_id: Optional[str] = None) -> str:
        """Connect a WebSocket client and return connection ID."""
        # Check for subprotocol support
        subprotocols = websocket.headers.get("sec-websocket-protocol", "").split(", ")
        if "mentatlab.streaming.v1" in subprotocols:
            await websocket.accept(subprotocol="mentatlab.streaming.v1")
        else:
            await websocket.accept()
        
        if not connection_id:
            connection_id = f"ws_{uuid.uuid4().hex[:8]}"
        
        self.active_connections[connection_id] = websocket
        self.connection_streams[connection_id] = set()
        
        logger.info(f"WebSocket connected: {connection_id}")
        return connection_id
    
    async def disconnect_websocket(self, connection_id: str):
        """Disconnect a WebSocket client and cleanup subscriptions."""
        if connection_id in self.active_connections:
            # Unsubscribe from all streams
            if connection_id in self.connection_streams:
                for stream_id in self.connection_streams[connection_id].copy():
                    await self.unsubscribe_from_stream(connection_id, stream_id)
                del self.connection_streams[connection_id]
            
            # Remove connection
            del self.active_connections[connection_id]
            logger.info(f"WebSocket disconnected: {connection_id}")
    
    async def create_stream_session(self, agent_id: str, pin_name: str) -> StreamSession:
        """Create a new streaming session."""
        stream_id = f"stream_{uuid.uuid4().hex}"
        
        session = StreamSession(
            stream_id=stream_id,
            agent_id=agent_id,
            pin_name=pin_name,
            status=StreamStatus.ACTIVE,  # Set to active immediately for testing
            created_at=datetime.now(timezone.utc).isoformat(),
            last_activity=datetime.now(timezone.utc).isoformat()
        )
        
        self.stream_sessions[stream_id] = session
        self.stream_subscriptions[stream_id] = set()
        self.message_buffers[stream_id] = []
        
        # Store in Redis for persistence (if available)
        if self.redis_client:
            try:
                await self.redis_client.hset(
                    STREAM_REGISTRY_KEY,
                    stream_id,
                    session.model_dump_json()
                )
            except Exception as e:
                logger.warning(f"Failed to persist stream session to Redis: {e}")
        
        logger.info(f"Created stream session: {stream_id} for agent {agent_id}")
        return session
    
    async def subscribe_to_stream(self, connection_id: str, stream_id: str) -> bool:
        """Subscribe a connection to a stream."""
        if connection_id not in self.active_connections:
            return False
        
        if stream_id not in self.stream_sessions:
            return False
        
        # Add subscription
        self.stream_subscriptions[stream_id].add(connection_id)
        self.connection_streams[connection_id].add(stream_id)
        
        # Update subscriber count
        session = self.stream_sessions[stream_id]
        session.subscriber_count = len(self.stream_subscriptions[stream_id])
        
        # Send buffered messages to new subscriber
        if stream_id in self.message_buffers:
            websocket = self.active_connections[connection_id]
            for message in self.message_buffers[stream_id]:
                try:
                    await websocket.send_text(message.model_dump_json())
                except Exception as e:
                    logger.error(f"Failed to send buffered message: {e}")
        
        logger.info(f"Connection {connection_id} subscribed to stream {stream_id}")
        return True
    
    async def unsubscribe_from_stream(self, connection_id: str, stream_id: str):
        """Unsubscribe a connection from a stream."""
        if stream_id in self.stream_subscriptions:
            self.stream_subscriptions[stream_id].discard(connection_id)
            
            # Update subscriber count
            if stream_id in self.stream_sessions:
                session = self.stream_sessions[stream_id]
                session.subscriber_count = len(self.stream_subscriptions[stream_id])
        
        if connection_id in self.connection_streams:
            self.connection_streams[connection_id].discard(stream_id)
        
        logger.info(f"Connection {connection_id} unsubscribed from stream {stream_id}")
    
    async def broadcast_to_stream(self, stream_id: str, message: StreamMessage):
        """Broadcast a message to all subscribers of a stream."""
        if stream_id not in self.stream_subscriptions:
            logger.warning(f"Attempted to broadcast to non-existent stream: {stream_id}")
            return
        
        # Update session activity
        if stream_id in self.stream_sessions:
            session = self.stream_sessions[stream_id]
            session.last_activity = datetime.now(timezone.utc).isoformat()
            session.message_count += 1
        
        # Buffer message (with size limit)
        if stream_id in self.message_buffers:
            buffer = self.message_buffers[stream_id]
            buffer.append(message)
            if len(buffer) > MAX_BUFFER_SIZE:
                buffer.pop(0)  # Remove oldest message
        
        # Send to all subscribers
        message_json = message.model_dump_json()
        failed_connections = []
        
        for connection_id in self.stream_subscriptions[stream_id]:
            if connection_id in self.active_connections:
                websocket = self.active_connections[connection_id]
                try:
                    await websocket.send_text(message_json)
                except Exception as e:
                    logger.error(f"Failed to send message to {connection_id}: {e}")
                    failed_connections.append(connection_id)
        
        # Clean up failed connections
        for connection_id in failed_connections:
            await self.disconnect_websocket(connection_id)
    
    async def end_stream(self, stream_id: str):
        """End a streaming session."""
        if stream_id in self.stream_sessions:
            session = self.stream_sessions[stream_id]
            session.status = StreamStatus.COMPLETED
            
            # Send end message to all subscribers
            end_message = StreamMessage(
                type=StreamEventType.STREAM_END,
                data={"stream_id": stream_id, "message_count": session.message_count},
                timestamp=datetime.now(timezone.utc).isoformat(),
                agent_id=session.agent_id,
                stream_id=stream_id
            )
            
            await self.broadcast_to_stream(stream_id, end_message)
            
            # Clean up after a delay to allow final message delivery
            asyncio.create_task(self._cleanup_stream_delayed(stream_id, delay=5.0))
    
    async def _cleanup_stream_delayed(self, stream_id: str, delay: float):
        """Clean up stream resources after a delay."""
        await asyncio.sleep(delay)
        
        # Remove from local storage
        self.stream_sessions.pop(stream_id, None)
        self.stream_subscriptions.pop(stream_id, None)
        self.message_buffers.pop(stream_id, None)
        
        # Remove from Redis
        if self.redis_client:
            await self.redis_client.hdel(STREAM_REGISTRY_KEY, stream_id)
        
        logger.info(f"Cleaned up stream: {stream_id}")
    
    async def _heartbeat_loop(self):
        """Send heartbeat messages to maintain connections."""
        while True:
            try:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                
                heartbeat_message = {
                    "type": StreamEventType.HEARTBEAT,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                
                failed_connections = []
                for connection_id, websocket in self.active_connections.items():
                    try:
                        await websocket.send_text(json.dumps(heartbeat_message))
                    except Exception:
                        failed_connections.append(connection_id)
                
                # Clean up failed connections
                for connection_id in failed_connections:
                    await self.disconnect_websocket(connection_id)
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in heartbeat loop: {e}")


# Global streaming manager instance
streaming_manager = StreamingConnectionManager()


# WebSocket Endpoints

@router.websocket("/ws/agents/{agent_id}/stream")
async def agent_stream_websocket(websocket: WebSocket, agent_id: str):
    """WebSocket endpoint for bidirectional agent streaming."""
    connection_id = None
    try:
        connection_id = await streaming_manager.connect_websocket(websocket)
        
        while True:
            # Receive messages from client
            message = await websocket.receive_text()
            data = json.loads(message)
            
            # Handle different message types
            msg_type = data.get("type")
            
            if msg_type == "subscribe":
                stream_id = data.get("stream_id")
                if stream_id:
                    success = await streaming_manager.subscribe_to_stream(connection_id, stream_id)
                    await websocket.send_text(json.dumps({
                        "type": "subscription_response",
                        "success": success,
                        "stream_id": stream_id
                    }))
            
            elif msg_type == "unsubscribe":
                stream_id = data.get("stream_id")
                if stream_id:
                    await streaming_manager.unsubscribe_from_stream(connection_id, stream_id)
            
            elif msg_type == "ping":
                await websocket.send_text(json.dumps({
                    "type": "pong",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }))
    
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if connection_id:
            await streaming_manager.disconnect_websocket(connection_id)


@router.websocket("/ws/streams/{stream_id}")
async def stream_websocket(websocket: WebSocket, stream_id: str):
    """WebSocket endpoint for specific stream subscription - matches test expectations."""
    connection_id = None
    try:
        connection_id = await streaming_manager.connect_websocket(websocket)
        
        # Send initial connection confirmation
        await websocket.send_text(json.dumps({
            "type": "connection",
            "status": "connected",
            "stream_id": stream_id,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }))
        
        # Auto-subscribe to the requested stream if it exists
        if stream_id in streaming_manager.stream_sessions:
            success = await streaming_manager.subscribe_to_stream(connection_id, stream_id)
            if success:
                await websocket.send_text(json.dumps({
                    "type": "subscribed",
                    "stream_id": stream_id,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }))
        
        # Keep connection alive and handle messages
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            
            # Handle different message types
            msg_type = data.get("type")
            
            if msg_type == "ping":
                await websocket.send_text(json.dumps({
                    "type": "pong",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }))
            elif msg_type == "subscribe":
                target_stream = data.get("stream_id", stream_id)
                success = await streaming_manager.subscribe_to_stream(connection_id, target_stream)
                await websocket.send_text(json.dumps({
                    "type": "subscription_response",
                    "success": success,
                    "stream_id": target_stream
                }))
            elif msg_type == "unsubscribe":
                target_stream = data.get("stream_id", stream_id)
                await streaming_manager.unsubscribe_from_stream(connection_id, target_stream)
                await websocket.send_text(json.dumps({
                    "type": "unsubscribed",
                    "stream_id": target_stream
                }))
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Stream WebSocket error: {e}")
    finally:
        if connection_id:
            await streaming_manager.disconnect_websocket(connection_id)


@router.websocket("/streaming/ws/streams/{stream_id}")
async def streaming_websocket_endpoint(websocket: WebSocket, stream_id: str):
    """WebSocket endpoint for streaming - matches test expectations."""
    connection_id = None
    try:
        connection_id = await streaming_manager.connect_websocket(websocket)
        
        # Send initial connection confirmation
        await websocket.send_text(json.dumps({
            "type": "connection",
            "status": "connected",
            "stream_id": stream_id,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }))
        
        # Auto-subscribe to the requested stream if it exists
        if stream_id in streaming_manager.stream_sessions:
            success = await streaming_manager.subscribe_to_stream(connection_id, stream_id)
            if success:
                await websocket.send_text(json.dumps({
                    "type": "subscribed",
                    "stream_id": stream_id,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }))
        
        # Keep connection alive and handle messages
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)
            
            # Handle different message types
            msg_type = data.get("type")
            
            if msg_type == "ping":
                await websocket.send_text(json.dumps({
                    "type": "pong",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }))
            elif msg_type == "subscribe":
                target_stream = data.get("stream_id", stream_id)
                success = await streaming_manager.subscribe_to_stream(connection_id, target_stream)
                await websocket.send_text(json.dumps({
                    "type": "subscription_response",
                    "success": success,
                    "stream_id": target_stream
                }))
            elif msg_type == "unsubscribe":
                target_stream = data.get("stream_id", stream_id)
                await streaming_manager.unsubscribe_from_stream(connection_id, target_stream)
                await websocket.send_text(json.dumps({
                    "type": "unsubscribed",
                    "stream_id": target_stream
                }))
            
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Streaming WebSocket error: {e}")
    finally:
        if connection_id:
            await streaming_manager.disconnect_websocket(connection_id)


# HTTP Endpoints

@router.post("/api/v1/streams/init")
async def init_stream(request: Dict[str, Any]):
    """Initialize a new streaming session."""
    agent_id = request.get("agent_id")
    pin_name = request.get("pin_name", "output")
    
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id is required")
    
    try:
        session = await streaming_manager.create_stream_session(agent_id, pin_name)
        return {
            "stream_id": session.stream_id,
            "ws_url": f"/ws/streams/{session.stream_id}",
            "sse_url": f"/api/v1/streams/{session.stream_id}/sse",
            "status": session.status
        }
    except Exception as e:
        logger.error(f"Failed to create stream: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create stream: {str(e)}")


@router.get("/api/v1/streams/{stream_id}/sse")
async def sse_stream(stream_id: str):
    """Server-Sent Events endpoint for unidirectional streaming."""
    
    if stream_id not in streaming_manager.stream_sessions:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    async def event_generator():
        """Generate SSE events for the stream."""
        try:
            # Send initial connection event
            yield f"event: stream_start\ndata: {json.dumps({'stream_id': stream_id})}\n\n"
            
            # Create a temporary subscription for SSE
            sse_connection_id = f"sse_{uuid.uuid4().hex[:8]}"
            streaming_manager.stream_subscriptions[stream_id].add(sse_connection_id)
            
            # Track last message count to send new messages
            last_message_count = 0
            
            while stream_id in streaming_manager.stream_sessions:
                session = streaming_manager.stream_sessions[stream_id]
                
                # Send new messages from buffer
                if stream_id in streaming_manager.message_buffers:
                    buffer = streaming_manager.message_buffers[stream_id]
                    new_messages = buffer[last_message_count:]
                    
                    for message in new_messages:
                        event_type = message.type.value
                        data = message.model_dump()
                        yield f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
                    
                    last_message_count = len(buffer)
                
                # Check if stream ended
                if session.status == StreamStatus.COMPLETED:
                    yield f"event: stream_end\ndata: {json.dumps({'stream_id': stream_id})}\n\n"
                    break
                
                await asyncio.sleep(0.1)  # Small delay to prevent tight loop
                
        except Exception as e:
            logger.error(f"SSE stream error: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        finally:
            # Clean up SSE subscription
            if stream_id in streaming_manager.stream_subscriptions:
                streaming_manager.stream_subscriptions[stream_id].discard(sse_connection_id)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Cache-Control"
        }
    )


@router.get("/api/v1/streams")
async def list_streams():
    """List all active streaming sessions."""
    sessions = []
    for session in streaming_manager.stream_sessions.values():
        sessions.append(session.model_dump())
    return {"streams": sessions}


@router.get("/api/v1/streams/{stream_id}")
async def get_stream_info(stream_id: str):
    """Get information about a specific stream."""
    if stream_id not in streaming_manager.stream_sessions:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    session = streaming_manager.stream_sessions[stream_id]
    return session.model_dump()


@router.delete("/api/v1/streams/{stream_id}")
async def end_stream_endpoint(stream_id: str):
    """End a streaming session."""
    if stream_id not in streaming_manager.stream_sessions:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    await streaming_manager.end_stream(stream_id)
    return {"message": f"Stream {stream_id} ended"}


# Agent API for publishing stream data

@router.post("/api/v1/streams/{stream_id}/publish")
async def publish_stream_data(stream_id: str, data: Dict[str, Any]):
    """Publish data to a stream (used by agents)."""
    if stream_id not in streaming_manager.stream_sessions:
        raise HTTPException(status_code=404, detail="Stream not found")
    
    session = streaming_manager.stream_sessions[stream_id]
    
    # Create stream message
    message = StreamMessage(
        type=StreamEventType.STREAM_DATA,
        data=data,
        timestamp=datetime.now(timezone.utc).isoformat(),
        agent_id=session.agent_id,
        stream_id=stream_id,
        sequence=session.message_count + 1
    )
    
    # Broadcast to subscribers
    await streaming_manager.broadcast_to_stream(stream_id, message)
    
    return {"message": "Data published", "sequence": message.sequence}


# Note: Startup and shutdown events are now handled in main.py
# to ensure proper initialization order