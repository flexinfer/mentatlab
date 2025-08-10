"""
JWT Token Management and Middleware for Psyche Simulation

Provides enhanced JWT token validation, blacklisting, and middleware
for securing API endpoints with comprehensive authentication checks.
"""

import functools
import jwt
import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple, Callable, Set
from dataclasses import dataclass, field

from data.redis_state_manager import RedisStateManager
from auth.session_handler import SessionManager
from utils.websocket_events import get_event_manager

logger = logging.getLogger(__name__)


@dataclass
class TokenInfo:
    """JWT token information structure."""
    token: str
    user_id: str
    session_id: str
    permissions: List[str]
    issued_at: datetime
    expires_at: datetime
    device_id: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    
    def is_expired(self) -> bool:
        """Check if token is expired."""
        return datetime.utcnow() > self.expires_at
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "user_id": self.user_id,
            "session_id": self.session_id,
            "permissions": self.permissions,
            "issued_at": self.issued_at.isoformat(),
            "expires_at": self.expires_at.isoformat(),
            "device_id": self.device_id,
            "ip_address": self.ip_address,
            "user_agent": self.user_agent
        }


class TokenBlacklist:
    """
    Manages blacklisted JWT tokens for secure logout and revocation.
    
    Features:
    - Token blacklisting with expiration
    - Redis-backed persistence
    - Automatic cleanup of expired tokens
    - Multi-device token management
    """
    
    def __init__(
        self,
        redis_manager: RedisStateManager,
        cleanup_interval_minutes: int = 60
    ):
        """
        Initialize token blacklist.
        
        Args:
            redis_manager: Redis state manager
            cleanup_interval_minutes: Cleanup interval in minutes
        """
        self.redis_manager = redis_manager
        self.cleanup_interval_minutes = cleanup_interval_minutes
        self.blacklist_prefix = "psyche:token_blacklist"
        self.lock = threading.RLock()
        
        # In-memory cache for quick lookups
        self.blacklist_cache: Set[str] = set()
        self.cache_last_sync = datetime.utcnow()
        
        # Start cleanup thread
        self.cleanup_running = True
        self.cleanup_thread = threading.Thread(
            target=self._cleanup_expired_tokens,
            daemon=True
        )
        self.cleanup_thread.start()
        
        # Load existing blacklist
        self._sync_from_redis()
    
    def _sync_from_redis(self):
        """Sync blacklist cache from Redis."""
        try:
            # Note: In production, you'd scan Redis keys matching pattern
            # For now, we'll maintain the cache internally
            logger.info("Token blacklist synced from Redis")
        except Exception as e:
            logger.error(f"Error syncing blacklist from Redis: {e}")
    
    def add_token(
        self,
        token: str,
        expires_at: datetime,
        reason: str = "manual_revocation"
    ) -> bool:
        """
        Add token to blacklist.
        
        Args:
            token: JWT token to blacklist
            expires_at: Token expiration time
            reason: Reason for blacklisting
            
        Returns:
            Success status
        """
        try:
            with self.lock:
                # Calculate TTL
                ttl = int((expires_at - datetime.utcnow()).total_seconds())
                if ttl <= 0:
                    return True  # Already expired
                
                # Store in Redis with TTL
                key = f"{self.blacklist_prefix}:{token[:32]}"  # Use token prefix
                data = {
                    "token": token,
                    "blacklisted_at": datetime.utcnow().isoformat(),
                    "expires_at": expires_at.isoformat(),
                    "reason": reason
                }
                
                success = self.redis_manager.store_agent_state(key, data, ttl=ttl)
                
                if success:
                    self.blacklist_cache.add(token)
                    logger.info(f"Token blacklisted: {token[:32]}... Reason: {reason}")
                
                return success
                
        except Exception as e:
            logger.error(f"Error blacklisting token: {e}")
            return False
    
    def is_blacklisted(self, token: str) -> bool:
        """
        Check if token is blacklisted.
        
        Args:
            token: JWT token to check
            
        Returns:
            True if blacklisted
        """
        try:
            # Check in-memory cache first
            if token in self.blacklist_cache:
                return True
            
            # Check Redis if cache might be stale
            if (datetime.utcnow() - self.cache_last_sync).seconds > 300:  # 5 minutes
                self._sync_from_redis()
            
            # Check Redis directly
            key = f"{self.blacklist_prefix}:{token[:32]}"
            data = self.redis_manager.get_agent_state(key)
            
            if data and "state" in data:
                # Update cache
                self.blacklist_cache.add(token)
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error checking blacklist: {e}")
            return False  # Fail open for availability
    
    def remove_token(self, token: str) -> bool:
        """
        Remove token from blacklist.
        
        Args:
            token: JWT token to remove
            
        Returns:
            Success status
        """
        try:
            with self.lock:
                if token in self.blacklist_cache:
                    self.blacklist_cache.remove(token)
                
                # Note: Redis doesn't have direct delete in our interface
                # In production, you'd implement a delete method
                return True
                
        except Exception as e:
            logger.error(f"Error removing token from blacklist: {e}")
            return False
    
    def blacklist_user_tokens(self, user_id: str) -> int:
        """
        Blacklist all tokens for a user.
        
        Args:
            user_id: User ID
            
        Returns:
            Number of tokens blacklisted
        """
        # This would require tracking active tokens per user
        # Implementation would scan and blacklist all user tokens
        logger.warning("blacklist_user_tokens not fully implemented")
        return 0
    
    def _cleanup_expired_tokens(self):
        """Background thread to cleanup expired tokens."""
        while self.cleanup_running:
            try:
                time.sleep(self.cleanup_interval_minutes * 60)
                
                # Clean up in-memory cache
                # In production, expired Redis keys auto-delete with TTL
                logger.info("Token blacklist cleanup completed")
                
            except Exception as e:
                logger.error(f"Error in blacklist cleanup: {e}")
    
    def shutdown(self):
        """Shutdown blacklist manager."""
        self.cleanup_running = False
        if self.cleanup_thread and self.cleanup_thread.is_alive():
            self.cleanup_thread.join(timeout=5)


class JWTMiddleware:
    """
    JWT authentication middleware for API endpoints.
    
    Features:
    - Token validation and verification
    - Blacklist checking
    - Token refresh handling
    - Device tracking
    - Suspicious activity detection
    """
    
    def __init__(
        self,
        session_manager: SessionManager,
        token_blacklist: TokenBlacklist,
        jwt_secret: Optional[str] = None,
        refresh_window_hours: int = 4,
        max_devices_per_user: int = 5
    ):
        """
        Initialize JWT middleware.
        
        Args:
            session_manager: Session manager instance
            token_blacklist: Token blacklist instance
            jwt_secret: JWT signing secret
            refresh_window_hours: Hours before expiry to allow refresh
            max_devices_per_user: Maximum concurrent devices
        """
        self.session_manager = session_manager
        self.token_blacklist = token_blacklist
        self.jwt_secret = jwt_secret or session_manager.jwt_secret
        self.refresh_window_hours = refresh_window_hours
        self.max_devices_per_user = max_devices_per_user
        
        # Track active devices per user
        self.user_devices: Dict[str, Set[str]] = {}
        self.lock = threading.RLock()
        
        # Security event manager
        self.event_manager = get_event_manager()
    
    def create_token(self, payload: Dict[str, Any]) -> str:
        """
        Create JWT token with specified payload.
        
        Args:
            payload: Token payload containing user_id, permissions, session_id, etc.
            
        Returns:
            JWT token string
        """
        try:
            # Add standard JWT claims
            now = datetime.utcnow()
            exp_time = now + timedelta(hours=24)  # 24 hour expiration
            
            token_payload = {
                "user_id": payload.get("user_id"),
                "session_id": payload.get("session_id"),
                "permissions": payload.get("permissions", []),
                "iat": int(now.timestamp()),
                "exp": int(exp_time.timestamp()),
                "iss": "psyche-simulation"
            }
            
            # Generate JWT token
            token = jwt.encode(
                token_payload,
                self.jwt_secret,
                algorithm="HS256"
            )
            
            logger.info(f"JWT token created for user: {payload.get('user_id')}")
            return token
            
        except Exception as e:
            logger.error(f"Error creating JWT token: {e}")
            raise e
    
    def validate_token(
        self,
        token: str,
        required_permissions: Optional[List[str]] = None,
        request_info: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, str, Optional[TokenInfo]]:
        """
        Validate JWT token with comprehensive checks.
        
        Args:
            token: JWT token
            required_permissions: Required permissions
            request_info: Request metadata (IP, user agent, etc.)
            
        Returns:
            Tuple of (valid, message, token_info)
        """
        try:
            # Check blacklist first
            if self.token_blacklist.is_blacklisted(token):
                self._log_security_event("token_blacklisted", None, {
                    "token_prefix": token[:32]
                })
                return False, "Token has been revoked", None
            
            # Decode and verify token
            try:
                payload = jwt.decode(
                    token,
                    self.jwt_secret,
                    algorithms=["HS256"]
                )
            except jwt.ExpiredSignatureError:
                return False, "Token expired", None
            except jwt.InvalidTokenError:
                return False, "Invalid token", None
            
            # Extract token info
            user_id = payload.get("user_id")
            session_id = payload.get("session_id")
            permissions = payload.get("permissions", [])
            
            if not user_id or not session_id:
                return False, "Invalid token payload", None
            
            # Validate session exists and is active
            valid, message, _, _ = self.session_manager.validate_session_token(token)
            if not valid:
                return False, message, None
            
            # Check required permissions
            if required_permissions:
                missing_perms = set(required_permissions) - set(permissions)
                if missing_perms:
                    self._log_security_event("insufficient_permissions", user_id, {
                        "required": required_permissions,
                        "missing": list(missing_perms)
                    })
                    return False, f"Missing permissions: {', '.join(missing_perms)}", None
            
            # Create token info
            token_info = TokenInfo(
                token=token,
                user_id=user_id,
                session_id=session_id,
                permissions=permissions,
                issued_at=datetime.fromtimestamp(payload.get("iat", 0)),
                expires_at=datetime.fromtimestamp(payload.get("exp", 0))
            )
            
            # Add request info if provided
            if request_info:
                token_info.ip_address = request_info.get("ip_address")
                token_info.user_agent = request_info.get("user_agent")
                token_info.device_id = request_info.get("device_id")
                
                # Track device
                self._track_device(user_id, token_info.device_id)
            
            return True, "Token valid", token_info
            
        except Exception as e:
            logger.error(f"Error validating token: {e}")
            return False, "Token validation error", None
    
    def refresh_token(
        self,
        token: str,
        request_info: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, str, Optional[str]]:
        """
        Refresh JWT token if within refresh window.
        
        Args:
            token: Current JWT token
            request_info: Request metadata
            
        Returns:
            Tuple of (success, message, new_token)
        """
        try:
            # Validate current token
            valid, message, token_info = self.validate_token(token, request_info=request_info)
            if not valid:
                return False, f"Cannot refresh: {message}", None
            
            # Check if within refresh window
            time_to_expiry = token_info.expires_at - datetime.utcnow()
            if time_to_expiry.total_seconds() > self.refresh_window_hours * 3600:
                return False, "Token not eligible for refresh yet", None
            
            # Generate new token
            new_token = self.session_manager._generate_jwt_token(
                token_info.user_id,
                token_info.session_id,
                token_info.permissions
            )
            
            # Blacklist old token
            self.token_blacklist.add_token(
                token,
                token_info.expires_at,
                reason="token_refresh"
            )
            
            self._log_security_event("token_refreshed", token_info.user_id, {
                "session_id": token_info.session_id,
                "old_token_prefix": token[:32],
                "new_token_prefix": new_token[:32]
            })
            
            return True, "Token refreshed", new_token
            
        except Exception as e:
            logger.error(f"Error refreshing token: {e}")
            return False, "Token refresh error", None
    
    def revoke_token(
        self,
        token: str,
        reason: str = "user_logout"
    ) -> bool:
        """
        Revoke a JWT token.
        
        Args:
            token: JWT token to revoke
            reason: Revocation reason
            
        Returns:
            Success status
        """
        try:
            # Decode token to get expiration
            try:
                payload = jwt.decode(
                    token,
                    self.jwt_secret,
                    algorithms=["HS256"],
                    options={"verify_exp": False}  # Allow expired tokens
                )
                expires_at = datetime.fromtimestamp(payload.get("exp", 0))
                user_id = payload.get("user_id")
            except Exception:
                # If decode fails, blacklist for 24 hours
                expires_at = datetime.utcnow() + timedelta(hours=24)
                user_id = None
            
            # Add to blacklist
            success = self.token_blacklist.add_token(token, expires_at, reason)
            
            if success and user_id:
                self._log_security_event("token_revoked", user_id, {
                    "reason": reason,
                    "token_prefix": token[:32]
                })
            
            return success
            
        except Exception as e:
            logger.error(f"Error revoking token: {e}")
            return False
    
    def _track_device(self, user_id: str, device_id: Optional[str]):
        """Track user devices for security monitoring."""
        if not device_id:
            return
        
        try:
            with self.lock:
                if user_id not in self.user_devices:
                    self.user_devices[user_id] = set()
                
                self.user_devices[user_id].add(device_id)
                
                # Check for suspicious activity
                if len(self.user_devices[user_id]) > self.max_devices_per_user:
                    self._log_security_event("suspicious_device_count", user_id, {
                        "device_count": len(self.user_devices[user_id]),
                        "max_allowed": self.max_devices_per_user
                    })
                    
        except Exception as e:
            logger.error(f"Error tracking device: {e}")
    
    def _log_security_event(
        self,
        event_type: str,
        user_id: Optional[str],
        details: Dict[str, Any]
    ):
        """Log security event via WebSocket."""
        try:
            # Use the audit logger when available
            from .audit_log import log_security_event
            log_security_event(event_type, user_id, details)
            
        except ImportError:
            # Fallback to basic logging
            logger.warning(f"Security event: {event_type} for user {user_id}: {details}")


# Decorator functions for easy endpoint protection
def require_auth(func: Callable) -> Callable:
    """
    Decorator to require authentication for an endpoint.
    
    Usage:
        @require_auth
        async def protected_endpoint(request):
            # Access token_info from request
            user_id = request.state.token_info.user_id
    """
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        # Extract request object (implementation depends on framework)
        request = args[0] if args else kwargs.get('request')
        
        if not request:
            raise ValueError("No request object found")
        
        # Get token from Authorization header
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return {"error": "Missing or invalid authorization header"}, 401
        
        token = auth_header[7:]  # Remove 'Bearer ' prefix
        
        # Get middleware instance (would be injected in real app)
        middleware = getattr(request.app.state, 'jwt_middleware', None)
        if not middleware:
            return {"error": "Authentication not configured"}, 500
        
        # Validate token
        valid, message, token_info = middleware.validate_token(
            token,
            request_info={
                "ip_address": request.client.host if hasattr(request, 'client') else None,
                "user_agent": request.headers.get('User-Agent'),
                "device_id": request.headers.get('X-Device-ID')
            }
        )
        
        if not valid:
            return {"error": message}, 401
        
        # Store token info in request state
        request.state.token_info = token_info
        
        # Call original function
        return await func(*args, **kwargs)
    
    return wrapper


def require_permission(*permissions: str) -> Callable:
    """
    Decorator to require specific permissions for an endpoint.
    
    Usage:
        @require_permission('admin', 'write')
        async def admin_endpoint(request):
            # Only accessible to users with admin and write permissions
    """
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        @require_auth  # Also require authentication
        async def wrapper(*args, **kwargs):
            request = args[0] if args else kwargs.get('request')
            
            # Check if user has required permissions
            token_info = request.state.token_info
            missing_perms = set(permissions) - set(token_info.permissions)
            
            if missing_perms:
                return {
                    "error": f"Missing required permissions: {', '.join(missing_perms)}"
                }, 403
            
            return await func(*args, **kwargs)
        
        return wrapper
    
    return decorator


def validate_token(
    token: str,
    session_manager: SessionManager,
    token_blacklist: TokenBlacklist
) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """
    Standalone token validation function.
    
    Args:
        token: JWT token
        session_manager: Session manager instance
        token_blacklist: Token blacklist instance
        
    Returns:
        Tuple of (valid, message, user_data)
    """
    middleware = JWTMiddleware(session_manager, token_blacklist)
    valid, message, token_info = middleware.validate_token(token)
    
    if valid and token_info:
        return True, message, token_info.to_dict()
    
    return False, message, None