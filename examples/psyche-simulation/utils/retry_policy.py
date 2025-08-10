"""
Retry Policy Implementation
Provides configurable retry strategies with exponential backoff and jitter
"""

import time
import random
import logging
from typing import Callable, TypeVar, Optional, Any
from dataclasses import dataclass

logger = logging.getLogger(__name__)

T = TypeVar('T')


@dataclass
class RetryConfig:
    """Configuration for retry policy"""
    max_attempts: int = 3
    base_delay: float = 1.0      # Base delay in seconds
    max_delay: float = 60.0      # Maximum delay in seconds
    exponential_base: float = 2.0
    jitter: bool = True
    retryable_exceptions: tuple = (Exception,)  # Exceptions that trigger retry


class RetryPolicy:
    """Retry policy with exponential backoff and jitter"""
    
    def __init__(self, config: RetryConfig = None):
        self.config = config or RetryConfig()
    
    def get_delay(self, attempt: int) -> float:
        """Calculate delay for the given attempt number"""
        if attempt <= 0:
            return 0
        
        # Calculate exponential backoff
        delay = min(
            self.config.base_delay * (self.config.exponential_base ** (attempt - 1)),
            self.config.max_delay
        )
        
        # Add jitter if enabled
        if self.config.jitter:
            delay = delay * (0.5 + random.random() * 0.5)
        
        return delay
    
    def __call__(self, func: Callable[..., T]) -> Callable[..., T]:
        """Decorator to add retry logic to a function"""
        def wrapper(*args, **kwargs) -> T:
            return self.execute_with_retry(func, *args, **kwargs)
        return wrapper
    
    def execute_with_retry(self, func: Callable[..., T], *args, **kwargs) -> T:
        """Execute a function with retry logic"""
        last_exception = None
        
        for attempt in range(1, self.config.max_attempts + 1):
            try:
                result = func(*args, **kwargs)
                if attempt > 1:
                    logger.info(f"Retry successful after {attempt} attempts")
                return result
                
            except self.config.retryable_exceptions as e:
                last_exception = e
                
                if attempt >= self.config.max_attempts:
                    logger.error(f"Max retry attempts ({self.config.max_attempts}) reached")
                    raise
                
                delay = self.get_delay(attempt)
                logger.warning(
                    f"Attempt {attempt} failed: {e}. "
                    f"Retrying in {delay:.2f} seconds..."
                )
                time.sleep(delay)
        
        # This should never be reached, but just in case
        if last_exception:
            raise last_exception
        raise RuntimeError("Unexpected error in retry logic")


class LinearRetryPolicy(RetryPolicy):
    """Retry policy with linear backoff"""
    
    def get_delay(self, attempt: int) -> float:
        """Calculate linear delay"""
        if attempt <= 0:
            return 0
        
        delay = min(
            self.config.base_delay * attempt,
            self.config.max_delay
        )
        
        if self.config.jitter:
            delay = delay * (0.5 + random.random() * 0.5)
        
        return delay


class FixedRetryPolicy(RetryPolicy):
    """Retry policy with fixed delay"""
    
    def get_delay(self, attempt: int) -> float:
        """Return fixed delay"""
        if attempt <= 0:
            return 0
        
        delay = self.config.base_delay
        
        if self.config.jitter:
            delay = delay * (0.5 + random.random() * 0.5)
        
        return delay


# Convenience functions for common retry patterns
def retry_with_exponential_backoff(
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    jitter: bool = True,
    exceptions: tuple = (Exception,)
) -> Callable:
    """Decorator for exponential backoff retry"""
    config = RetryConfig(
        max_attempts=max_attempts,
        base_delay=base_delay,
        max_delay=max_delay,
        jitter=jitter,
        retryable_exceptions=exceptions
    )
    return RetryPolicy(config)


def retry_with_linear_backoff(
    max_attempts: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    jitter: bool = True,
    exceptions: tuple = (Exception,)
) -> Callable:
    """Decorator for linear backoff retry"""
    config = RetryConfig(
        max_attempts=max_attempts,
        base_delay=base_delay,
        max_delay=max_delay,
        jitter=jitter,
        retryable_exceptions=exceptions
    )
    return LinearRetryPolicy(config)


def retry_with_fixed_delay(
    max_attempts: int = 3,
    delay: float = 1.0,
    jitter: bool = False,
    exceptions: tuple = (Exception,)
) -> Callable:
    """Decorator for fixed delay retry"""
    config = RetryConfig(
        max_attempts=max_attempts,
        base_delay=delay,
        jitter=jitter,
        retryable_exceptions=exceptions
    )
    return FixedRetryPolicy(config)