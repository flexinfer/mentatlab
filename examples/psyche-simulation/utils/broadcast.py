import asyncio
import logging
from typing import Any, Dict, List

from fastapi import WebSocket

# Configure logging
logger = logging.getLogger(__name__)

class Broadcast:
    """
    Manages WebSocket connections and broadcasts events to clients.
    """
    def __init__(self):
        self.connections: List[WebSocket] = []
        self.channel_subscriptions: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket):
        """
        Accepts a new WebSocket connection and adds it to the list of active connections.
        """
        await websocket.accept()
        self.connections.append(websocket)
        logger.info("New WebSocket connection established.")

    def disconnect(self, websocket: WebSocket):
        """
        Removes a WebSocket connection from the list of active connections.
        """
        self.connections.remove(websocket)
        for channel in self.channel_subscriptions:
            if websocket in self.channel_subscriptions[channel]:
                self.channel_subscriptions[channel].remove(websocket)
        logger.info("WebSocket connection closed.")

    async def publish(self, channel: str, message: Any):
        """
        Publishes an event to all clients subscribed to a specific channel.
        """
        if channel in self.channel_subscriptions:
            for websocket in self.channel_subscriptions[channel]:
                await websocket.send_json(message)
                logger.info(f"Message published to channel '{channel}': {message}")

    async def subscribe(self, websocket: WebSocket, channel: str):
        """
        Subscribes a client to a specific channel.
        """
        if channel not in self.channel_subscriptions:
            self.channel_subscriptions[channel] = []
        self.channel_subscriptions[channel].append(websocket)
        logger.info(f"Client subscribed to channel '{channel}'.")

    async def unsubscribe(self, websocket: WebSocket, channel: str):
        """
        Unsubscribes a client from a specific channel.
        """
        if channel in self.channel_subscriptions:
            if websocket in self.channel_subscriptions[channel]:
                self.channel_subscriptions[channel].remove(websocket)
                logger.info(f"Client unsubscribed from channel '{channel}'.")

# Instantiate the broadcast manager
broadcast = Broadcast()

async def security_event_handler(event: dict):
    """
    Handles security events and broadcasts them to the UI.
    """
    await broadcast.publish(
        "security_events",
        {"type": "security_event", "data": event},
    )
    logger.info(f"Security event broadcasted: {event}")