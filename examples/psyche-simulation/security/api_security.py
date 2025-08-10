"""
API Security Features for Psyche Simulation

Provides comprehensive API security including rate limiting,
input validation, CORS configuration, and security headers.
"""

import re
import time
import hashlib
import logging
import ipaddress
from typing import Dict, List, Optional, Any, Tuple, Callable, Set
from datetime import datetime, timedelta
from collections import defaultdict
from dataclasses import dataclass, field
import threading
from functools import wraps

from data.redis_state_manager import RedisStateManager
from .audit_log import log_security_event, SecurityEventType, EventSeverity

logger = logging.getLogger(__name__)


@dataclass
class RateLimitConfig:
    """Rate limit configuration."""
    requests_per_minute: int = 60
    requests_per_hour: int = 1000
    requests_per_day: int = 10000
    burst_size: int = 10
    
    # Different limits for different operations
    auth_requests_per_minute: int = 10
    data_export_per_hour: int = 5
    api_write_per_minute: int = 30


@dataclass
class SecurityHeaders:
    """Security headers configuration."""
    content_security_policy: str = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "font-src 'self'; "
        "connect-src 'self' wss: ws:; "
        "frame-ancestors 'none';"
    )
    x_content_type_options: str = "nosniff"
    x_frame_options: str = "DENY"
    x_xss_protection: str = "1; mode=block"
    strict_transport_security: str = "max-age=31536000; includeSubDomains"
    referrer_policy: str = "strict-origin-when-cross-origin"
    permissions_policy: str = "geolocation=(), microphone=(), camera=()"


@dataclass
class CORSConfig:
    """CORS configuration."""
    allowed_origins: List[str] = field(default_factory=lambda: ["http://localhost:*"])
    allowed_methods: List[str] = field(default_factory=lambda: ["GET", "POST", "PUT", "DELETE", "OPTIONS"])
    allowed_headers: List[str] = field(default_factory=lambda: ["Content-Type", "Authorization", "X-Requested-With"])
    expose_headers: List[str] = field(default_factory=lambda: ["X-Request-ID", "X-RateLimit-Remaining"])
    max_age: int = 86400
    allow_credentials: bool = True


class RateLimiter:
    """
    Token bucket rate limiter with Redis backing.
    
    Features:
    - Multiple rate limit tiers
    - IP-based and user-based limiting
    - Burst protection
    - Distributed rate limiting via Redis
    """
    
    def __init__(
        self,
        redis_manager: RedisStateManager,
        config: Optional[RateLimitConfig] = None
    ):
        """
        Initialize rate limiter.
        
        Args:
            redis_manager: Redis state manager
            config: Rate limit configuration
        """
        self.redis_manager = redis_manager
        self.config = config or RateLimitConfig()
        self.rate_prefix = "psyche:ratelimit"
        
        # In-memory cache for performance
        self.request_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self.last_cleanup = time.time()
        self.lock = threading.RLock()
    
    def check_rate_limit(
        self,
        identifier: str,
        limit_type: str = "general",
        custom_limit: Optional[int] = None
    ) -> Tuple[bool, Dict[str, Any]]:
        """
        Check if request is within rate limits.
        
        Args:
            identifier: User ID or IP address
            limit_type: Type of limit (general, auth, export, write)
            custom_limit: Custom limit override
            
        Returns:
            Tuple of (allowed, rate_limit_info)
        """
        try:
            current_time = time.time()
            
            # Get appropriate limit
            limit = self._get_limit(limit_type, custom_limit)
            window = self._get_window(limit_type)
            
            # Create bucket key
            bucket_key = f"{self.rate_prefix}:{limit_type}:{identifier}:{int(current_time // window)}"
            
            # Check current count
            with self.lock:
                current_count = self.request_counts[bucket_key].get("count", 0)
                
                # Check burst
                burst_key = f"{bucket_key}:burst"
                burst_count = self.request_counts[burst_key].get("count", 0)
                burst_window = 10  # 10 second burst window
                
                if burst_count >= self.config.burst_size:
                    return False, {
                        "allowed": False,
                        "limit": self.config.burst_size,
                        "remaining": 0,
                        "reset": int(current_time) + burst_window,
                        "reason": "burst_limit_exceeded"
                    }
                
                # Check rate limit
                if current_count >= limit:
                    return False, {
                        "allowed": False,
                        "limit": limit,
                        "remaining": 0,
                        "reset": int(current_time) + window,
                        "reason": "rate_limit_exceeded"
                    }
                
                # Increment counts
                self.request_counts[bucket_key]["count"] = current_count + 1
                self.request_counts[bucket_key]["timestamp"] = current_time
                
                self.request_counts[burst_key]["count"] = burst_count + 1
                self.request_counts[burst_key]["timestamp"] = current_time
                
                # Store in Redis for distributed limiting
                self._update_redis_count(bucket_key, current_count + 1, int(window))
                
                # Periodic cleanup
                if current_time - self.last_cleanup > 300:  # 5 minutes
                    self._cleanup_old_buckets()
                
                return True, {
                    "allowed": True,
                    "limit": limit,
                    "remaining": limit - current_count - 1,
                    "reset": int(current_time) + window
                }
                
        except Exception as e:
            logger.error(f"Rate limit check error: {e}")
            # Fail open for availability
            return True, {"allowed": True, "error": str(e)}
    
    def _get_limit(self, limit_type: str, custom_limit: Optional[int]) -> int:
        """Get rate limit for type."""
        if custom_limit:
            return custom_limit
        
        limits = {
            "general": self.config.requests_per_minute,
            "auth": self.config.auth_requests_per_minute,
            "export": self.config.data_export_per_hour // 60,  # Convert to per minute
            "write": self.config.api_write_per_minute
        }
        
        return limits.get(limit_type, self.config.requests_per_minute)
    
    def _get_window(self, limit_type: str) -> int:
        """Get time window for limit type."""
        windows = {
            "general": 60,      # 1 minute
            "auth": 60,         # 1 minute
            "export": 3600,     # 1 hour
            "write": 60         # 1 minute
        }
        
        return windows.get(limit_type, 60)
    
    def _update_redis_count(self, key: str, count: int, ttl: int):
        """Update count in Redis."""
        try:
            # Store count with TTL
            self.redis_manager.store_agent_state(
                key,
                {"count": count, "updated_at": datetime.now().isoformat()},
                ttl=ttl
            )
        except Exception as e:
            logger.error(f"Error updating Redis rate limit: {e}")
    
    def _cleanup_old_buckets(self):
        """Clean up expired buckets from memory."""
        try:
            current_time = time.time()
            expired_keys = []
            
            with self.lock:
                for key, data in self.request_counts.items():
                    if current_time - data.get("timestamp", 0) > 3600:  # 1 hour
                        expired_keys.append(key)
                
                for key in expired_keys:
                    del self.request_counts[key]
                
                self.last_cleanup = current_time
                
        except Exception as e:
            logger.error(f"Error cleaning up rate limit buckets: {e}")


class InputValidator:
    """
    Comprehensive input validation and sanitization.
    
    Features:
    - SQL injection prevention
    - XSS protection
    - Path traversal prevention
    - Input length validation
    - Data type validation
    """
    
    # Dangerous patterns
    SQL_INJECTION_PATTERNS = [
        r"(\b(union|select|insert|update|delete|drop|create|alter|exec|execute)\b)",
        r"(--|#|\/\*|\*\/)",
        r"(\bor\b\s*\d+\s*=\s*\d+)",
        r"(\band\b\s*\d+\s*=\s*\d+)",
        r"(;|'|\"|\)|--)"
    ]
    
    XSS_PATTERNS = [
        r"<script[^>]*>.*?</script>",
        r"javascript:",
        r"on\w+\s*=",
        r"<iframe[^>]*>",
        r"<object[^>]*>",
        r"<embed[^>]*>",
        r"<link[^>]*>"
    ]
    
    PATH_TRAVERSAL_PATTERNS = [
        r"\.\./",
        r"\.\.",
        r"\./",
        r"%2e%2e",
        r"%252e%252e"
    ]
    
    def __init__(self):
        """Initialize input validator."""
        self.sql_regex = re.compile("|".join(self.SQL_INJECTION_PATTERNS), re.IGNORECASE)
        self.xss_regex = re.compile("|".join(self.XSS_PATTERNS), re.IGNORECASE)
        self.path_regex = re.compile("|".join(self.PATH_TRAVERSAL_PATTERNS), re.IGNORECASE)
    
    def validate_input(
        self,
        data: Any,
        data_type: type,
        min_length: Optional[int] = None,
        max_length: Optional[int] = None,
        allowed_values: Optional[List[Any]] = None,
        custom_validator: Optional[Callable] = None
    ) -> Tuple[bool, Optional[str], Any]:
        """
        Validate and sanitize input.
        
        Args:
            data: Input data
            data_type: Expected data type
            min_length: Minimum length (for strings)
            max_length: Maximum length
            allowed_values: List of allowed values
            custom_validator: Custom validation function
            
        Returns:
            Tuple of (valid, error_message, sanitized_data)
        """
        try:
            # Type validation
            if not isinstance(data, data_type):
                return False, f"Expected {data_type.__name__}, got {type(data).__name__}", None
            
            # String validation
            if data_type == str:
                # Length validation
                if min_length and len(data) < min_length:
                    return False, f"Input too short (min: {min_length})", None
                if max_length and len(data) > max_length:
                    return False, f"Input too long (max: {max_length})", None
                
                # SQL injection check
                if self.sql_regex.search(data):
                    log_security_event(
                        SecurityEventType.INJECTION_ATTEMPT.value,
                        details={"input": data[:100], "type": "sql"}
                    )
                    return False, "Potential SQL injection detected", None
                
                # XSS check
                if self.xss_regex.search(data):
                    log_security_event(
                        SecurityEventType.XSS_ATTEMPT.value,
                        details={"input": data[:100], "type": "xss"}
                    )
                    return False, "Potential XSS attack detected", None
                
                # Path traversal check
                if self.path_regex.search(data):
                    return False, "Path traversal attempt detected", None
                
                # Sanitize
                sanitized = self._sanitize_string(data)
            else:
                sanitized = data
            
            # Allowed values check
            if allowed_values and sanitized not in allowed_values:
                return False, f"Value not in allowed list", None
            
            # Custom validation
            if custom_validator:
                valid, message = custom_validator(sanitized)
                if not valid:
                    return False, message, None
            
            return True, None, sanitized
            
        except Exception as e:
            logger.error(f"Input validation error: {e}")
            return False, "Validation error", None
    
    def _sanitize_string(self, data: str) -> str:
        """Sanitize string input."""
        # Remove null bytes
        sanitized = data.replace('\x00', '')
        
        # Escape HTML entities
        html_escapes = {
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '&': '&amp;'
        }
        
        for char, escape in html_escapes.items():
            sanitized = sanitized.replace(char, escape)
        
        return sanitized.strip()
    
    def validate_email(self, email: str) -> Tuple[bool, Optional[str]]:
        """Validate email address."""
        email_regex = re.compile(
            r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        )
        
        if not email_regex.match(email):
            return False, "Invalid email format"
        
        return True, None
    
    def validate_ip_address(self, ip: str) -> Tuple[bool, Optional[str]]:
        """Validate IP address."""
        try:
            ipaddress.ip_address(ip)
            return True, None
        except ValueError:
            return False, "Invalid IP address"
    
    def validate_url(self, url: str) -> Tuple[bool, Optional[str]]:
        """Validate URL."""
        url_regex = re.compile(
            r'^https?://'
            r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|'
            r'localhost|'
            r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})'
            r'(?::\d+)?'
            r'(?:/?|[/?]\S+)$', re.IGNORECASE
        )
        
        if not url_regex.match(url):
            return False, "Invalid URL format"
        
        return True, None


def apply_security_headers(response: Dict[str, Any], config: Optional[SecurityHeaders] = None) -> Dict[str, Any]:
    """
    Apply security headers to response.
    
    Args:
        response: Response dictionary
        config: Security headers configuration
        
    Returns:
        Response with security headers
    """
    config = config or SecurityHeaders()
    
    headers = response.get("headers", {})
    
    headers.update({
        "Content-Security-Policy": config.content_security_policy,
        "X-Content-Type-Options": config.x_content_type_options,
        "X-Frame-Options": config.x_frame_options,
        "X-XSS-Protection": config.x_xss_protection,
        "Strict-Transport-Security": config.strict_transport_security,
        "Referrer-Policy": config.referrer_policy,
        "Permissions-Policy": config.permissions_policy
    })
    
    response["headers"] = headers
    return response


def apply_cors_headers(
    response: Dict[str, Any],
    request_origin: str,
    config: Optional[CORSConfig] = None
) -> Dict[str, Any]:
    """
    Apply CORS headers to response.
    
    Args:
        response: Response dictionary
        request_origin: Request origin
        config: CORS configuration
        
    Returns:
        Response with CORS headers
    """
    config = config or CORSConfig()
    
    headers = response.get("headers", {})
    
    # Check if origin is allowed
    allowed = False
    for allowed_origin in config.allowed_origins:
        if allowed_origin == "*" or allowed_origin == request_origin:
            allowed = True
            break
        # Handle wildcard subdomains
        if "*" in allowed_origin:
            pattern = allowed_origin.replace("*", ".*")
            if re.match(pattern, request_origin):
                allowed = True
                break
    
    if allowed:
        headers.update({
            "Access-Control-Allow-Origin": request_origin,
            "Access-Control-Allow-Methods": ", ".join(config.allowed_methods),
            "Access-Control-Allow-Headers": ", ".join(config.allowed_headers),
            "Access-Control-Expose-Headers": ", ".join(config.expose_headers),
            "Access-Control-Max-Age": str(config.max_age)
        })
        
        if config.allow_credentials:
            headers["Access-Control-Allow-Credentials"] = "true"
    
    response["headers"] = headers
    return response


# Decorator for rate limiting
def rate_limit(
    limit_type: str = "general",
    custom_limit: Optional[int] = None
):
    """
    Decorator for rate limiting endpoints.
    
    Args:
        limit_type: Type of rate limit
        custom_limit: Custom limit override
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(request, *args, **kwargs):
            # Get rate limiter from app state
            rate_limiter = getattr(request.app.state, 'rate_limiter', None)
            if not rate_limiter:
                return await func(request, *args, **kwargs)
            
            # Get identifier (user ID or IP)
            identifier = request.state.token_info.user_id if hasattr(request.state, 'token_info') else request.client.host
            
            # Check rate limit
            allowed, info = rate_limiter.check_rate_limit(identifier, limit_type, custom_limit)
            
            if not allowed:
                # Log rate limit exceeded
                log_security_event(
                    SecurityEventType.RATE_LIMIT_EXCEEDED.value,
                    user_id=identifier,
                    details=info,
                    severity=EventSeverity.WARNING.value
                )
                
                return {
                    "error": "Rate limit exceeded",
                    "limit": info["limit"],
                    "reset": info["reset"],
                    "reason": info["reason"]
                }, 429
            
            # Add rate limit headers
            response = await func(request, *args, **kwargs)
            if isinstance(response, tuple):
                response_data, status_code = response
            else:
                response_data, status_code = response, 200
            
            # Add rate limit headers
            headers = response_data.get("headers", {})
            headers.update({
                "X-RateLimit-Limit": str(info["limit"]),
                "X-RateLimit-Remaining": str(info["remaining"]),
                "X-RateLimit-Reset": str(info["reset"])
            })
            response_data["headers"] = headers
            
            return response_data, status_code
        
        return wrapper
    return decorator


# Decorator for input validation
def validate_input_params(**validators):
    """
    Decorator for validating input parameters.
    
    Args:
        **validators: Parameter names and their validation configs
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(request, *args, **kwargs):
            validator = InputValidator()
            
            # Get request data
            if request.method in ["POST", "PUT", "PATCH"]:
                data = await request.json()
            else:
                data = dict(request.query_params)
            
            # Validate each parameter
            for param_name, validation_config in validators.items():
                param_value = data.get(param_name)
                
                if param_value is None and validation_config.get("required", False):
                    return {"error": f"Missing required parameter: {param_name}"}, 400
                
                if param_value is not None:
                    valid, error, sanitized = validator.validate_input(
                        param_value,
                        validation_config.get("type", str),
                        validation_config.get("min_length"),
                        validation_config.get("max_length"),
                        validation_config.get("allowed_values"),
                        validation_config.get("custom_validator")
                    )
                    
                    if not valid:
                        return {"error": f"Invalid {param_name}: {error}"}, 400
                    
                    # Update with sanitized value
                    data[param_name] = sanitized
            
            # Pass sanitized data to function
            request.state.validated_data = data
            return await func(request, *args, **kwargs)
        
        return wrapper
    return decorator


def apply_security_middleware(
    app,
    redis_manager: RedisStateManager,
    rate_limit_config: Optional[RateLimitConfig] = None,
    security_headers_config: Optional[SecurityHeaders] = None,
    cors_config: Optional[CORSConfig] = None
):
    """
    Apply all security middleware to app.
    
    Args:
        app: Application instance
        redis_manager: Redis state manager
        rate_limit_config: Rate limit configuration
        security_headers_config: Security headers configuration
        cors_config: CORS configuration
    """
    # Initialize components
    app.state.rate_limiter = RateLimiter(redis_manager, rate_limit_config)
    app.state.input_validator = InputValidator()
    app.state.security_headers_config = security_headers_config or SecurityHeaders()
    app.state.cors_config = cors_config or CORSConfig()
    
    # Add middleware
    @app.middleware("http")
    async def security_middleware(request, call_next):
        # Apply security headers
        response = await call_next(request)
        
        # Convert to dict for header manipulation
        response_dict = {
            "headers": dict(response.headers),
            "status_code": response.status_code
        }
        
        # Apply security headers
        response_dict = apply_security_headers(
            response_dict,
            app.state.security_headers_config
        )
        
        # Apply CORS headers
        origin = request.headers.get("Origin", "")
        if origin:
            response_dict = apply_cors_headers(
                response_dict,
                origin,
                app.state.cors_config
            )
        
        # Update response headers
        for key, value in response_dict["headers"].items():
            response.headers[key] = value
        
        return response
    
    logger.info("Security middleware applied")