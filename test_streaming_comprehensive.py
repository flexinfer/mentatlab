#!/usr/bin/env python3
"""
Comprehensive test script for MentatLab streaming functionality.
Run from project root: python test_streaming_comprehensive.py
"""

import asyncio
import subprocess
import time
import json
import os
import sys
from datetime import datetime

# Color codes for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

class StreamingTestRunner:
    def __init__(self):
        self.test_results = []
        self.gateway_process = None
        self.frontend_process = None
        
    def log(self, message, color=RESET):
        print(f"{color}{message}{RESET}")
        
    def log_test(self, test_name, passed, details=""):
        status = f"{GREEN}✓ PASSED{RESET}" if passed else f"{RED}✗ FAILED{RESET}"
        self.log(f"\n[TEST] {test_name}: {status}")
        if details:
            self.log(f"  Details: {details}", YELLOW if not passed else RESET)
        self.test_results.append({"test": test_name, "passed": passed, "details": details})
    
    async def check_service_health(self, service_name, url, expected_status=200):
        """Check if a service is healthy"""
        import aiohttp
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    success = resp.status == expected_status
                    data = await resp.text()
                    self.log_test(
                        f"{service_name} Health Check",
                        success,
                        f"Status: {resp.status}, Response: {data[:100]}..."
                    )
                    return success
        except Exception as e:
            self.log_test(f"{service_name} Health Check", False, str(e))
            return False
    
    async def test_websocket_connection(self):
        """Test WebSocket connection to streaming endpoint"""
        import websockets
        try:
            stream_id = f"test-stream-{int(datetime.now().timestamp())}"
            uri = f"ws://localhost:8000/ws/streams/{stream_id}"
            
            async with websockets.connect(uri) as websocket:
                # Send ping
                await websocket.send(json.dumps({"type": "ping"}))
                
                # Wait for response
                response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                
                self.log_test(
                    "WebSocket Connection Test",
                    True,
                    f"Connected to {uri} and received response"
                )
                return True
                
        except Exception as e:
            self.log_test("WebSocket Connection Test", False, str(e))
            return False
    
    async def test_streaming_api_endpoints(self):
        """Test REST API endpoints for streaming"""
        import aiohttp
        results = []
        
        async with aiohttp.ClientSession() as session:
            # Test GET /api/v1/streams
            try:
                async with session.get("http://localhost:8000/api/v1/streams") as resp:
                    success = resp.status == 200
                    data = await resp.json()
                    self.log_test(
                        "GET /api/v1/streams",
                        success,
                        f"Found {len(data.get('streams', []))} active streams"
                    )
                    results.append(success)
            except Exception as e:
                self.log_test("GET /api/v1/streams", False, str(e))
                results.append(False)
            
            # Test POST /api/v1/streams/init
            try:
                payload = {"agent_id": "test-agent", "pin_name": "output"}
                async with session.post(
                    "http://localhost:8000/api/v1/streams/init",
                    json=payload
                ) as resp:
                    success = resp.status in [200, 201]
                    if success:
                        data = await resp.json()
                        stream_id = data.get("stream_id")
                        self.log_test(
                            "POST /api/v1/streams/init",
                            success,
                            f"Created stream: {stream_id}"
                        )
                        
                        # Test GET specific stream
                        if stream_id:
                            async with session.get(
                                f"http://localhost:8000/api/v1/streams/{stream_id}"
                            ) as resp2:
                                success2 = resp2.status == 200
                                self.log_test(
                                    f"GET /api/v1/streams/{stream_id}",
                                    success2
                                )
                                results.append(success2)
                    else:
                        self.log_test("POST /api/v1/streams/init", False, f"Status: {resp.status}")
                    results.append(success)
            except Exception as e:
                self.log_test("POST /api/v1/streams/init", False, str(e))
                results.append(False)
        
        return all(results)
    
    async def test_frontend_components(self):
        """Test frontend component loading"""
        import aiohttp
        try:
            async with aiohttp.ClientSession() as session:
                # Test main app
                async with session.get("http://localhost:5173") as resp:
                    main_ok = resp.status == 200
                    self.log_test("Frontend Main App", main_ok)
                    
                # Can't directly test SPA routes, but we can check if assets load
                return main_ok
        except Exception as e:
            self.log_test("Frontend Components", False, str(e))
            return False
    
    def start_services(self):
        """Start required services"""
        self.log("\n=== Starting Services ===", BLUE)
        
        # Check Redis
        try:
            result = subprocess.run(["redis-cli", "ping"], capture_output=True, text=True)
            if result.stdout.strip() == "PONG":
                self.log("✓ Redis is running", GREEN)
            else:
                self.log("✗ Redis is not running - please start Redis", RED)
                return False
        except:
            self.log("✗ Redis is not installed or not running", RED)
            return False
        
        # Start Gateway
        self.log("Starting Gateway service...")
        gateway_cmd = ["pdm", "run", "uvicorn", "app.main:app", "--reload", "--port", "8000"]
        self.gateway_process = subprocess.Popen(
            gateway_cmd,
            cwd="services/gateway",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        # Start Frontend
        self.log("Starting Frontend service...")
        frontend_cmd = ["npm", "run", "dev"]
        self.frontend_process = subprocess.Popen(
            frontend_cmd,
            cwd="services/frontend",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        # Wait for services to start
        self.log("Waiting for services to start...")
        time.sleep(10)
        
        return True
    
    def stop_services(self):
        """Stop all services"""
        self.log("\n=== Stopping Services ===", BLUE)
        
        if self.gateway_process:
            self.gateway_process.terminate()
            self.gateway_process.wait()
            self.log("Gateway service stopped")
            
        if self.frontend_process:
            self.frontend_process.terminate()
            self.frontend_process.wait()
            self.log("Frontend service stopped")
    
    async def run_all_tests(self):
        """Run all tests"""
        self.log("\n=== MentatLab Streaming Functionality Test Suite ===", BLUE)
        
        # Start services
        if not self.start_services():
            self.log("Failed to start services", RED)
            return
        
        try:
            # Run tests
            self.log("\n=== Running Tests ===", BLUE)
            
            # 1. Backend Service Tests
            await self.check_service_health("Gateway", "http://localhost:8000/healthz")
            
            # 2. Frontend Tests
            await self.test_frontend_components()
            
            # 3. Streaming API Tests
            await self.test_streaming_api_endpoints()
            
            # 4. WebSocket Tests
            await self.test_websocket_connection()
            
            # Generate report
            self.generate_report()
            
        finally:
            # Stop services
            self.stop_services()
    
    def generate_report(self):
        """Generate test report"""
        self.log("\n=== Test Report ===", BLUE)
        
        total_tests = len(self.test_results)
        passed_tests = sum(1 for test in self.test_results if test["passed"])
        failed_tests = total_tests - passed_tests
        
        self.log(f"\nTotal Tests: {total_tests}")
        self.log(f"Passed: {passed_tests}", GREEN)
        self.log(f"Failed: {failed_tests}", RED if failed_tests > 0 else GREEN)
        
        if failed_tests > 0:
            self.log("\nFailed Tests:", RED)
            for test in self.test_results:
                if not test["passed"]:
                    self.log(f"  - {test['test']}: {test['details']}")
        
        # Save detailed report
        with open("streaming_test_report.json", "w") as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "summary": {
                    "total": total_tests,
                    "passed": passed_tests,
                    "failed": failed_tests
                },
                "results": self.test_results
            }, f, indent=2)
        
        self.log("\nDetailed report saved to: streaming_test_report.json")

async def main():
    """Main entry point"""
    runner = StreamingTestRunner()
    
    # Check if we're in the right directory
    if not os.path.exists("services/gateway") or not os.path.exists("services/frontend"):
        print(f"{RED}Error: Please run this script from the project root directory{RESET}")
        print(f"Current directory: {os.getcwd()}")
        sys.exit(1)
    
    # Check for required dependencies
    try:
        import aiohttp
        import websockets
    except ImportError as e:
        print(f"{RED}Missing dependency: {e}{RESET}")
        print(f"Please install: pip install aiohttp websockets")
        sys.exit(1)
    
    await runner.run_all_tests()

if __name__ == "__main__":
    asyncio.run(main())