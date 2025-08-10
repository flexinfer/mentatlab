"""
Enhanced Performance Monitoring System for Psyche Simulation

This module provides comprehensive performance metrics collection, storage, and broadcasting
capabilities for the Psyche simulation system. It integrates with Redis for historical data
storage and WebSocket events for real-time updates.

Key Features:
- Thread-safe metric collection
- Real-time and aggregated metrics
- Redis integration for historical data
- WebSocket broadcasting of performance updates
- Minimal performance overhead
- JSON export capabilities
"""

import time
import threading
import json
import logging
import psutil
import queue
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Callable, Tuple
from collections import defaultdict, deque
from dataclasses import dataclass, asdict
from enum import Enum
import asyncio
from concurrent.futures import ThreadPoolExecutor
import numpy as np

# Import integration modules
try:
    from utils.websocket_events import WebSocketEventManager, EventType, get_event_manager
except ImportError:
    WebSocketEventManager = None
    get_event_manager = None

try:
    from data.redis_state_manager import RedisStateManager
except ImportError:
    RedisStateManager = None

logger = logging.getLogger(__name__)


class MetricType(Enum):
    """Types of metrics collected by the system"""
    RESPONSE_TIME = "response_time"
    THROUGHPUT = "throughput"
    MEMORY_USAGE = "memory_usage"
    THREAD_POOL = "thread_pool"
    LLM_API = "llm_api"
    WEBSOCKET = "websocket"
    QUEUE_DEPTH = "queue_depth"
    DB_POOL = "db_pool"
    ERROR_RATE = "error_rate"
    SYSTEM_RESOURCES = "system_resources"
    AGENT_PERFORMANCE = "agent_performance"


@dataclass
class Metric:
    """Individual metric data point"""
    timestamp: float
    name: str
    value: float
    unit: str
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}

    def to_dict(self) -> Dict[str, Any]:
        """Convert metric to dictionary"""
        data = asdict(self)
        data['timestamp_iso'] = datetime.fromtimestamp(self.timestamp).isoformat()
        return data


@dataclass
class AggregatedMetric:
    """Aggregated metric statistics"""
    name: str
    count: int
    sum: float
    min: float
    max: float
    avg: float
    p50: float
    p95: float
    p99: float
    unit: str
    window_start: float
    window_end: float

    def to_dict(self) -> Dict[str, Any]:
        """Convert aggregated metric to dictionary"""
        data = asdict(self)
        data['window_start_iso'] = datetime.fromtimestamp(self.window_start).isoformat()
        data['window_end_iso'] = datetime.fromtimestamp(self.window_end).isoformat()
        return data


class MetricCollector:
    """Thread-safe metric collector with bounded memory usage"""
    
    def __init__(self, max_size: int = 10000):
        self.max_size = max_size
        self.metrics: Dict[str, deque] = defaultdict(lambda: deque(maxlen=max_size))
        self.lock = threading.RLock()
        
    def add_metric(self, metric: Metric):
        """Add a metric to the collection"""
        with self.lock:
            self.metrics[metric.name].append(metric)
    
    def get_metrics(self, name: str, start_time: Optional[float] = None, 
                    end_time: Optional[float] = None) -> List[Metric]:
        """Get metrics by name, optionally filtered by time range"""
        with self.lock:
            metrics = list(self.metrics.get(name, []))
            if start_time or end_time:
                start_time = start_time or 0
                end_time = end_time or float('inf')
                metrics = [m for m in metrics if start_time <= m.timestamp <= end_time]
            return metrics
    
    def get_all_metrics(self) -> Dict[str, List[Metric]]:
        """Get all metrics"""
        with self.lock:
            return {name: list(metrics) for name, metrics in self.metrics.items()}
    
    def clear_old_metrics(self, retention_seconds: int):
        """Remove metrics older than retention period"""
        cutoff_time = time.time() - retention_seconds
        with self.lock:
            for name in list(self.metrics.keys()):
                self.metrics[name] = deque(
                    (m for m in self.metrics[name] if m.timestamp >= cutoff_time),
                    maxlen=self.max_size
                )
    
    def aggregate_metrics(self, name: str, window_seconds: int = 60) -> Optional[AggregatedMetric]:
        """Calculate aggregated statistics for a metric"""
        window_end = time.time()
        window_start = window_end - window_seconds
        
        metrics = self.get_metrics(name, start_time=window_start, end_time=window_end)
        if not metrics:
            return None
        
        values = [m.value for m in metrics]
        
        # Calculate percentiles
        p50 = np.percentile(values, 50) if len(values) > 0 else 0
        p95 = np.percentile(values, 95) if len(values) > 0 else 0
        p99 = np.percentile(values, 99) if len(values) > 0 else 0
        
        return AggregatedMetric(
            name=name,
            count=len(values),
            sum=sum(values),
            min=min(values),
            max=max(values),
            avg=sum(values) / len(values),
            p50=p50,
            p95=p95,
            p99=p99,
            unit=metrics[0].unit if metrics else "",
            window_start=window_start,
            window_end=window_end
        )


class PerformanceMonitor:
    """
    Enhanced Performance Monitoring System
    
    Provides comprehensive metrics collection, aggregation, and broadcasting
    for the Psyche simulation system.
    """
    
    def __init__(
        self,
        redis_manager: Optional[RedisStateManager] = None,
        websocket_manager: Optional[WebSocketEventManager] = None,
        retention_seconds: int = 3600,  # 1 hour default retention
        broadcast_interval: float = 1.0,  # Broadcast updates every second
        aggregation_window: int = 60,  # 1 minute aggregation window
        enable_system_metrics: bool = True,
        max_metrics_per_type: int = 10000
    ):
        self.redis_manager = redis_manager
        self.websocket_manager = websocket_manager or (get_event_manager() if get_event_manager else None)
        self.retention_seconds = retention_seconds
        self.broadcast_interval = broadcast_interval
        self.aggregation_window = aggregation_window
        self.enable_system_metrics = enable_system_metrics
        
        # Metric collectors
        self.collector = MetricCollector(max_size=max_metrics_per_type)
        self.aggregation_lock = threading.RLock()
        
        # Response time tracking
        self.active_timers: Dict[str, Dict[str, Any]] = {}
        self.timer_lock = threading.RLock()
        
        # Throughput tracking
        self.throughput_counters: Dict[str, int] = defaultdict(int)
        self.throughput_window_start = time.time()
        self.throughput_lock = threading.RLock()
        
        # WebSocket connection tracking
        self.websocket_connections: Dict[str, Dict[str, Any]] = {}
        self.websocket_lock = threading.RLock()
        
        # Queue depth tracking
        self.queue_depths: Dict[str, int] = {}
        self.queue_lock = threading.RLock()
        
        # Database pool tracking
        self.db_pool_stats: Dict[str, Dict[str, Any]] = {}
        self.db_pool_lock = threading.RLock()
        
        # Thread pool for background tasks
        self.executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="perf_monitor")
        
        # Update throttling
        self.last_broadcast_time = 0
        self.update_queue = queue.Queue(maxsize=1000)
        self.chart_update_throttle: Dict[str, float] = {}
        self.throttle_interval = 0.1  # 100ms minimum between updates
        
        # Start background tasks
        self._running = True
        self._start_background_tasks()
        
        logger.info("Enhanced performance monitor initialized")
    
    def _start_background_tasks(self):
        """Start background monitoring tasks"""
        self.executor.submit(self._broadcast_loop)
        self.executor.submit(self._cleanup_loop)
        self.executor.submit(self._aggregation_loop)
        if self.enable_system_metrics:
            self.executor.submit(self._system_metrics_loop)
    
    def _broadcast_loop(self):
        """Background task to broadcast performance updates"""
        while self._running:
            try:
                current_time = time.time()
                if current_time - self.last_broadcast_time >= self.broadcast_interval:
                    self._broadcast_metrics()
                    self.last_broadcast_time = current_time
                time.sleep(0.1)
            except Exception as e:
                logger.error(f"Error in broadcast loop: {e}")
    
    def _cleanup_loop(self):
        """Background task to clean up old metrics"""
        while self._running:
            try:
                self.collector.clear_old_metrics(self.retention_seconds)
                if self.redis_manager:
                    self._cleanup_redis_metrics()
                time.sleep(60)  # Clean up every minute
            except Exception as e:
                logger.error(f"Error in cleanup loop: {e}")
    
    def _aggregation_loop(self):
        """Background task to calculate and store aggregated metrics"""
        while self._running:
            try:
                self._calculate_aggregations()
                time.sleep(30)  # Aggregate every 30 seconds
            except Exception as e:
                logger.error(f"Error in aggregation loop: {e}")
    
    def _system_metrics_loop(self):
        """Background task to collect system metrics"""
        while self._running:
            try:
                self._collect_system_metrics()
                time.sleep(5)  # Collect every 5 seconds
            except Exception as e:
                logger.error(f"Error collecting system metrics: {e}")
    
    def _collect_system_metrics(self):
        """Collect system-wide performance metrics"""
        try:
            # CPU usage
            cpu_percent = psutil.cpu_percent(interval=0.1)
            self.record_metric("system.cpu_usage", cpu_percent, "percent")
            
            # Memory usage
            memory = psutil.virtual_memory()
            self.record_metric("system.memory_used", memory.used / (1024**3), "GB")
            self.record_metric("system.memory_percent", memory.percent, "percent")
            self.record_metric("system.memory_available", memory.available / (1024**3), "GB")
            
            # Process-specific metrics
            process = psutil.Process()
            process_info = process.memory_info()
            self.record_metric("process.memory_rss", process_info.rss / (1024**2), "MB")
            self.record_metric("process.memory_vms", process_info.vms / (1024**2), "MB")
            self.record_metric("process.num_threads", process.num_threads(), "count")
            self.record_metric("process.cpu_percent", process.cpu_percent(), "percent")
            
            # Disk I/O
            if hasattr(psutil, 'disk_io_counters'):
                disk_io = psutil.disk_io_counters()
                if disk_io:
                    self.record_metric("system.disk_read_bytes", disk_io.read_bytes, "bytes")
                    self.record_metric("system.disk_write_bytes", disk_io.write_bytes, "bytes")
            
            # Network I/O
            net_io = psutil.net_io_counters()
            self.record_metric("system.net_bytes_sent", net_io.bytes_sent, "bytes")
            self.record_metric("system.net_bytes_recv", net_io.bytes_recv, "bytes")
            
        except Exception as e:
            logger.error(f"Error collecting system metrics: {e}")
    
    # Core metric recording method
    
    def record_metric(self, name: str, value: float, unit: str, metadata: Optional[Dict[str, Any]] = None):
        """Record a metric with minimal overhead"""
        try:
            metric = Metric(
                timestamp=time.time(),
                name=name,
                value=value,
                unit=unit,
                metadata=metadata or {}
            )
            self.collector.add_metric(metric)
            
            # Store in Redis if available
            if self.redis_manager and name in ["system.cpu_usage", "system.memory_percent", "llm.response_time"]:
                self._store_metric_in_redis(metric)
                
        except Exception as e:
            logger.error(f"Error recording metric {name}: {e}")
    
    # Response Time Tracking
    
    def start_timer(self, operation: str, metadata: Optional[Dict[str, Any]] = None) -> str:
        """Start a timer for an operation"""
        timer_id = f"{operation}_{time.time_ns()}"
        with self.timer_lock:
            self.active_timers[timer_id] = {
                'start_time': time.time(),
                'operation': operation,
                'metadata': metadata or {}
            }
        return timer_id
    
    def end_timer(self, timer_id: str, success: bool = True):
        """End a timer and record the response time"""
        with self.timer_lock:
            timer_data = self.active_timers.pop(timer_id, None)
        
        if timer_data:
            elapsed = (time.time() - timer_data['start_time']) * 1000  # Convert to milliseconds
            operation = timer_data['operation']
            metadata = timer_data['metadata']
            metadata['success'] = success
            
            self.record_metric(
                f"response_time.{operation}",
                elapsed,
                "ms",
                metadata
            )
            
            # Track success rate
            self.record_metric(
                f"success_rate.{operation}",
                1 if success else 0,
                "ratio",
                metadata
            )
    
    # Throughput Tracking
    
    def increment_throughput(self, operation: str, count: int = 1):
        """Increment throughput counter"""
        with self.throughput_lock:
            self.throughput_counters[operation] += count
            
            # Check if we need to record throughput
            current_time = time.time()
            if current_time - self.throughput_window_start >= 1.0:  # Record every second
                self._record_throughput()
                self.throughput_window_start = current_time
    
    def _record_throughput(self):
        """Record throughput metrics"""
        with self.throughput_lock:
            for operation, count in self.throughput_counters.items():
                self.record_metric(
                    f"throughput.{operation}",
                    count,
                    "ops/sec"
                )
            self.throughput_counters.clear()
    
    # Memory Usage Monitoring
    
    def track_memory_usage(self, component: str, include_tracemalloc: bool = False):
        """Track memory usage for a specific component"""
        try:
            # Get process memory
            process = psutil.Process()
            memory_info = process.memory_info()
            
            self.record_metric(f"memory.{component}.rss", memory_info.rss / (1024**2), "MB")
            self.record_metric(f"memory.{component}.vms", memory_info.vms / (1024**2), "MB")
            
            # Track Python memory allocation if requested
            if include_tracemalloc:
                import tracemalloc
                if not tracemalloc.is_tracing():
                    tracemalloc.start()
                
                current, peak = tracemalloc.get_traced_memory()
                self.record_metric(f"memory.{component}.current_traced", current / (1024**2), "MB")
                self.record_metric(f"memory.{component}.peak_traced", peak / (1024**2), "MB")
                
        except Exception as e:
            logger.error(f"Error tracking memory usage for {component}: {e}")
    
    # Thread Pool Monitoring
    
    def track_thread_pool(self, pool_name: str, active: int, total: int):
        """Track thread pool utilization"""
        utilization = (active / total * 100) if total > 0 else 0
        self.record_metric(f"thread_pool.{pool_name}.active", active, "count")
        self.record_metric(f"thread_pool.{pool_name}.total", total, "count")
        self.record_metric(f"thread_pool.{pool_name}.utilization", utilization, "percent")
    
    # LLM API Monitoring
    
    def track_llm_call(
        self,
        model: str,
        latency: float,
        success: bool,
        tokens_used: Optional[int] = None,
        error: Optional[str] = None
    ):
        """Track LLM API call performance"""
        self.record_metric(f"llm.{model}.latency", latency, "ms")
        self.record_metric(f"llm.{model}.success_rate", 1 if success else 0, "ratio")
        
        if tokens_used:
            self.record_metric(f"llm.{model}.tokens", tokens_used, "count")
        
        if error:
            self.record_metric(f"llm.{model}.errors", 1, "count", {"error": error})
    
    # WebSocket Monitoring
    
    def track_websocket_metrics(
        self,
        active_connections: int,
        messages_sent: int,
        messages_received: int,
        message_throughput: float = 0.0
    ):
        """Track WebSocket connection metrics"""
        self.record_metric("websocket.active_connections", active_connections, "count")
        self.record_metric("websocket.messages_sent", messages_sent, "count")
        self.record_metric("websocket.messages_received", messages_received, "count")
        self.record_metric("websocket.message_throughput", message_throughput, "msgs/sec")
    
    def add_websocket_connection(self, connection_id: str, metadata: Optional[Dict[str, Any]] = None):
        """Track a new WebSocket connection"""
        with self.websocket_lock:
            self.websocket_connections[connection_id] = {
                'connected_at': time.time(),
                'messages_sent': 0,
                'messages_received': 0,
                'metadata': metadata or {}
            }
    
    def remove_websocket_connection(self, connection_id: str):
        """Remove a WebSocket connection"""
        with self.websocket_lock:
            if connection_id in self.websocket_connections:
                connection_data = self.websocket_connections.pop(connection_id)
                duration = time.time() - connection_data['connected_at']
                self.record_metric("websocket.connection_duration", duration, "seconds")

    # Queue Depth Monitoring

    def track_queue_depth(self, queue_name: str, depth: int):
        """Track queue depth for message and update queues"""
        with self.queue_lock:
            self.queue_depths[queue_name] = depth
            self.record_metric(f"queue.{queue_name}.depth", depth, "count")

    # Database Pool Monitoring

    def track_db_pool_stats(self, pool_name: str, active: int, total: int, idle: int):
        """Track database connection pool metrics"""
        with self.db_pool_lock:
            utilization = (active / total * 100) if total > 0 else 0
            self.db_pool_stats[pool_name] = {
                'active': active,
                'total': total,
                'idle': idle,
                'utilization': utilization
            }
            
            self.record_metric(f"db_pool.{pool_name}.active", active, "count")
            self.record_metric(f"db_pool.{pool_name}.total", total, "count")
            self.record_metric(f"db_pool.{pool_name}.idle", idle, "count")
            self.record_metric(f"db_pool.{pool_name}.utilization", utilization, "percent")

    # WebSocket Integration

    def _broadcast_metrics(self):
        """Broadcast performance metrics via WebSocket"""
        if not self.websocket_manager:
            return

        try:
            # Get current performance snapshot
            snapshot = self.get_performance_snapshot()
            
            # Create system status event
            if self.websocket_manager:
                from utils.websocket_events import broadcast_system_status
                broadcast_system_status(
                    is_running=True,
                    performance_data=snapshot,
                    active_agents=snapshot.get('active_agents', [])
                )
        except Exception as e:
            logger.error(f"Error broadcasting metrics: {e}")

    # Redis Integration

    def _store_metric_in_redis(self, metric: Metric):
        """Store metric in Redis for historical data"""
        if not self.redis_manager:
            return

        try:
            key = f"metrics:{metric.name}"
            data = metric.to_dict()
            
            # Use Redis to store with TTL
            self.redis_manager.store_agent_state(
                f"metric_{metric.name}",
                data,
                ttl=self.retention_seconds
            )
        except Exception as e:
            logger.error(f"Error storing metric in Redis: {e}")

    def _cleanup_redis_metrics(self):
        """Clean up old metrics from Redis"""
        # This would implement Redis cleanup logic
        pass

    # Aggregation and Analysis

    def _calculate_aggregations(self):
        """Calculate and store aggregated metrics"""
        with self.aggregation_lock:
            try:
                # Get all metric names
                all_metrics = self.collector.get_all_metrics()
                
                for name in all_metrics.keys():
                    # Calculate aggregations for each metric
                    aggregated = self.collector.aggregate_metrics(name, self.aggregation_window)
                    if aggregated and self.redis_manager:
                        # Store aggregated metrics in Redis
                        self.redis_manager.store_agent_state(
                            f"aggregated_{name}",
                            aggregated.to_dict(),
                            ttl=self.retention_seconds * 2  # Keep aggregated data longer
                        )
            except Exception as e:
                logger.error(f"Error calculating aggregations: {e}")

    # Chart Update Throttling

    def should_update_chart(self, chart_id: str) -> bool:
        """Check if chart should be updated based on throttling"""
        current_time = time.time()
        last_update = self.chart_update_throttle.get(chart_id, 0)
        
        if current_time - last_update >= self.throttle_interval:
            self.chart_update_throttle[chart_id] = current_time
            return True
        return False

    # JSON Export

    def export_metrics_json(self, start_time: Optional[float] = None, 
                          end_time: Optional[float] = None) -> str:
        """Export metrics as JSON"""
        try:
            all_metrics = self.collector.get_all_metrics()
            export_data = {
                'timestamp': time.time(),
                'start_time': start_time,
                'end_time': end_time,
                'metrics': {}
            }
            
            for name, metrics in all_metrics.items():
                filtered_metrics = metrics
                if start_time or end_time:
                    start_time = start_time or 0
                    end_time = end_time or float('inf')
                    filtered_metrics = [
                        m for m in metrics 
                        if start_time <= m.timestamp <= end_time
                    ]
                
                export_data['metrics'][name] = [m.to_dict() for m in filtered_metrics]
            
            return json.dumps(export_data, indent=2)
        except Exception as e:
            logger.error(f"Error exporting metrics: {e}")
            return "{}"

    def get_performance_snapshot(self) -> Dict[str, Any]:
        """Get comprehensive performance snapshot"""
        try:
            # Get system metrics
            cpu_usage = 0
            memory_percent = 0
            
            cpu_metrics = self.collector.get_metrics("system.cpu_usage")
            if cpu_metrics:
                cpu_usage = cpu_metrics[-1].value

            memory_metrics = self.collector.get_metrics("system.memory_percent")
            if memory_metrics:
                memory_percent = memory_metrics[-1].value

            # Get aggregated LLM metrics
            llm_aggregated = self.collector.aggregate_metrics("llm.response_time", 300)  # 5 minutes
            
            # Get error counts
            error_count = 0
            error_metrics = self.collector.get_metrics("error_rate")
            if error_metrics:
                error_count = sum(m.value for m in error_metrics[-60:])  # Last minute

            # Get WebSocket connection count
            websocket_count = len(self.websocket_connections)

            # Get queue depths
            total_queue_depth = sum(self.queue_depths.values())

            return {
                'timestamp': time.time(),
                'system': {
                    'cpu_percent': cpu_usage,
                    'memory_percent': memory_percent
                },
                'llm': {
                    'avg_response_time': llm_aggregated.avg if llm_aggregated else 0,
                    'p95_response_time': llm_aggregated.p95 if llm_aggregated else 0,
                    'call_count': llm_aggregated.count if llm_aggregated else 0
                },
                'websocket': {
                    'active_connections': websocket_count
                },
                'queues': {
                    'total_depth': total_queue_depth,
                    'individual_depths': dict(self.queue_depths)
                },
                'errors': {
                    'count_last_minute': error_count
                },
                'active_agents': [],  # This would be populated by the simulation system
                'uptime': time.time() - (time.time() - self.retention_seconds)  # Approximate
            }
        except Exception as e:
            logger.error(f"Error getting performance snapshot: {e}")
            return {'timestamp': time.time(), 'error': str(e)}

    # Context Manager for Timing

    def timer(self, operation: str, metadata: Optional[Dict[str, Any]] = None):
        """Context manager for timing operations"""
        class TimerContext:
            def __init__(self, monitor, operation, metadata):
                self.monitor = monitor
                self.operation = operation
                self.metadata = metadata
                self.timer_id = None

            def __enter__(self):
                self.timer_id = self.monitor.start_timer(self.operation, self.metadata)
                return self

            def __exit__(self, exc_type, exc_val, exc_tb):
                success = exc_type is None
                if self.timer_id:
                    self.monitor.end_timer(self.timer_id, success)

        return TimerContext(self, operation, metadata)

    # Cleanup and Shutdown

    def stop(self):
        """Stop the performance monitor and cleanup resources"""
        self._running = False
        
        # Wait for background tasks to complete
        if self.executor:
            self.executor.shutdown(wait=True, timeout=5)
        
        logger.info("Performance monitor stopped")

    def __enter__(self):
        """Context manager entry"""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        self.stop()


# Global performance monitor instance
_global_monitor: Optional[PerformanceMonitor] = None
_monitor_lock = threading.Lock()


def get_performance_monitor(
    redis_manager: Optional[RedisStateManager] = None,
    websocket_manager: Optional[WebSocketEventManager] = None
) -> PerformanceMonitor:
    """Get or create the global performance monitor instance"""
    global _global_monitor
    
    with _monitor_lock:
        if _global_monitor is None:
            _global_monitor = PerformanceMonitor(
                redis_manager=redis_manager,
                websocket_manager=websocket_manager
            )
    
    return _global_monitor


# Convenience decorators and functions

def track_performance(operation: str, metadata: Optional[Dict[str, Any]] = None):
    """Decorator to track function performance"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            monitor = get_performance_monitor()
            with monitor.timer(operation, metadata):
                return func(*args, **kwargs)
        return wrapper
    return decorator


def record_agent_performance(agent_type: str, action: str, duration_ms: float, success: bool = True):
    """Convenience function to record agent performance"""
    monitor = get_performance_monitor()
    monitor.record_metric(
        f"agent.{agent_type}.{action}.duration",
        duration_ms,
        "ms",
        {"success": success}
    )
    monitor.record_metric(
        f"agent.{agent_type}.{action}.success_rate",
        1 if success else 0,
        "ratio"
    )


# Example usage and testing
if __name__ == "__main__":
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    # Create performance monitor
    monitor = PerformanceMonitor()
    
    # Example usage
    print("Testing enhanced performance monitoring system...")
    
    # Test timer
    with monitor.timer("test_operation"):
        time.sleep(0.1)
    
    # Test metrics
    monitor.record_metric("test.cpu", 45.2, "percent")
    monitor.increment_throughput("test_messages", 10)
    monitor.track_llm_call("gpt-4", 1250, True, 150)
    
    # Test WebSocket tracking
    monitor.track_websocket_metrics(5, 100, 95, 12.5)
    
    # Test queue monitoring
    monitor.track_queue_depth("message_queue", 25)
    
    # Get performance snapshot
    snapshot = monitor.get_performance_snapshot()
    print(f"Performance snapshot: {json.dumps(snapshot, indent=2)}")
    
    # Export metrics
    exported = monitor.export_metrics_json()
    print(f"Exported metrics (truncated): {exported[:200]}...")
    
    # Clean up
    monitor.stop()
    print("Performance monitoring test completed")