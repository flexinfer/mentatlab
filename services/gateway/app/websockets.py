import asyncio
import json
import logging

import redis.asyncio as redis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter()

REDIS_URL = "redis://localhost"
UI_NOTIFICATION_CHANNEL = "orchestrator_ui_events"

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.redis_client = None
        self.pubsub = None

    async def connect_redis(self):
        """Establishes connection to Redis and subscribes to the UI notification channel."""
        self.redis_client = redis.from_url(REDIS_URL, decode_responses=True)
        self.pubsub = self.redis_client.pubsub()
        await self.pubsub.subscribe(UI_NOTIFICATION_CHANNEL)
        logger.info(f"Subscribed to Redis channel: {UI_NOTIFICATION_CHANNEL}")
        asyncio.create_task(self.listen_for_redis_messages())

    async def listen_for_redis_messages(self):
        """Listens for messages from Redis Pub/Sub and forwards them to connected WebSocket clients."""
        while True:
            try:
                message = await self.pubsub.get_message(ignore_subscribe_messages=True)
                if message and message['type'] == 'message':
                    data = json.loads(message['data'])
                    logger.info(f"Received message from Redis: {data}")
                    await self.broadcast(json.dumps(data))
            except Exception as e:
                logger.error(f"Error listening to Redis: {e}")
                await asyncio.sleep(1) # Prevent tight loop on error

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connected: {websocket.client}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        logger.info(f"WebSocket disconnected: {websocket.client}")

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except RuntimeError as e:
                logger.error(f"Error sending message to WebSocket: {e}. Disconnecting client.")
                self.disconnect(connection)
            except Exception as e:
                logger.error(f"Unexpected error broadcasting message: {e}")

manager = ConnectionManager()

@router.websocket("/ws/orchestrator-events")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep the connection alive, or handle incoming messages if needed
            await websocket.receive_text() 
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

# Ensure Redis connection is established when the application starts
@router.on_event("startup")
async def startup_event():
    await manager.connect_redis()

@router.on_event("shutdown")
async def shutdown_event():
    if manager.redis_client:
        await manager.redis_client.close()
    if manager.pubsub:
        await manager.pubsub.unsubscribe(UI_NOTIFICATION_CHANNEL)
        await manager.pubsub.close()
    logger.info("Redis connection closed on shutdown.")