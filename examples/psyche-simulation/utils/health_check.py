"""
Health check endpoints for Kubernetes probes
"""

import asyncio
import logging
import time
from typing import Dict, Any, Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
import redis
from data.redis_state_manager import RedisStateManager

logger = logging.getLogger(__name__)

class HealthChecker:
    """Health check service for monitoring application health"""
    
    def __init__(self, redis_manager: Optional[RedisStateManager] = None):
        self.redis_manager = redis_manager
        self.start_time = time.time()
        self.last_health_check = time.time()
        
    async def liveness_probe(self) -> Dict[str, Any]:
        """
        Kubernetes liveness probe - checks if the application is alive
        Returns 200 if the application is running, 500 otherwise
        """
        try:
            current_time = time.time()
            uptime = current_time - self.start_time
            
            status = {
                "status": "healthy",
                "timestamp": datetime.utcnow().isoformat(),
                "uptime_seconds": uptime,
                "service": "psyche-simulation",
                "version": "1.0.0"
            }
            
            self.last_health_check = current_time
            return status
            
        except Exception as e:
            logger.error(f"Liveness probe failed: {e}")
            raise HTTPException(status_code=500, detail=f"Liveness check failed: {str(e)}")
    
    async def readiness_probe(self) -> Dict[str, Any]:
        """
        Kubernetes readiness probe - checks if the application is ready to serve traffic
        Returns 200 if ready, 503 if not ready
        """
        try:
            current_time = time.time()
            checks = {}
            all_ready = True
            
            # Check Redis connectivity
            redis_status = await self._check_redis()
            checks["redis"] = redis_status
            if not redis_status["healthy"]:
                all_ready = False
            
            # Check memory usage (basic check)
            memory_status = await self._check_memory()
            checks["memory"] = memory_status
            if not memory_status["healthy"]:
                all_ready = False
            
            # Check disk space (basic check)
            disk_status = await self._check_disk()
            checks["disk"] = disk_status
            if not disk_status["healthy"]:
                all_ready = False
            
            status = {
                "status": "ready" if all_ready else "not_ready",
                "timestamp": datetime.utcnow().isoformat(),
                "checks": checks,
                "service": "psyche-simulation",
                "ready": all_ready
            }
            
            if not all_ready:
                raise HTTPException(status_code=503, detail="Service not ready")
            
            return status
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Readiness probe failed: {e}")
            raise HTTPException(status_code=503, detail=f"Readiness check failed: {str(e)}")
    
    async def health_check(self) -> Dict[str, Any]:
        """
        Comprehensive health check endpoint
        Returns detailed health information
        """
        try:
            current_time = time.time()
            uptime = current_time - self.start_time
            
            # Run all health checks
            redis_status = await self._check_redis()
            memory_status = await self._check_memory()
            disk_status = await self._check_disk()
            
            # Calculate overall health
            healthy_checks = sum([
                redis_status["healthy"],
                memory_status["healthy"],
                disk_status["healthy"]
            ])
            total_checks = 3
            health_percentage = (healthy_checks / total_checks) * 100
            
            status = {
                "status": "healthy" if healthy_checks == total_checks else "degraded",
                "timestamp": datetime.utcnow().isoformat(),
                "uptime_seconds": uptime,
                "health_percentage": health_percentage,
                "service": "psyche-simulation",
                "version": "1.0.0",
                "checks": {
                    "redis": redis_status,
                    "memory": memory_status,
                    "disk": disk_status
                },
                "metadata": {
                    "start_time": datetime.fromtimestamp(self.start_time).isoformat(),
                    "last_check": datetime.fromtimestamp(self.last_health_check).isoformat()
                }
            }
            
            return status
            
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return {
                "status": "unhealthy",
                "timestamp": datetime.utcnow().isoformat(),
                "error": str(e),
                "service": "psyche-simulation"
            }
    
    async def _check_redis(self) -> Dict[str, Any]:
        """Check Redis connectivity and performance"""
        try:
            if not self.redis_manager:
                return {
                    "healthy": False,
                    "status": "not_configured",
                    "message": "Redis manager not configured"
                }
            
            start_time = time.time()
            
            # Test Redis connection
            if not self.redis_manager.is_connected():
                return {
                    "healthy": False,
                    "status": "disconnected",
                    "message": "Redis connection failed"
                }
            
            # Test Redis operations
            test_key = "health_check_test"
            test_value = f"test_{int(time.time())}"
            
            # Set and get test
            await asyncio.to_thread(self.redis_manager.set_value, test_key, test_value, ttl=60)
            retrieved_value = await asyncio.to_thread(self.redis_manager.get_value, test_key)
            
            if retrieved_value != test_value:
                return {
                    "healthy": False,
                    "status": "operation_failed",
                    "message": "Redis set/get operation failed"
                }
            
            # Clean up
            await asyncio.to_thread(self.redis_manager.delete_key, test_key)
            
            response_time = (time.time() - start_time) * 1000  # Convert to milliseconds
            
            return {
                "healthy": True,
                "status": "connected",
                "response_time_ms": round(response_time, 2),
                "message": "Redis is healthy"
            }
            
        except Exception as e:
            logger.error(f"Redis health check failed: {e}")
            return {
                "healthy": False,
                "status": "error",
                "message": f"Redis check error: {str(e)}"
            }
    
    async def _check_memory(self) -> Dict[str, Any]:
        """Check memory usage"""
        try:
            import psutil
            
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            
            # Consider healthy if memory usage is below 80%
            healthy = memory_percent < 80
            
            return {
                "healthy": healthy,
                "status": "normal" if healthy else "high_usage",
                "usage_percent": memory_percent,
                "available_gb": round(memory.available / (1024**3), 2),
                "total_gb": round(memory.total / (1024**3), 2),
                "message": f"Memory usage: {memory_percent}%"
            }
            
        except ImportError:
            return {
                "healthy": True,
                "status": "unavailable",
                "message": "psutil not available for memory monitoring"
            }
        except Exception as e:
            logger.error(f"Memory health check failed: {e}")
            return {
                "healthy": False,
                "status": "error",
                "message": f"Memory check error: {str(e)}"
            }
    
    async def _check_disk(self) -> Dict[str, Any]:
        """Check disk space"""
        try:
            import psutil
            
            disk = psutil.disk_usage('/')
            disk_percent = (disk.used / disk.total) * 100
            
            # Consider healthy if disk usage is below 85%
            healthy = disk_percent < 85
            
            return {
                "healthy": healthy,
                "status": "normal" if healthy else "high_usage",
                "usage_percent": round(disk_percent, 2),
                "free_gb": round(disk.free / (1024**3), 2),
                "total_gb": round(disk.total / (1024**3), 2),
                "message": f"Disk usage: {disk_percent:.1f}%"
            }
            
        except ImportError:
            return {
                "healthy": True,
                "status": "unavailable",
                "message": "psutil not available for disk monitoring"
            }
        except Exception as e:
            logger.error(f"Disk health check failed: {e}")
            return {
                "healthy": False,
                "status": "error",
                "message": f"Disk check error: {str(e)}"
            }


def setup_health_endpoints(app: FastAPI, redis_manager: Optional[RedisStateManager] = None):
    """Setup health check endpoints on FastAPI app"""
    
    health_checker = HealthChecker(redis_manager)
    
    @app.get("/health")
    async def health():
        """Comprehensive health check endpoint"""
        result = await health_checker.health_check()
        status_code = 200 if result.get("status") in ["healthy", "degraded"] else 500
        return JSONResponse(content=result, status_code=status_code)
    
    @app.get("/health/live")
    async def liveness():
        """Kubernetes liveness probe endpoint"""
        result = await health_checker.liveness_probe()
        return JSONResponse(content=result, status_code=200)
    
    @app.get("/health/ready")
    async def readiness():
        """Kubernetes readiness probe endpoint"""
        result = await health_checker.readiness_probe()
        return JSONResponse(content=result, status_code=200)
    
    @app.get("/metrics")
    async def metrics():
        """Basic metrics endpoint for monitoring"""
        health_result = await health_checker.health_check()
        
        # Convert to Prometheus-style metrics
        metrics_lines = []
        
        # Service uptime
        uptime = health_result.get("uptime_seconds", 0)
        metrics_lines.append(f"psyche_simulation_uptime_seconds {uptime}")
        
        # Health percentage
        health_pct = health_result.get("health_percentage", 0)
        metrics_lines.append(f"psyche_simulation_health_percentage {health_pct}")
        
        # Redis status
        redis_check = health_result.get("checks", {}).get("redis", {})
        redis_healthy = 1 if redis_check.get("healthy", False) else 0
        metrics_lines.append(f"psyche_simulation_redis_healthy {redis_healthy}")
        
        if "response_time_ms" in redis_check:
            metrics_lines.append(f"psyche_simulation_redis_response_time_ms {redis_check['response_time_ms']}")
        
        # Memory metrics
        memory_check = health_result.get("checks", {}).get("memory", {})
        if "usage_percent" in memory_check:
            metrics_lines.append(f"psyche_simulation_memory_usage_percent {memory_check['usage_percent']}")
        
        # Disk metrics
        disk_check = health_result.get("checks", {}).get("disk", {})
        if "usage_percent" in disk_check:
            metrics_lines.append(f"psyche_simulation_disk_usage_percent {disk_check['usage_percent']}")
        
        metrics_content = "\n".join(metrics_lines)
        return JSONResponse(
            content={"metrics": metrics_content},
            media_type="text/plain"
        )