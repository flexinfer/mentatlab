#!/usr/bin/env python3
"""Test script to verify streaming pipeline end-to-end."""

import requests
import json
from datetime import datetime
import time

GATEWAY_URL = "http://localhost:8080"

def test_streaming():
    """Test the streaming pipeline by initializing a stream and publishing events."""
    
    print("=== Testing Streaming Pipeline ===\n")
    
    # 1. Initialize a stream
    print("1. Initializing stream...")
    init_response = requests.post(
        f"{GATEWAY_URL}/api/v1/streams/init",
        json={
            "agent_id": "test.agent",
            "metadata": {
                "test": True,
                "timestamp": datetime.now().isoformat()
            }
        }
    )
    
    if init_response.status_code != 200:
        print(f"❌ Failed to initialize stream: {init_response.text}")
        return
        
    stream_data = init_response.json()
    stream_id = stream_data["stream_id"]
    print(f"✅ Stream initialized: {stream_id}")
    print(f"   WS URL: {stream_data['ws_url']}")
    print(f"   SSE URL: {stream_data['sse_url']}")
    
    # 2. List active streams
    print("\n2. Listing active streams...")
    list_response = requests.get(f"{GATEWAY_URL}/api/v1/streams")
    if list_response.status_code == 200:
        streams = list_response.json()
        # streams might be a dict with stream_ids as keys or a list
        if isinstance(streams, dict):
            print(f"✅ Active streams: {len(streams)}")
            for sid, stream_info in streams.items():
                if isinstance(stream_info, dict):
                    print(f"   - {sid} (agent: {stream_info.get('agent_id', 'unknown')})")
                else:
                    print(f"   - {sid}")
        else:
            print(f"✅ Active streams: {len(streams)}")
    
    # 3. Publish test events
    print(f"\n3. Publishing events to stream {stream_id}...")
    
    # Use the actual stream_id from initialization
    publish_url = f"{GATEWAY_URL}/api/v1/streams/{stream_id}/publish"
    
    # Agent started event
    print("   Publishing agent_started...")
    requests.post(
        publish_url,
        json={
            "type": "agent_started",
            "agent_id": "test.agent",
            "data": {
                "name": "Test Agent",
                "version": "1.0.0",
                "started_at": datetime.now().isoformat()
            },
            "timestamp": datetime.now().isoformat()
        }
    )
    time.sleep(0.5)
    
    # Progress events
    for i in range(1, 4):
        progress = i * 25
        print(f"   Publishing telemetry (progress: {progress}%)...")
        requests.post(
            publish_url,
            json={
                "type": "telemetry",
                "agent_id": "test.agent",
                "data": {
                    "progress": progress,
                    "status": f"Processing step {i}",
                    "metrics": {
                        "memory_mb": 100 + i * 10,
                        "cpu_percent": 20 + i * 5
                    }
                },
                "timestamp": datetime.now().isoformat()
            }
        )
        time.sleep(1)
    
    # Agent output
    print("   Publishing agent output...")
    requests.post(
        publish_url,
        json={
            "type": "agent_output",
            "agent_id": "test.agent",
            "data": {
                "result": "Test completed successfully",
                "output": {
                    "message": "Hello from test agent!",
                    "data": [1, 2, 3, 4, 5],
                    "status": "success"
                }
            },
            "timestamp": datetime.now().isoformat()
        }
    )
    time.sleep(0.5)
    
    # Agent completed event
    print("   Publishing agent_completed...")
    requests.post(
        publish_url,
        json={
            "type": "agent_completed",
            "agent_id": "test.agent",
            "data": {
                "duration_ms": 4500,
                "status": "success",
                "completed_at": datetime.now().isoformat()
            },
            "timestamp": datetime.now().isoformat()
        }
    )
    
    print("\n✅ Test events published successfully!")
    print(f"\n4. Stream should be visible in the UI:")
    print(f"   - StreamingCanvas should auto-discover and connect to stream")
    print(f"   - NetworkPanel should show activity if connected")
    print(f"   - StreamingEventViewer (if mounted) should display events")
    
    print("\n5. Keeping stream alive for 10 seconds...")
    print("   Check the UI now to see the streaming data!")
    time.sleep(10)
    
    # Optional: Close the stream
    print("\n6. Closing stream...")
    # Note: There's no explicit close endpoint, streams timeout after inactivity
    
    print("\n=== Test Complete ===")

if __name__ == "__main__":
    test_streaming()