#!/usr/bin/env python3
"""
Verify that the critical errors have been fixed.
"""

import asyncio
import logging
from nicegui import ui

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_fixes():
    """Test that the fixes work correctly."""
    
    print("=" * 80)
    print("VERIFYING CRITICAL FIXES")
    print("=" * 80)
    
    # Test 1: Verify ui.run_javascript works without asyncio.create_task
    print("\n1. Testing ui.run_javascript without asyncio.create_task...")
    try:
        # This should work without wrapping in create_task
        ui.run_javascript('console.log("Direct JavaScript execution works!");')
        print("   ✓ Direct ui.run_javascript call successful")
    except Exception as e:
        print(f"   ✗ Error: {e}")
    
    # Test 2: Import and test network broadcasting
    print("\n2. Testing network broadcast...")
    try:
        from simulation.network import AgentNetwork
        from utils.websocket_events import broadcast_network_update
        
        network = AgentNetwork()
        # This should not throw a float attribute error
        broadcast_network_update(
            connections=network.get_connections(),
            communication_stats=network.get_stats()
        )
        print("   ✓ Network broadcast successful")
    except Exception as e:
        print(f"   ✗ Error: {e}")
        import traceback
        traceback.print_exc()
    
    # Test 3: Test WebSocket broadcaster
    print("\n3. Testing WebSocket broadcaster...")
    try:
        from utils.websocket_broadcaster import get_broadcaster
        
        broadcaster = get_broadcaster()
        await broadcaster.broadcast_agent_message(
            agent_id="TestAgent",
            message="Test message after fixes",
            metadata={'test': True}
        )
        print("   ✓ WebSocket broadcaster working")
    except Exception as e:
        print(f"   ✗ Error: {e}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "=" * 80)
    print("Verification complete!")
    print("If all tests passed, the real-time updates should now work.")

if __name__ == "__main__":
    asyncio.run(test_fixes())
