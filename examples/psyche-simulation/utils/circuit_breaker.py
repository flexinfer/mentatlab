"""
Circuit Breaker Pattern Implementation
Provides fault tolerance by failing fast when a service is unavailable
"""

import time
import threading
import logging
from typing import Dict, Any, Optional, Callable
from dataclasses import dataclass
from enum import Enum
from collections import deque

logger = logging.getLogger(__name__)


class CircuitBreakerState(Enum):
    """Circuit breaker states"""
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Circuit is open, failing fast
    HALF_OPEN = "half_open"  # Testing if service is back


@dataclass
class CircuitBreakerConfig:
    """Configuration for circuit breaker"""
    failure_threshold: int = 5          # Number of failures before opening
    success_threshold: int = 3          # Number of successes to close from half-open
    timeout_duration: float = 60.0      # Time to wait before trying half-open (seconds)
    expected_exception: type = Exception # Exception type that triggers circuit breaker
    

@dataclass
class CallResult:
    """Result of a protected call"""
    success: bool
    result: Any = None
    exception: Exception = None
    duration_ms: float = 0.0
    timestamp: float = 0.0


class CircuitBreakerOpenError(Exception):
    """Exception raised when circuit breaker is open"""
    pass


class CircuitBreaker:
    """Circuit breaker implementation for fault tolerance"""
    
    def __init__(self, name: str, config: CircuitBreakerConfig = None):
        self.name = name
        self.config = config or CircuitBreakerConfig()
        
        # State management
        self._state = CircuitBreakerState.CLOSED
        self._failure_count = 0
        self._success_count = 0
        self._last_failure_time = None
        self._lock = threading.RLock()
        
        # Call history for monitoring
        self._call_history = deque(maxlen=1000)
        
        # Metrics
        self._total_calls = 0
        self._total_failures = 0
        self._total_successes = 0
        self._total_circuit_opens = 0
        
    @property
    def state(self) -> CircuitBreakerState:
        """Get current circuit breaker state"""
        with self._lock:
            return self._state
    
    @property
    def failure_rate(self) -> float:
        """Get current failure rate (0.0 to 1.0)"""
        with self._lock:
            if self._total_calls == 0:
                return 0.0
            return self._total_failures / self._total_calls
    
    def __call__(self, func: Callable) -> Callable:
        """Decorator to protect a function with circuit breaker"""
        def wrapper(*args, **kwargs):
            return self.call(func, *args, **kwargs)
        return wrapper
    
    def call(self, func: Callable, *args, **kwargs) -> Any:
        """Execute a function with circuit breaker protection"""
        with self._lock:
            self._total_calls += 1
            
            # Check if circuit is open
            if self._state == CircuitBreakerState.OPEN:
                if self._should_attempt_reset():
                    self._state = CircuitBreakerState.HALF_OPEN
                    logger.info(f"Circuit breaker {self.name} moved to HALF_OPEN")
                else:
                    # Fail fast
                    error = CircuitBreakerOpenError(f"Circuit breaker {self.name} is OPEN")
                    self._record_call(CallResult(success=False, exception=error, timestamp=time.time()))
                    raise error
        
        # Execute the function
        start_time = time.time()
        try:
            result = func(*args, **kwargs)
            duration_ms = (time.time() - start_time) * 1000
            
            # Record success
            call_result = CallResult(
                success=True,
                result=result,
                duration_ms=duration_ms,
                timestamp=time.time()
            )
            self._record_success(call_result)
            return result
            
        except self.config.expected_exception as e:
            duration_ms = (time.time() - start_time) * 1000
            
            # Record failure
            call_result = CallResult(
                success=False,
                exception=e,
                duration_ms=duration_ms,
                timestamp=time.time()
            )
            self._record_failure(call_result)
            raise
    
    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to attempt reset"""
        if self._last_failure_time is None:
            return True
        return time.time() - self._last_failure_time >= self.config.timeout_duration
    
    def _record_success(self, call_result: CallResult):
        """Record a successful call"""
        with self._lock:
            self._total_successes += 1
            self._call_history.append(call_result)
            
            if self._state == CircuitBreakerState.HALF_OPEN:
                self._success_count += 1
                if self._success_count >= self.config.success_threshold:
                    self._reset()
            elif self._state == CircuitBreakerState.CLOSED:
                # Reset failure count on success
                self._failure_count = 0
    
    def _record_failure(self, call_result: CallResult):
        """Record a failed call"""
        with self._lock:
            self._total_failures += 1
            self._call_history.append(call_result)
            self._last_failure_time = time.time()
            
            if self._state in [CircuitBreakerState.CLOSED, CircuitBreakerState.HALF_OPEN]:
                self._failure_count += 1
                if self._failure_count >= self.config.failure_threshold:
                    self._trip()
    
    def _record_call(self, call_result: CallResult):
        """Record a call result"""
        with self._lock:
            self._call_history.append(call_result)
    
    def _trip(self):
        """Trip the circuit breaker to OPEN state"""
        with self._lock:
            self._state = CircuitBreakerState.OPEN
            self._total_circuit_opens += 1
            self._success_count = 0
            logger.warning(f"Circuit breaker {self.name} OPENED after {self._failure_count} failures")
    
    def _reset(self):
        """Reset the circuit breaker to CLOSED state"""
        with self._lock:
            self._state = CircuitBreakerState.CLOSED
            self._failure_count = 0
            self._success_count = 0
            logger.info(f"Circuit breaker {self.name} CLOSED after successful recovery")
    
    def force_open(self):
        """Manually force the circuit breaker open"""
        with self._lock:
            self._state = CircuitBreakerState.OPEN
            self._last_failure_time = time.time()
            logger.warning(f"Circuit breaker {self.name} manually OPENED")
    
    def force_close(self):
        """Manually force the circuit breaker closed"""
        with self._lock:
            self._reset()
            logger.info(f"Circuit breaker {self.name} manually CLOSED")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get circuit breaker statistics"""
        with self._lock:
            recent_calls = [call for call in self._call_history if time.time() - call.timestamp < 300]  # Last 5 minutes
            recent_failures = [call for call in recent_calls if not call.success]
            recent_successes = [call for call in recent_calls if call.success]
            
            return {
                "name": self.name,
                "state": self._state.value,
                "failure_count": self._failure_count,
                "success_count": self._success_count,
                "total_calls": self._total_calls,
                "total_failures": self._total_failures,
                "total_successes": self._total_successes,
                "total_circuit_opens": self._total_circuit_opens,
                "failure_rate": self.failure_rate,
                "recent_calls": len(recent_calls),
                "recent_failures": len(recent_failures),
                "recent_successes": len(recent_successes),
                "last_failure_time": self._last_failure_time,
                "config": {
                    "failure_threshold": self.config.failure_threshold,
                    "success_threshold": self.config.success_threshold,
                    "timeout_duration": self.config.timeout_duration
                }
            }