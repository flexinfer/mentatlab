#!/usr/bin/env python3
"""
Comprehensive Diagnostic Script for Real-Time UI System

This script tests:
1. WebSocket event system functionality
2. Real-time streaming from agents
3. UI update mechanisms
4. End-to-end flow from LLM to UI
"""

import asyncio
import logging
import sys
import time
from typing import Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def print_section(title: str):
    """Print a section header"""
    print("\n" + "="*60)
    print(f"  {title}")
    print("="*60 + "\n")

async def test_websocket_events():
    """Test WebSocket event broadcasting system"""
    print_section("1. Testing WebSocket Event System")
    
    try:
        from utils.websocket_events import (
            get_event_manager,
            broadcast_agent_message,
            broadcast_network_update,
            broadcast_system_status,
            broadcast_agent_processing_started,
            broadcast_agent_processing_update,
            broadcast_agent_processing_complete
        )
        
        print("✓ Successfully imported WebSocket event functions")
        
        # Test event manager
        event_manager = get_event_manager()
        print(f"✓ Event manager initialized: {event_manager}")
        
        # Test different event broadcasts
        print("\nTesting event broadcasts:")
        
        # 1. System status
        broadcast_system_status(
            is_running=True,
            performance_data={'cpu_percent': 10.5, 'memory_percent': 25.3},
            active_agents=['Shadow', 'Persona']
        )
        print("✓ System status broadcast sent")
        
        # 2. Agent processing events
        broadcast_agent_processing_started(
            agent_id="Shadow",
            agent_type="ShadowAgent",
            situation="Testing real-time streaming"
        )
        print("✓ Agent processing started event sent")
        
        # Simulate streaming
        test_message = "This is a test of the real-time streaming system."
        for word in test_message.split():
            broadcast_agent_processing_update(
                agent_id="Shadow",
                partial_content=word + " ",
                progress=0.5
            )
            await asyncio.sleep(0.1)
        print("✓ Streaming updates sent")
        
        broadcast_agent_processing_complete(
            agent_id="Shadow",
            final_content=test_message,
            sentiment_data={'score': 0.8, 'label': 'positive'}
        )
        print("✓ Agent processing complete event sent")
        
        return True
        
    except Exception as e:
        print(f"✗ WebSocket event test failed: {e}")
        logger.exception("WebSocket event error")
        return False

async def test_ui_broadcaster():
    """Test UI broadcaster integration"""
    print_section("2. Testing UI Broadcaster")
    
    try:
        from utils.websocket_broadcaster import WebSocketBroadcaster, RealtimeUIUpdater
        
        print("✓ Successfully imported broadcaster classes")
        
        # Create broadcaster instance
        broadcaster = WebSocketBroadcaster()
        print(f"✓ Broadcaster created: {broadcaster}")
        
        # Create UI updater
        ui_updater = RealtimeUIUpdater(broadcaster)
        print(f"✓ UI updater created with {len(ui_updater.event_handlers)} handlers")
        
        # List available handlers
        print("\nAvailable event handlers:")
        for event_type, handler in ui_updater.event_handlers.items():
            print(f"  - {event_type}: {handler.__name__}")
        
        return True
        
    except Exception as e:
        print(f"✗ UI broadcaster test failed: {e}")
        logger.exception("Broadcaster error")
        return False

async def test_agent_streaming():
    """Test agent with streaming capabilities"""
    print_section("3. Testing Agent Streaming")
    
    try:
        from agents.shadow import ShadowAgent
        from config import LLM_CONFIG
        
        print("✓ Successfully imported agent classes")
        
        # Create agent
        agent = ShadowAgent()
        print(f"✓ Created {agent.name} agent")
        
        # Check if LLM has streaming support
        if hasattr(agent.llm, 'generate_with_streaming'):
            print("✓ Agent LLM supports streaming")
        else:
            print("✗ Agent LLM does not support streaming!")
            return False
        
        # Test streaming callback tracking
        chunks_received = []
        
        def test_callback(chunk: str):
            chunks_received.append(chunk)
            print(f"  Received chunk: '{chunk}'")
        
        # Test simple streaming
        print("\nTesting streaming generation:")
        try:
            response = agent.llm.generate_with_streaming(
                "Say 'Hello World' in exactly 5 words.",
                stream_callback=test_callback
            )
            print(f"\nFull response: '{response}'")
            print(f"Chunks received: {len(chunks_received)}")
            
            if chunks_received:
                print("✓ Streaming callback working!")
            else:
                print("✗ No chunks received via callback")
                
        except Exception as e:
            print(f"✗ Streaming test failed: {e}")
            return False
        
        return True
        
    except Exception as e:
        print(f"✗ Agent streaming test failed: {e}")
        logger.exception("Agent streaming error")
        return False

async def test_llm_connection():
    """Test LLM connection and availability"""
    print_section("4. Testing LLM Connection")
    
    try:
        from llm.wrapper import CustomLLM
        from config import LLM_CONFIG
        import requests
        
        config = LLM_CONFIG.get('default', {})
        api_url = config.get('api_url', 'http://localhost:1234/v1/completions')
        
        # Extract base URL
        base_url = api_url.replace('/v1/completions', '').replace('/v1/chat/completions', '')
        
        print(f"Testing connection to: {base_url}")
        
        # Test basic connectivity
        try:
            response = requests.get(f"{base_url}/v1/models", timeout=5)
            if response.status_code == 200:
                print("✓ LLM API is reachable")
                models = response.json()
                print(f"  Available models: {models}")
            else:
                print(f"✗ LLM API returned status: {response.status_code}")
                return False
        except requests.exceptions.RequestException as e:
            print(f"✗ Cannot connect to LLM API: {e}")
            print("\n⚠️  Make sure LM Studio or LiteLLM is running!")
            return False
        
        # Test actual LLM call
        print("\nTesting LLM generation:")
        llm = CustomLLM(**config)
        
        try:
            response = llm._call("Say 'test' and nothing else.")
            print(f"✓ LLM response: '{response}'")
            return True
        except Exception as e:
            print(f"✗ LLM generation failed: {e}")
            return False
            
    except Exception as e:
        print(f"✗ LLM connection test failed: {e}")
        logger.exception("LLM connection error")
        return False

async def test_nicegui_running():
    """Check if NiceGUI application is running"""
    print_section("5. Testing NiceGUI Application")
    
    try:
        import requests
        
        # Common NiceGUI ports
        ports = [8080, 3000, 5000, 8000]
        
        for port in ports:
            try:
                response = requests.get(f"http://localhost:{port}/", timeout=2)
                if response.status_code == 200:
                    print(f"✓ NiceGUI application found on port {port}")
                    return True
            except:
                continue
        
        print("✗ NiceGUI application not found on common ports")
        print("  Please ensure the application is running with: python psyche_simulation.py")
        return False
        
    except Exception as e:
        print(f"✗ NiceGUI check failed: {e}")
        return False

def check_process_running(process_name: str) -> bool:
    """Check if a process is running"""
    import subprocess
    try:
        result = subprocess.run(['pgrep', '-f', process_name], 
                               capture_output=True, text=True)
        return result.returncode == 0
    except:
        return False

async def test_kubernetes_deployment():
    """Test Kubernetes LiteLLM deployment"""
    print_section("6. Testing Kubernetes Deployment")
    
    try:
        import subprocess
        
        # Check if kubectl is available
        try:
            result = subprocess.run(['kubectl', 'version', '--client'], 
                                  capture_output=True, text=True)
            if result.returncode != 0:
                print("✗ kubectl not found or not configured")
                return False
        except:
            print("✗ kubectl not available")
            return False
        
        print("✓ kubectl is available")
        
        # Check LiteLLM deployment
        try:
            result = subprocess.run(
                ['kubectl', 'get', 'deployment', 'litellm', '-n', 'default', '-o', 'json'],
                capture_output=True, text=True
            )
            
            if result.returncode == 0:
                import json
                deployment = json.loads(result.stdout)
                replicas = deployment['status'].get('replicas', 0)
                ready_replicas = deployment['status'].get('readyReplicas', 0)
                
                print(f"✓ LiteLLM deployment found")
                print(f"  Replicas: {ready_replicas}/{replicas}")
                
                if ready_replicas > 0:
                    print("✓ LiteLLM pods are running")
                else:
                    print("✗ No LiteLLM pods are ready")
                    return False
                    
                # Check service
                result = subprocess.run(
                    ['kubectl', 'get', 'service', 'litellm', '-n', 'default'],
                    capture_output=True, text=True
                )
                
                if result.returncode == 0:
                    print("✓ LiteLLM service exists")
                    
                    # Check if we can reach it
                    result = subprocess.run(
                        ['kubectl', 'get', 'endpoints', 'litellm', '-n', 'default', '-o', 'json'],
                        capture_output=True, text=True
                    )
                    
                    if result.returncode == 0:
                        endpoints = json.loads(result.stdout)
                        if endpoints.get('subsets'):
                            print("✓ LiteLLM endpoints are available")
                            return True
                        else:
                            print("✗ No LiteLLM endpoints available")
                            return False
                else:
                    print("✗ LiteLLM service not found")
                    return False
                    
            else:
                print("✗ LiteLLM deployment not found in default namespace")
                print("  Make sure LiteLLM is deployed with: kubectl apply -f k8s/environments/litellm-deployment.yaml")
                return False
                
        except Exception as e:
            print(f"✗ Error checking Kubernetes resources: {e}")
            return False
            
    except Exception as e:
        print(f"✗ Kubernetes test failed: {e}")
        return False

async def run_all_diagnostics():
    """Run all diagnostic tests"""
    print("\n" + "="*60)
    print("   PSYCHE SIMULATION REAL-TIME DIAGNOSTICS")
    print("="*60)
    
    results = {}
    
    # Run tests
    results['websocket_events'] = await test_websocket_events()
    results['ui_broadcaster'] = await test_ui_broadcaster()
    results['agent_streaming'] = await test_agent_streaming()
    results['llm_connection'] = await test_llm_connection()
    results['nicegui_running'] = await test_nicegui_running()
    results['kubernetes'] = await test_kubernetes_deployment()
    
    # Summary
    print_section("DIAGNOSTIC SUMMARY")
    
    all_passed = True
    for test_name, passed in results.items():
        status = "✓ PASSED" if passed else "✗ FAILED"
        print(f"{test_name.replace('_', ' ').title()}: {status}")
        if not passed:
            all_passed = False
    
    print("\n" + "="*60)
    
    if all_passed:
        print("✅ ALL SYSTEMS OPERATIONAL - Real-time UI should be working!")
    else:
        print("⚠️  ISSUES DETECTED - Please fix the failed components above")
        print("\nCommon fixes:")
        print("1. If LLM connection failed: Start LM Studio or LiteLLM")
        print("2. If NiceGUI not running: Run 'python psyche_simulation.py'")
        print("3. If Kubernetes failed: Deploy LiteLLM with kubectl")
        print("4. If streaming failed: Check LLM configuration supports streaming")
    
    return all_passed

if __name__ == "__main__":
    asyncio.run(run_all_diagnostics())