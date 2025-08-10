#!/usr/bin/env python3
"""Diagnose UI context issues in streaming mode."""

import asyncio
import logging
from nicegui import ui, context
from utils.websocket_broadcaster import RealtimeUIUpdater, get_broadcaster
from utils.websocket_events import broadcast_agent_processing_update

# Set up logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

async def test_context_flow():
    """Test UI context flow in different scenarios."""
    
    # Create UI components
    with ui.column() as main_container:
        ui.label("Context Test UI")
        test_output = ui.markdown("Waiting for tests...")
        
        # Store context info
        current_context = context.get_context()
        logger.info(f"Initial context: {current_context}")
        logger.info(f"Context client: {current_context.client if current_context else None}")
        
        # Create realtime updater
        updater = RealtimeUIUpdater()
        
        # Test 1: Direct JavaScript execution
        ui.button("Test Direct JS", on_click=lambda: ui.run_javascript("console.log('Direct JS works')"))
        
        # Test 2: Async JavaScript execution
        async def async_js_test():
            logger.info(f"Async context before: {context.get_context()}")
            await asyncio.sleep(0.1)
            logger.info(f"Async context after sleep: {context.get_context()}")
            try:
                ui.run_javascript("console.log('Async JS test')")
                test_output.set_content("✅ Async JS succeeded")
            except Exception as e:
                test_output.set_content(f"❌ Async JS failed: {e}")
                logger.error(f"Async JS error: {e}")
        
        ui.button("Test Async JS", on_click=async_js_test)
        
        # Test 3: Background task JavaScript
        async def background_task():
            logger.info("Starting background task")
            await asyncio.sleep(1)
            logger.info(f"Background context: {context.get_context()}")
            try:
                # This should fail
                ui.run_javascript("console.log('Background JS test')")
                test_output.set_content("✅ Background JS succeeded (unexpected!)")
            except Exception as e:
                test_output.set_content(f"❌ Background JS failed as expected: {e}")
                logger.error(f"Background JS error (expected): {e}")
                
                # Try with stored context
                if current_context:
                    logger.info("Trying with stored context...")
                    with current_context:
                        try:
                            ui.run_javascript("console.log('Background JS with context')")
                            test_output.set_content("✅ Background JS with context succeeded")
                        except Exception as e:
                            test_output.set_content(f"❌ Background JS with context failed: {e}")
                            logger.error(f"Background JS with context error: {e}")
        
        ui.button("Test Background JS", on_click=lambda: asyncio.create_task(background_task()))
        
        # Test 4: WebSocket event simulation
        async def simulate_websocket_event():
            logger.info("Simulating WebSocket event")
            # This simulates what happens when an agent processing update comes in
            broadcast_agent_processing_update(
                agent_id="TestAgent",
                progress=0.5,
                partial_content="Testing partial content..."
            )
            test_output.set_content("WebSocket event broadcast - check console for errors")
        
        ui.button("Test WebSocket Event", on_click=simulate_websocket_event)
        
        # Test 5: Client-specific updates
        async def test_client_update():
            logger.info("Testing client-specific update")
            client = current_context.client if current_context else None
            if client:
                logger.info(f"Client ID: {client.id}")
                # Try to execute JS on specific client
                await client.run_javascript("console.log('Client-specific JS')")
                test_output.set_content("✅ Client-specific JS sent")
            else:
                test_output.set_content("❌ No client available")
        
        ui.button("Test Client Update", on_click=test_client_update)

# Run the app
ui.run(
    title="UI Context Diagnostic",
    port=8081,
    reload=False
)