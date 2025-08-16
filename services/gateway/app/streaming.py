"""
Streaming API implementation for MentatLab Phase 2 Beta milestone.

Provides WebSocket and Server-Sent Events (SSE) support for real-time
agent data streaming with multimodal support.
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Any, Union
from enum import Enum

import redis.asyncio as redis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
# NEW: httpx for SSE proxy
import httpx

logger = logging.getLogger(__name__)

router = APIRouter()

# Configuration
REDIS_URL = os.getenv("REDIS_URL", "").strip()  # set to "redis://host:port" to enable
STREAM_REGISTRY_KEY = "mentatlab:streams"
STREAM_EVENTS_PREFIX = "mentatlab:stream:"
MAX_BUFFER_SIZE = 1000
HEARTBEAT_INTERVAL = 30  # seconds

# CloudEvents feature flags (defaults safe/off)
CE_ENABLED = os.getenv("GATEWAY_CE_ENABLED", "false").lower() == "true"
CE_SOURCE = os.getenv("GATEWAY_CE_SOURCE", "/mentatlab/gateway")
CE_SPECVERSION = os.getenv("GATEWAY_CE_VERSION", "1.0")
CE_DEFAULT_TYPE = os.getenv("GATEWAY_CE_DEFAULT_TYPE", "stream.data")
# Optional response header name (e.g., "X-CloudEvents-Enabled"); emit only for SSE responses
CE_RESPONSE_HEADER = (os.getenv("GATEWAY_CE_RESPONSE_HEADER") or "").strip() or None
# Time provider currently only supports "system" (RFC3339 via system clock); reserved for future extensibility
CE_TIME_PROVIDER = os.getenv("GATEWAY_CE_TIME_PROVIDER", "system")

def wrap_cloudevent(payload: dict, event_type: Optional[str], source: str, specversion: str) -> dict:
    """
    Minimal CloudEvents v1.0 wrapper.
    Non-destructive: original payload is placed under 'data' unchanged.
    """
    return {
        "specversion": specversion,
        "id": str(uuid.uuid4()),
        "source": source,
        "type": event_type or CE_DEFAULT_TYPE,
        "time": datetime.now(timezone.utc).isoformat(),
        "datacontenttype": "application/json",
        "data": payload,
    }

def derive_event_type(payload: dict, default_type: str) -> str:
    """
    Derive event type from payload keys ('type' or 'event_type') non-destructively.
    Falls back to default_type when not present.
    """
    if not isinstance(payload, dict):
        return default_type
    for key in ("type", "event_type"):
        if key in payload:
            val = payload.get(key)
            if val is None:
                continue
            # Handle Enum and str; otherwise stringify
            if isinstance(val, Enum):
                return str(val.value)
            if isinstance(val, str):
                return val
            return str(val)
    return default_type


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
        # If REDIS_URL is not configured, skip Redis initialization (local-dev)
        if not REDIS_URL:
            logger.info("REDIS_URL not set; running without Redis persistence (in-memory only)")
            self.redis_client = None
            # Start heartbeat task even when Redis is disabled
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            return
        
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
                    if CE_ENABLED:
                        payload_obj = message.model_dump()
                        ce_type = derive_event_type(payload_obj, CE_DEFAULT_TYPE)
                        envelope = wrap_cloudevent(payload_obj, ce_type, CE_SOURCE, CE_SPECVERSION)
                        await websocket.send_text(json.dumps(envelope))
                    else:
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
        if CE_ENABLED:
            payload_obj = message.model_dump()
            ce_type = derive_event_type(payload_obj, CE_DEFAULT_TYPE)
            envelope = wrap_cloudevent(payload_obj, ce_type, CE_SOURCE, CE_SPECVERSION)
            message_json_to_send = json.dumps(envelope)
        else:
            message_json_to_send = message.model_dump_json()
        failed_connections = []
        
        for connection_id in self.stream_subscriptions[stream_id]:
            if connection_id in self.active_connections:
                websocket = self.active_connections[connection_id]
                try:
                    await websocket.send_text(message_json_to_send)
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
            _start_payload = {"stream_id": stream_id}
            if CE_ENABLED:
                _start_envelope = wrap_cloudevent(
                    _start_payload,
                    derive_event_type(_start_payload, CE_DEFAULT_TYPE),
                    CE_SOURCE,
                    CE_SPECVERSION
                )
                _start_data = json.dumps(_start_envelope)
            else:
                _start_data = json.dumps(_start_payload)
            yield f"event: stream_start\ndata: {_start_data}\n\n"
            
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
                        payload_obj = message.model_dump()
                        if CE_ENABLED:
                            ce_type = derive_event_type(payload_obj, CE_DEFAULT_TYPE)
                            envelope = wrap_cloudevent(payload_obj, ce_type, CE_SOURCE, CE_SPECVERSION)
                            data_json = json.dumps(envelope)
                        else:
                            data_json = json.dumps(payload_obj)
                        yield f"event: {event_type}\ndata: {data_json}\n\n"
                    
                    last_message_count = len(buffer)
                
                # Check if stream ended
                if session.status == StreamStatus.COMPLETED:
                    _end_payload = {"stream_id": stream_id}
                    if CE_ENABLED:
                        _end_envelope = wrap_cloudevent(
                            _end_payload,
                            derive_event_type(_end_payload, CE_DEFAULT_TYPE),
                            CE_SOURCE,
                            CE_SPECVERSION
                        )
                        _end_data = json.dumps(_end_envelope)
                    else:
                        _end_data = json.dumps(_end_payload)
                    yield f"event: stream_end\ndata: {_end_data}\n\n"
                    break
                
                await asyncio.sleep(0.1)  # Small delay to prevent tight loop
            
        except Exception as e:
            logger.error(f"SSE stream error: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        finally:
            # Clean up SSE subscription
            if stream_id in streaming_manager.stream_subscriptions:
                streaming_manager.stream_subscriptions[stream_id].discard(sse_connection_id)
    
    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control"
    }
    # Optional header emission when CE is enabled
    if CE_ENABLED and CE_RESPONSE_HEADER:
        headers[CE_RESPONSE_HEADER] = "true"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers=headers
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


# NEW: SSE proxy endpoint for orchestrator runs
@router.get("/api/v1/runs/{run_id}/events")
async def sse_run_events(run_id: str, request: Request):
    """
    Proxy SSE stream from Orchestrator:
    - Forwards Last-Event-ID header and query params (e.g., replay)
    - Streams bytes transparently without altering frames
    - Does not attempt reconnect; client handles it
    """
    url = _orch_url(f"/api/v1/runs/{run_id}/events")
    headers = _forward_sse_headers(request)
    params = dict(request.query_params)

    # Use shared httpx.AsyncClient from app.state
    client: httpx.AsyncClient = getattr(request.app.state, "http_client", None)
    if client is None:
        # Fall back with an explicit error; matches 502 guidance (infra issue)
        raise HTTPException(status_code=502, detail="orchestrator_unreachable: http client not initialized")

    # Preflight to honor non-200 statuses transparently (before starting StreamingResponse)
    try:
        pre = await client.get(url, headers=headers, params=params)
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"orchestrator_unreachable: {str(e)}")
    if pre.status_code != 200:
        # Forward body+status as-is
        return StreamingResponse(
            content=iter((pre.content,)),  # single chunk
            media_type=pre.headers.get("content-type", "application/json"),
            status_code=pre.status_code,
        )

    async def upstream_iter():
        # Open a fresh streaming connection for actual event flow
        async with client.stream("GET", url, headers=headers, params=params) as r:
            # If upstream errors after preflight (rare), surface its body as an SSE 'error' frame
            if r.status_code != 200:
                body = await r.aread()
                # Emit a minimal SSE error frame without changing status (stream already started)
                yield b"event: error\ndata: " + json.dumps({"status": r.status_code, "error": body.decode(errors="ignore")}).encode() + b"\n\n"
                return
            async for chunk in r.aiter_bytes():
                # Transparent passthrough; do not modify bytes
                yield chunk

    # SSE response headers recommended for proxies/CDN compatibility
    resp_headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(upstream_iter(), media_type="text/event-stream", headers=resp_headers)


# Note: Startup and shutdown events are now handled in main.py
# to ensure proper initialization order