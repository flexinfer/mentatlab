#!/usr/bin/env python3
"""
Psyche Simulation - A Jungian-inspired self-simulation with NiceGUI interface
"""

import logging
import os
from nicegui import ui, app
from utils.health_check import setup_health_endpoints
from data.redis_state_manager import RedisStateManager
from config.config import API_HOST, API_PORT, STORAGE_SECRET
from utils.broadcast import broadcast

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def setup_application():
    """Setup the application with health checks and Redis integration"""
    try:
        # Initialize Redis manager
        redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
        if os.getenv('REDIS_PASSWORD'):
            # Parse URL and add password
            if '://' in redis_url:
                protocol, rest = redis_url.split('://', 1)
                redis_url = f"{protocol}://:{os.getenv('REDIS_PASSWORD')}@{rest}"
        
        redis_manager = RedisStateManager(redis_url)
        logger.info("Redis manager initialized")
        
        # Setup health check endpoints - try different ways to access FastAPI
        try:
            # Try newer NiceGUI API first
            if hasattr(app, 'fastapi'):
                setup_health_endpoints(app.fastapi, redis_manager)
            elif hasattr(app, '_app'):
                setup_health_endpoints(app._app, redis_manager)
            else:
                # Fallback - skip health endpoints for now
                logger.warning("Could not access FastAPI app for health endpoints")
            logger.info("Health check endpoints configured")
        except Exception as health_error:
            logger.warning(f"Could not setup health endpoints: {health_error}")
        
        # Check UI mode from environment variable
        ui_mode = os.getenv('PSYCHE_UI_MODE', 'legacy').lower()
        logger.info(f"UI mode: {ui_mode}")
        
        # Import and create appropriate UI
        if ui_mode == 'streaming':
            from ui.streaming_main_window import create_ui
            logger.info("Using streaming UI mode")
        else:
            from ui.main_window import create_ui
            logger.info("Using legacy UI mode")
        
        # Create main UI
        create_ui()
        logger.info("UI initialized")
        
        return redis_manager
        
    except Exception as e:
        logger.error(f"Application setup failed: {e}")
        raise

# WebSocket endpoint
from fastapi import WebSocket

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await broadcast.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # This is where you would handle incoming messages from the client
            # For now, we'll just log them
            logger.info(f"Received message from client: {data}")
    except Exception as e:
        logger.warning(f"WebSocket error: {e}")
    finally:
        broadcast.disconnect(websocket)

# Main entry point
if __name__ == '__main__':
    # Setup application components
    redis_manager = setup_application()
    
    # Configure server settings
    logger.info(f"Starting Psyche Simulation on {API_HOST}:{API_PORT}")
    
    ui.run(
        title='Psyche Simulation',
        favicon='🧠',
        dark=True,
        reload=False,
        host=API_HOST,
        port=API_PORT,
        show=False,  # Don't open browser in production
        storage_secret=STORAGE_SECRET  # Required for user storage
    )