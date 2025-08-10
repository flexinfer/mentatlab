"""
Multi-user Session Management for Psyche Simulation

Provides comprehensive session handling capabilities:
- Multi-user simulation session management
- Session isolation and data separation per user
- Concurrent user support with session affinity
- Session persistence and recovery across restarts
- Session cleanup and timeout handling
- Integration with existing Redis state management
- JWT token-based session management
"""

import json
import jwt
import logging
import secrets
import threading
import time
import uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Dict, List, Optional, Any, Tuple, Set
from dataclasses import dataclass, asdict, field
from contextlib import contextmanager

from data.redis_state_manager import RedisStateManager
from utils.websocket_events import get_event_manager, broadcast_system_status
from .user_manager import UserManager, UserProfile, UserRole

# Import security components using local imports to avoid circular dependency
def _get_jwt_middleware():
    from security import JWTMiddleware
    return JWTMiddleware

def _get_token_blacklist():
    from security import TokenBlacklist
    return TokenBlacklist

def _get_permission_manager():
    from security import PermissionManager
    return PermissionManager

def _get_audit_logger():
    from security import AuditLogger
    return AuditLogger

async def _log_security_event(audit_logger, event_type, **kwargs):
    # Check if audit_logger is properly initialized
    if audit_logger is None:
        logger.warning("Audit logger not initialized")
        return
    
    # Call the audit logger's log_event method directly with safe handling
    try:
        # Use the simple audit logger approach that handles both enums and strings
        from security.simple_audit_log import log_security_event
        return await log_security_event(event_type, **kwargs)
    except Exception as e:
        logger.warning(f"Failed to log security event: {e}")
        return None

logger = logging.getLogger(__name__)


class SessionStatus(str, Enum):
    """Session status enumeration."""
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    EXPIRED = "expired"
    TERMINATED = "terminated"


class SessionType(str, Enum):
    """Session type enumeration."""
    SINGLE_USER = "single_user"
    SHARED = "shared"
    OBSERVER_ONLY = "observer_only"


@dataclass
class SessionData:
    """Session data structure."""
    session_id: str
    user_id: str
    session_type: SessionType
    status: SessionStatus
    created_at: datetime
    last_activity: datetime
    expires_at: Optional[datetime] = None
    simulation_state: Dict[str, Any] = field(default_factory=dict)
    conversation_history: List[Dict[str, Any]] = field(default_factory=list)
    agent_states: Dict[str, Any] = field(default_factory=dict)
    network_state: Dict[str, Any] = field(default_factory=dict)
    participants: Set[str] = field(default_factory=set)
    observers: Set[str] = field(default_factory=set)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        data = asdict(self)
        # Convert datetime objects to ISO strings and sets to lists
        for key, value in data.items():
            if isinstance(value, datetime):
                data[key] = value.isoformat()
            elif isinstance(value, set):
                data[key] = list(value)
        return data
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SessionData':
        """Create from dictionary."""
        # Convert ISO strings back to datetime objects
        datetime_fields = ['created_at', 'last_activity', 'expires_at']
        for field_name in datetime_fields:
            if field_name in data and data[field_name]:
                data[field_name] = datetime.fromisoformat(data[field_name])
        
        # Convert lists back to sets
        set_fields = ['participants', 'observers']
        for field_name in set_fields:
            if field_name in data and isinstance(data[field_name], list):
                data[field_name] = set(data[field_name])
        
        return cls(**data)


@dataclass
class SessionToken:
    """JWT session token structure."""
    token: str
    session_id: str
    user_id: str
    issued_at: datetime
    expires_at: datetime
    permissions: List[str] = field(default_factory=list)


class SessionHandler:
    """
    Handles individual user sessions with simulation state management.
    
    Features:
    - Session state isolation
    - Simulation state persistence
    - Activity tracking
    - Permission management
    - Session cleanup
    """
    
    def __init__(
        self,
        session_data: SessionData,
        redis_manager: RedisStateManager,
        user_manager: UserManager
    ):
        """
        Initialize session handler.
        
        Args:
            session_data: Session configuration
            redis_manager: Redis state manager
            user_manager: User manager instance
        """
        self.session_data = session_data
        self.redis_manager = redis_manager
        self.user_manager = user_manager
        self.lock = threading.RLock()
        
        # Key prefixes for Redis storage
        self.session_prefix = "psyche:session"
        self.state_prefix = f"{self.session_prefix}:state:{session_data.session_id}"
        
        # Initialize session state
        self._initialize_session_state()
    
    def _initialize_session_state(self):
        """Initialize session state in Redis."""
        try:
            # Store session metadata
            session_key = f"{self.session_prefix}:meta:{self.session_data.session_id}"
            self.redis_manager.store_agent_state(session_key, self.session_data.to_dict())
            
            # Initialize simulation state if not exists
            if not self.session_data.simulation_state:
                self.session_data.simulation_state = {
                    "current_situation": "Initial exploration of the psyche",
                    "iterations": 0,
                    "is_running": False,
                    "emergency_mode": False
                }
                self._persist_simulation_state()
            
            logger.info(f"Session initialized: {self.session_data.session_id}")
        except Exception as e:
            logger.error(f"Error initializing session state: {e}")
    
    def _persist_simulation_state(self):
        """Persist simulation state to Redis."""
        try:
            state_key = f"{self.state_prefix}:simulation"
            self.redis_manager.store_agent_state(state_key, self.session_data.simulation_state)
        except Exception as e:
            logger.error(f"Error persisting simulation state: {e}")
    
    def _persist_agent_states(self):
        """Persist agent states to Redis."""
        try:
            for agent_id, agent_state in self.session_data.agent_states.items():
                agent_key = f"{self.state_prefix}:agent:{agent_id}"
                self.redis_manager.store_agent_state(agent_key, agent_state)
        except Exception as e:
            logger.error(f"Error persisting agent states: {e}")
    
    def _update_activity(self):
        """Update last activity timestamp."""
        with self.lock:
            self.session_data.last_activity = datetime.now()
            session_key = f"{self.session_prefix}:meta:{self.session_data.session_id}"
            self.redis_manager.store_agent_state(session_key, self.session_data.to_dict())
    
    def _broadcast_session_update(self, event_type: str, data: Dict[str, Any]):
        """Broadcast session update via WebSocket events."""
        try:
            event_manager = get_event_manager()
            event_manager.emit_event(event_manager.create_system_status(
                status="healthy",
                active_agents=[],
                resource_usage={
                    "cpu_percent": 0.0,
                    "memory_percent": 0.0,
                    "memory_mb": 0,
                    "active_threads": 0
                }
            ))
            
            # Publish session-specific update
            self.redis_manager.publish_real_time_update(f"session:{self.session_data.session_id}", {
                "event_type": event_type,
                "data": data
            })
        except Exception as e:
            logger.error(f"Error broadcasting session update: {e}")
    
    def can_user_access(self, user_id: str, action: str = "read") -> bool:
        """
        Check if user can perform action on session.
        
        Args:
            user_id: User ID to check
            action: Action to check (read, write, admin)
            
        Returns:
            True if user has permission
        """
        with self.lock:
            # Session owner has full access
            if user_id == self.session_data.user_id:
                return True
            
            # Check user role
            user_profile = self.user_manager.get_user_by_id(user_id)
            if not user_profile:
                return False
            
            # Admin has full access
            if user_profile.role == UserRole.ADMIN:
                return True
            
            # Check session participants
            if user_id in self.session_data.participants:
                return action in ["read", "write"]
            
            # Check session observers
            if user_id in self.session_data.observers:
                return action == "read"
            
            # Researchers can observe shared sessions
            if (self.session_data.session_type == SessionType.SHARED and 
                user_profile.role == UserRole.RESEARCHER and 
                action == "read"):
                return True
            
            return False
    
    def update_simulation_state(self, user_id: str, updates: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Update simulation state.
        
        Args:
            user_id: User making the update
            updates: State updates
            
        Returns:
            Tuple of (success, message)
        """
        if not self.can_user_access(user_id, "write"):
            return False, "Insufficient permissions"
        
        try:
            with self.lock:
                self.session_data.simulation_state.update(updates)
                self._persist_simulation_state()
                self._update_activity()
                
                # Broadcast state update
                self._broadcast_session_update("simulation_state_updated", {
                    "session_id": self.session_data.session_id,
                    "updates": updates
                })
                
                return True, "Simulation state updated"
        except Exception as e:
            logger.error(f"Error updating simulation state: {e}")
            return False, "Failed to update simulation state"
    
    def update_agent_state(self, user_id: str, agent_id: str, state: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Update agent state.
        
        Args:
            user_id: User making the update
            agent_id: Agent ID
            state: Agent state data
            
        Returns:
            Tuple of (success, message)
        """
        if not self.can_user_access(user_id, "write"):
            return False, "Insufficient permissions"
        
        try:
            with self.lock:
                self.session_data.agent_states[agent_id] = state
                self._persist_agent_states()
                self._update_activity()
                
                # Broadcast agent state update
                self._broadcast_session_update("agent_state_updated", {
                    "session_id": self.session_data.session_id,
                    "agent_id": agent_id,
                    "state": state
                })
                
                return True, "Agent state updated"
        except Exception as e:
            logger.error(f"Error updating agent state: {e}")
            return False, "Failed to update agent state"
    
    def add_conversation_entry(self, user_id: str, entry: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Add conversation history entry.
        
        Args:
            user_id: User adding the entry
            entry: Conversation entry data
            
        Returns:
            Tuple of (success, message)
        """
        if not self.can_user_access(user_id, "write"):
            return False, "Insufficient permissions"
        
        try:
            with self.lock:
                entry["timestamp"] = datetime.now().isoformat()
                self.session_data.conversation_history.append(entry)
                
                # Keep only last 100 entries to prevent unbounded growth
                if len(self.session_data.conversation_history) > 100:
                    self.session_data.conversation_history = self.session_data.conversation_history[-100:]
                
                # Persist conversation history
                history_key = f"{self.state_prefix}:conversation"
                self.redis_manager.store_agent_state(history_key, {
                    "history": self.session_data.conversation_history
                })
                
                self._update_activity()
                
                # Broadcast conversation update
                self._broadcast_session_update("conversation_updated", {
                    "session_id": self.session_data.session_id,
                    "entry": entry
                })
                
                return True, "Conversation entry added"
        except Exception as e:
            logger.error(f"Error adding conversation entry: {e}")
            return False, "Failed to add conversation entry"
    
    def add_participant(self, user_id: str, participant_id: str) -> Tuple[bool, str]:
        """
        Add participant to session.
        
        Args:
            user_id: User making the request (must be owner or admin)
            participant_id: User ID to add as participant
            
        Returns:
            Tuple of (success, message)
        """
        if not self.can_user_access(user_id, "admin"):
            return False, "Insufficient permissions"
        
        try:
            with self.lock:
                self.session_data.participants.add(participant_id)
                self._update_activity()
                
                # Update session metadata in Redis
                session_key = f"{self.session_prefix}:meta:{self.session_data.session_id}"
                self.redis_manager.store_agent_state(session_key, self.session_data.to_dict())
                
                return True, "Participant added"
        except Exception as e:
            logger.error(f"Error adding participant: {e}")
            return False, "Failed to add participant"
    
    def add_observer(self, user_id: str, observer_id: str) -> Tuple[bool, str]:
        """
        Add observer to session.
        
        Args:
            user_id: User making the request (must be owner or admin)
            observer_id: User ID to add as observer
            
        Returns:
            Tuple of (success, message)
        """
        if not self.can_user_access(user_id, "admin"):
            return False, "Insufficient permissions"
        
        try:
            with self.lock:
                self.session_data.observers.add(observer_id)
                self._update_activity()
                
                # Update session metadata in Redis
                session_key = f"{self.session_prefix}:meta:{self.session_data.session_id}"
                self.redis_manager.store_agent_state(session_key, self.session_data.to_dict())
                
                return True, "Observer added"
        except Exception as e:
            logger.error(f"Error adding observer: {e}")
            return False, "Failed to add observer"
    
    def get_session_state(self, user_id: str) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """
        Get complete session state.
        
        Args:
            user_id: User requesting state
            
        Returns:
            Tuple of (success, message, state_data)
        """
        if not self.can_user_access(user_id, "read"):
            return False, "Insufficient permissions", None
        
        try:
            with self.lock:
                state_data = {
                    "session_info": self.session_data.to_dict(),
                    "simulation_state": self.session_data.simulation_state,
                    "agent_states": self.session_data.agent_states,
                    "network_state": self.session_data.network_state,
                    "conversation_history": self.session_data.conversation_history[-10:]  # Last 10 entries
                }
                
                self._update_activity()
                return True, "Session state retrieved", state_data
        except Exception as e:
            logger.error(f"Error getting session state: {e}")
            return False, "Failed to get session state", None
    
    def terminate_session(self, user_id: str) -> Tuple[bool, str]:
        """
        Terminate session.
        
        Args:
            user_id: User terminating session (must be owner or admin)
            
        Returns:
            Tuple of (success, message)
        """
        if not self.can_user_access(user_id, "admin"):
            return False, "Insufficient permissions"
        
        try:
            with self.lock:
                self.session_data.status = SessionStatus.TERMINATED
                
                # Update session metadata
                session_key = f"{self.session_prefix}:meta:{self.session_data.session_id}"
                self.redis_manager.store_agent_state(session_key, self.session_data.to_dict())
                
                # Broadcast session termination
                self._broadcast_session_update("session_terminated", {
                    "session_id": self.session_data.session_id
                })
                
                logger.info(f"Session terminated: {self.session_data.session_id}")
                return True, "Session terminated"
        except Exception as e:
            logger.error(f"Error terminating session: {e}")
            return False, "Failed to terminate session"


class SessionManager:
    """
    Manages multiple user sessions with JWT token support.
    
    Features:
    - Multi-user session creation and management
    - JWT token-based authentication
    - Session isolation and security
    - Session cleanup and timeout handling
    - Concurrent user support
    - Integration with WebSocket events
    """
    
    def __init__(
        self,
        redis_manager: Optional[RedisStateManager] = None,
        user_manager: Optional[UserManager] = None,
        jwt_secret: Optional[str] = None,
        session_timeout_hours: int = 24,
        cleanup_interval_minutes: int = 60
    ):
        """
        Initialize Session Manager.
        
        Args:
            redis_manager: Redis state manager
            user_manager: User manager instance
            jwt_secret: JWT signing secret
            session_timeout_hours: Session timeout in hours
            cleanup_interval_minutes: Cleanup interval in minutes
        """
        self.redis_manager = redis_manager or RedisStateManager()
        self.user_manager = user_manager or UserManager(self.redis_manager)
        self.jwt_secret = jwt_secret or secrets.token_urlsafe(32)
        self.session_timeout_hours = session_timeout_hours
        self.cleanup_interval_minutes = cleanup_interval_minutes
        
        # Initialize security components
        TokenBlacklist = _get_token_blacklist()
        self.token_blacklist = TokenBlacklist(self.redis_manager)
        
        JWTMiddleware = _get_jwt_middleware()
        self.jwt_middleware = JWTMiddleware(self, self.token_blacklist)
        
        PermissionManager = _get_permission_manager()
        self.permission_manager = PermissionManager(self.redis_manager, self.user_manager)
        
        AuditLogger = _get_audit_logger()
        self.audit_logger = AuditLogger(self.redis_manager, self.user_manager)
        
        # Active session handlers
        self.session_handlers: Dict[str, SessionHandler] = {}
        self.lock = threading.RLock()
        
        # Key prefixes
        self.session_prefix = "psyche:session"
        self.token_prefix = "psyche:session_token"
        
        # Start cleanup thread
        self.cleanup_running = True
        self.cleanup_thread = threading.Thread(target=self._cleanup_expired_sessions, daemon=True)
        self.cleanup_thread.start()
        
        logger.info("Session Manager initialized with security enhancements")
    
    def _generate_session_id(self) -> str:
        """Generate unique session ID."""
        return str(uuid.uuid4())
    
    def _generate_jwt_token(self, user_id: str, session_id: str, permissions: List[str]) -> str:
        """Generate JWT session token using security middleware."""
        return self.jwt_middleware.create_token({
            'user_id': user_id,
            'permissions': permissions,
            'session_id': session_id
        })
    
    def _verify_jwt_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Verify JWT session token using security middleware."""
        valid, message, token_info = self.jwt_middleware.validate_token(token)
        if valid:
            return token_info
        else:
            logger.warning(f"JWT token validation failed: {message}")
            return None
    
    def _cleanup_expired_sessions(self):
        """Background thread to cleanup expired sessions."""
        while self.cleanup_running:
            try:
                time.sleep(self.cleanup_interval_minutes * 60)
                self._perform_cleanup()
            except Exception as e:
                logger.error(f"Error in session cleanup: {e}")
    
    def _perform_cleanup(self):
        """Perform cleanup of expired sessions."""
        try:
            current_time = datetime.now()
            expired_sessions = []
            
            with self.lock:
                for session_id, handler in list(self.session_handlers.items()):
                    session_data = handler.session_data
                    
                    # Check if session is expired
                    if session_data.expires_at and current_time > session_data.expires_at:
                        expired_sessions.append(session_id)
                    # Check for inactive sessions
                    elif current_time - session_data.last_activity > timedelta(hours=self.session_timeout_hours):
                        expired_sessions.append(session_id)
            
            # Clean up expired sessions
            for session_id in expired_sessions:
                self._cleanup_session(session_id)
                logger.info(f"Cleaned up expired session: {session_id}")
                
        except Exception as e:
            logger.error(f"Error performing session cleanup: {e}")
    
    def _cleanup_session(self, session_id: str):
        """Clean up a specific session."""
        try:
            with self.lock:
                if session_id in self.session_handlers:
                    handler = self.session_handlers[session_id]
                    handler.session_data.status = SessionStatus.EXPIRED
                    
                    # Broadcast session expiration
                    handler._broadcast_session_update("session_expired", {
                        "session_id": session_id
                    })
                    
                    del self.session_handlers[session_id]
        except Exception as e:
            logger.error(f"Error cleaning up session {session_id}: {e}")
    
    async def create_session(
        self,
        user_id: str,
        session_type: SessionType = SessionType.SINGLE_USER,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, str, Optional[str], Optional[str]]:
        """
        Create new user session.
        
        Args:
            user_id: User ID creating the session
            session_type: Type of session
            metadata: Optional session metadata
            
        Returns:
            Tuple of (success, message, session_id, jwt_token)
        """
        try:
            # Verify user exists
            user_profile = self.user_manager.get_user_by_id(user_id)
            if not user_profile:
                return False, "User not found", None, None
            
            # Check user permissions for session type
            if session_type == SessionType.SHARED and user_profile.role == UserRole.OBSERVER:
                return False, "Insufficient permissions for shared session", None, None
            
            # Generate session ID
            session_id = self._generate_session_id()
            
            # Create session data
            session_data = SessionData(
                session_id=session_id,
                user_id=user_id,
                session_type=session_type,
                status=SessionStatus.ACTIVE,
                created_at=datetime.now(),
                last_activity=datetime.now(),
                expires_at=datetime.now() + timedelta(hours=self.session_timeout_hours),
                metadata=metadata or {}
            )
            
            # Create session handler
            handler = SessionHandler(session_data, self.redis_manager, self.user_manager)
            
            # Generate JWT token with enhanced permissions
            try:
                permissions = await self.permission_manager.get_user_permissions(user_id)
            except Exception:
                permissions = set()
            
            if not permissions:
                # Fallback to role-based permissions
                permissions = {"session.view", "session.create"}
                if user_profile.role == UserRole.ADMIN:
                    permissions.update(["admin.access", "user.manage"])
                elif user_profile.role == UserRole.RESEARCHER:
                    permissions.update(["data.export", "analysis.create"])
            
            jwt_token = self._generate_jwt_token(user_id, session_id, list(permissions))
            
            # Store session
            with self.lock:
                self.session_handlers[session_id] = handler
            
            # Store token in Redis for validation
            token_key = f"{self.token_prefix}:{session_id}"
            token_data = {
                "user_id": user_id,
                "session_id": session_id,
                "permissions": list(permissions) if isinstance(permissions, set) else permissions,
                "issued_at": datetime.now().isoformat()
            }
            self.redis_manager.store_agent_state(
                token_key, 
                token_data, 
                ttl=self.session_timeout_hours * 3600
            )
            
            # Log security event
            try:
                await _log_security_event(
                    self.audit_logger,
                    "session.created",
                    user_id=user_id,
                    details={
                        "session_id": session_id,
                        "session_type": session_type.value,
                        "permissions": list(permissions)
                    }
                )
            except Exception as e:
                logger.warning(f"Failed to log security event: {e}")
            
            logger.info(f"Session created: {session_id} for user {user_id}")
            return True, "Session created successfully", session_id, jwt_token
            
        except Exception as e:
            logger.error(f"Error creating session: {e}")
            return False, "Failed to create session", None, None
    
    def validate_session_token(self, token: str) -> Tuple[bool, str, Optional[str], Optional[str]]:
        """
        Validate JWT session token.
        
        Args:
            token: JWT token to validate
            
        Returns:
            Tuple of (valid, message, user_id, session_id)
        """
        try:
            payload = self._verify_jwt_token(token)
            if not payload:
                return False, "Invalid token", None, None
            
            user_id = payload.get("user_id")
            session_id = payload.get("session_id")
            
            if not user_id or not session_id:
                return False, "Invalid token payload", None, None
            
            # Check if session exists
            with self.lock:
                if session_id not in self.session_handlers:
                    return False, "Session not found", None, None
                
                handler = self.session_handlers[session_id]
                
                # Check session status
                if handler.session_data.status != SessionStatus.ACTIVE:
                    return False, f"Session is {handler.session_data.status.value}", None, None
            
            return True, "Token valid", user_id, session_id
            
        except Exception as e:
            logger.error(f"Error validating session token: {e}")
            return False, "Token validation failed", None, None
    
    def get_session_handler(self, session_id: str) -> Optional[SessionHandler]:
        """Get session handler by session ID."""
        with self.lock:
            return self.session_handlers.get(session_id)
    
    def list_user_sessions(self, user_id: str) -> List[Dict[str, Any]]:
        """
        List sessions for a user.
        
        Args:
            user_id: User ID
            
        Returns:
            List of session information
        """
        sessions = []
        try:
            with self.lock:
                for handler in self.session_handlers.values():
                    session_data = handler.session_data
                    
                    # Check if user has access to this session
                    if (session_data.user_id == user_id or
                        user_id in session_data.participants or 
                        user_id in session_data.observers):
                        
                        sessions.append({
                            "session_id": session_data.session_id,
                            "session_type": session_data.session_type.value,
                            "status": session_data.status.value,
                            "created_at": session_data.created_at.isoformat(),
                            "last_activity": session_data.last_activity.isoformat(),
                            "is_owner": session_data.user_id == user_id,
                            "participant_count": len(session_data.participants),
                            "observer_count": len(session_data.observers)
                        })
        except Exception as e:
            logger.error(f"Error listing user sessions: {e}")
        
        return sessions
    
    def terminate_session(self, session_id: str, user_id: str) -> Tuple[bool, str]:
        """
        Terminate a session.
        
        Args:
            session_id: Session ID to terminate
            user_id: User requesting termination
            
        Returns:
            Tuple of (success, message)
        """
        try:
            handler = self.get_session_handler(session_id)
            if not handler:
                return False, "Session not found"
            
            success, message = handler.terminate_session(user_id)
            
            if success:
                # Remove from active sessions
                with self.lock:
                    if session_id in self.session_handlers:
                        del self.session_handlers[session_id]
                
                # Remove token from Redis
                token_key = f"{self.token_prefix}:{session_id}"
                # Note: Redis doesn't have a direct delete method in our interface
                # In production, you'd want to implement a delete method
            
            return success, message
            
        except Exception as e:
            logger.error(f"Error terminating session: {e}")
            return False, "Failed to terminate session"
    
    def get_active_session_count(self) -> int:
        """Get count of active sessions."""
        with self.lock:
            return len([h for h in self.session_handlers.values() 
                       if h.session_data.status == SessionStatus.ACTIVE])
    
    def get_session_statistics(self) -> Dict[str, Any]:
        """Get session statistics."""
        try:
            with self.lock:
                stats = {
                    "total_sessions": len(self.session_handlers),
                    "active_sessions": 0,
                    "paused_sessions": 0,
                    "session_types": {},
                    "user_count": len(set(h.session_data.user_id for h in self.session_handlers.values()))
                }
                
                for handler in self.session_handlers.values():
                    status = handler.session_data.status.value
                    session_type = handler.session_data.session_type.value
                    
                    if status == "active":
                        stats["active_sessions"] += 1
                    elif status == "paused":
                        stats["paused_sessions"] += 1
                    
                    stats["session_types"][session_type] = stats["session_types"].get(session_type, 0) + 1
                
                return stats
        except Exception as e:
            logger.error(f"Error getting session statistics: {e}")
            return {}
    
    def shutdown(self):
        """Shutdown session manager."""
        try:
            self.cleanup_running = False
            if self.cleanup_thread and self.cleanup_thread.is_alive():
                self.cleanup_thread.join(timeout=5)
            
            # Terminate all active sessions
            with self.lock:
                for handler in self.session_handlers.values():
                    if handler.session_data.status == SessionStatus.ACTIVE:
                        handler.session_data.status = SessionStatus.TERMINATED
            
            logger.info("Session Manager shutdown complete")
        except Exception as e:
            logger.error(f"Error during session manager shutdown: {e}")


# Example usage and testing
if __name__ == "__main__":
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    # Create session manager
    session_manager = SessionManager()
    
    # Create a test user first
    user_manager = session_manager.user_manager
    success, message, user_id = user_manager.create_user(
        username="testuser",
        email="test@example.com",
        password="TestPass123!",
        role=UserRole.RESEARCHER
    )
    
    if success and user_id:
        # Create a session (Note: This would need to be run in an async context)
        import asyncio
        success, message, session_id, jwt_token = asyncio.run(session_manager.create_session(
            user_id=user_id,
            session_type=SessionType.SINGLE_USER
        ))
        
        if success:
            print(f"Session created: {session_id}")
            print(f"JWT Token: {jwt_token}")
            
            # Validate token
            valid, msg, token_user_id, token_session_id = session_manager.validate_session_token(jwt_token)
            if valid:
                print(f"Token validation successful: {token_user_id}, {token_session_id}")
                
                # Get session handler and test operations
                handler = session_manager.get_session_handler(session_id)
                if handler:
                    # Test simulation state update
                    success, msg = handler.update_simulation_state(user_id, {
                        "current_situation": "Testing multi-user session",
                        "iterations": 1
                    })
                    print(f"State update: {success}, {msg}")
                    
                    # Test getting session state
                    success, msg, state = handler.get_session_state(user_id)
                    if success:
                        print(f"Session state retrieved: {len(state)} keys")
            else:
                print(f"Token validation failed: {msg}")
        else:
            print(f"Session creation failed: {message}")
    else:
        print(f"User creation failed: {message}")
    
    # Shutdown
    session_manager.shutdown()