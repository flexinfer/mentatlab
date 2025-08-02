import asyncio
import json
import logging

import redis.asyncio as redis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

# Import streaming capabilities
from services.gateway.app.streaming import streaming_manager, StreamEventType, StreamMessage

logger = logging.getLogger(__name__)

router = APIRouter()

REDIS_URL = "redis://localhost"
UI_NOTIFICATION_CHANNEL = "orchestrator_ui_events"
STREAMING_EVENTS_CHANNEL = "mentatlab_streaming_events"

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.redis_client = None
        self.pubsub = None
        self._streaming_integration_enabled = True

    async def connect_redis(self):
        """Establishes connection to Redis and subscribes to notification channels."""
        try:
            self.redis_client = redis.from_url(REDIS_URL, decode_responses=True)
            self.pubsub = self.redis_client.pubsub()
            await self.pubsub.subscribe(UI_NOTIFICATION_CHANNEL, STREAMING_EVENTS_CHANNEL)
            logger.info(f"Subscribed to Redis channels: {UI_NOTIFICATION_CHANNEL}, {STREAMING_EVENTS_CHANNEL}")
            asyncio.create_task(self.listen_for_redis_messages())
        except Exception as e:
            logger.warning(f"Failed to connect to Redis, running without pub/sub: {e}")
            self.redis_client = None
            self.pubsub = None

    async def listen_for_redis_messages(self):
        """Listens for messages from Redis Pub/Sub and forwards them to connected WebSocket clients."""
        if not self.pubsub:
            logger.info("Redis pubsub not available, skipping message listening")
            return
            
        while True:
            try:
                message = await self.pubsub.get_message(ignore_subscribe_messages=True)
                if message and message['type'] == 'message':
                    data = json.loads(message['data'])
                    channel = message['channel']
                    
                    # Handle different channel types
                    if channel == UI_NOTIFICATION_CHANNEL:
                        logger.info(f"Received UI notification from Redis: {data}")
                        await self.broadcast(json.dumps(data))
                    elif channel == STREAMING_EVENTS_CHANNEL and self._streaming_integration_enabled:
                        logger.info(f"Received streaming event from Redis: {data}")
                        await self.handle_streaming_event(data)
                        
            except Exception as e:
                logger.error(f"Error listening to Redis: {e}")
                await asyncio.sleep(5) # Prevent tight loop on error
                break  # Exit the loop on persistent errors

    async def handle_streaming_event(self, event_data: dict):
        """Handle streaming events and forward to appropriate clients."""
        try:
            event_type = event_data.get('type')
            stream_id = event_data.get('stream_id')
            
            if event_type and stream_id:
                # Forward streaming events to the dedicated streaming manager
                # This allows coordination between traditional UI events and streaming
                if hasattr(streaming_manager, 'handle_external_event'):
                    await streaming_manager.handle_external_event(event_data)
                
                # Also broadcast to traditional WebSocket clients that might be interested
                enhanced_event = {
                    "event_type": "streaming_update",
                    "payload": event_data,
                    "timestamp": event_data.get('timestamp')
                }
                await self.broadcast(json.dumps(enhanced_event))
                
        except Exception as e:
            logger.error(f"Error handling streaming event: {e}")

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected: {websocket.client}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket disconnected: {websocket.client}")

    async def broadcast(self, message: str):
        failed_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except RuntimeError as e:
                logger.error(f"Error sending message to WebSocket: {e}. Disconnecting client.")
                failed_connections.append(connection)
            except Exception as e:
                logger.error(f"Unexpected error broadcasting message: {e}")
                failed_connections.append(connection)
        
        # Remove failed connections
        for connection in failed_connections:
            self.disconnect(connection)
    
    async def publish_streaming_event(self, event_data: dict):
        """Publish streaming events to Redis for coordination."""
        if self.redis_client and self._streaming_integration_enabled:
            try:
                await self.redis_client.publish(
                    STREAMING_EVENTS_CHANNEL,
                    json.dumps(event_data)
                )
            except Exception as e:
                logger.error(f"Failed to publish streaming event to Redis: {e}")

manager = ConnectionManager()

@router.websocket("/ws/orchestrator-events")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Handle incoming messages from clients
            message = await websocket.receive_text()
            
            try:
                data = json.loads(message)
                msg_type = data.get("type")
                
                # Handle different message types
                if msg_type == "ping":
                    await websocket.send_text(json.dumps({
                        "type": "pong",
                        "timestamp": data.get("timestamp")
                    }))
                elif msg_type == "subscribe_streaming":
                    # Allow traditional WebSocket clients to express interest in streaming updates
                    await websocket.send_text(json.dumps({
                        "type": "streaming_subscription_confirmed",
                        "message": "Will receive streaming updates"
                    }))
                # Add more message types as needed
                
            except json.JSONDecodeError:
                # Non-JSON messages are kept for compatibility
                pass
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

# Ensure Redis connection is established when the application starts
@router.on_event("startup")
async def startup_event():
    await manager.connect_redis()
    # Initialize streaming manager if not already done
    if hasattr(streaming_manager, 'initialize') and not hasattr(streaming_manager, '_initialized'):
        try:
            await streaming_manager.initialize()
            streaming_manager._initialized = True
            logger.info("Streaming manager initialized from websockets startup")
        except Exception as e:
            logger.error(f"Failed to initialize streaming manager: {e}")

@router.on_event("shutdown")
async def shutdown_event():
    try:
        if manager.pubsub:
            await manager.pubsub.unsubscribe(UI_NOTIFICATION_CHANNEL, STREAMING_EVENTS_CHANNEL)
            await manager.pubsub.close()
    except Exception as e:
        logger.warning(f"Error closing pubsub connection: {e}")
    
    try:
        if manager.redis_client:
            await manager.redis_client.close()
    except Exception as e:
        logger.warning(f"Error closing Redis connection: {e}")
    
    # Shutdown streaming manager
    if hasattr(streaming_manager, 'shutdown'):
        try:
            await streaming_manager.shutdown()
            logger.info("Streaming manager shutdown complete")
        except Exception as e:
            logger.error(f"Error shutting down streaming manager: {e}")
    
    logger.info("Redis connection and streaming services closed on shutdown.")