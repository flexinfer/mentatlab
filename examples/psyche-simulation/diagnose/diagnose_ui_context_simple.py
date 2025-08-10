#!/usr/bin/env python3
"""Simple diagnostic for UI context issues."""

import asyncio
import logging
from nicegui import ui, app

# Set up logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Create a simple page
@ui.page('/')
async def main_page():
    logger.info("Creating main page")
    
    ui.label("UI Context Diagnostic").classes('text-2xl font-bold mb-4')
    
    output = ui.markdown("Test results will appear here...")
    
    # Test 1: Direct UI update
    def test_direct():
        logger.info("Test 1: Direct UI update")
        output.set_content("✅ Direct UI update works")
        ui.run_javascript("console.log('Direct UI update')")
    
    ui.button("Test 1: Direct Update", on_click=test_direct)
    
    # Test 2: Async UI update
    async def test_async():
        logger.info("Test 2: Async UI update")
        await asyncio.sleep(0.1)
        try:
            output.set_content("✅ Async UI update works")
            ui.run_javascript("console.log('Async UI update')")
        except Exception as e:
            output.set_content(f"❌ Async failed: {e}")
            logger.error(f"Async error: {e}")
    
    ui.button("Test 2: Async Update", on_click=test_async)
    
    # Test 3: Background task
    async def background_task():
        logger.info("Test 3: Background task starting")
        await asyncio.sleep(1)
        try:
            # This should fail
            ui.run_javascript("console.log('Background task')")
            logger.info("Background JS succeeded (unexpected)")
        except Exception as e:
            logger.error(f"Background JS failed as expected: {e}")
            # Try with app context
            try:
                app.add_task(lambda: ui.run_javascript("console.log('Background with app.add_task')"))
                logger.info("Background with app.add_task queued")
            except Exception as e2:
                logger.error(f"app.add_task also failed: {e2}")
    
    def start_background():
        output.set_content("Started background task - check console")
        asyncio.create_task(background_task())
    
    ui.button("Test 3: Background Task", on_click=start_background)
    
    # Test 4: Client-specific update
    async def test_client():
        logger.info("Test 4: Client update")
        client = await ui.context.client.get()
        logger.info(f"Client ID: {client.id if client else 'None'}")
        if client:
            await client.run_javascript("console.log('Client-specific update')")
            output.set_content(f"✅ Client update sent to {client.id}")
        else:
            output.set_content("❌ No client found")
    
    ui.button("Test 4: Client Update", on_click=test_client)
    
    # Test 5: Timer-based update
    def start_timer():
        output.set_content("Timer started - updates every 2 seconds")
        
        async def timer_update():
            count = 0
            while count < 3:
                await asyncio.sleep(2)
                count += 1
                try:
                    logger.info(f"Timer update {count}")
                    # This should work because timer is started from UI context
                    output.set_content(f"Timer update {count}/3")
                except Exception as e:
                    logger.error(f"Timer error: {e}")
                    break
        
        asyncio.create_task(timer_update())
    
    ui.button("Test 5: Timer Updates", on_click=start_timer)

# Run the app
logger.info("Starting diagnostic app on port 8081")
ui.run(
    title="UI Context Diagnostic",
    port=8081,
    reload=False
)