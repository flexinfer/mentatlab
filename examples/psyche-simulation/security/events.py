"""
Security Events and Status Enums
"""

from enum import Enum


class EventStatus(str, Enum):
    """Event status enumeration."""
    SUCCESS = "success"
    FAILURE = "failure"
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class SecurityEventType(str, Enum):
    """Security event types."""
    AUTHENTICATION_SUCCESS = "authentication_success"
    AUTHENTICATION_FAILURE = "authentication_failure"
    LOGIN_ATTEMPT = "login_attempt"
    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILED = "login_failed"
    LOGOUT = "logout"
    SESSION_CREATED = "session_created"
    SESSION_TERMINATED = "session_terminated"
    USER_CREATED = "user_created"
    USER_UPDATED = "user_updated"
    PASSWORD_CHANGED = "password_changed"
    SUSPICIOUS_ACTIVITY = "suspicious_activity"
    UNAUTHORIZED_ACCESS = "unauthorized_access"
    ACCESS_DENIED = "access_denied"
    PERMISSION_DENIED = "permission_denied"


class EventSeverity(str, Enum):
    """Event severity levels."""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"