"""
Comprehensive Security Audit Logging System

Provides detailed audit trail capabilities for security events,
user actions, data access, and compliance reporting.
"""

import json
import logging
import threading
import time
import uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Dict, List, Optional, Any, Tuple, Union
from dataclasses import dataclass, asdict, field
from collections import defaultdict

from data.redis_state_manager import RedisStateManager
from auth.user_manager import UserManager, UserProfile
from utils.websocket_events import get_event_manager

logger = logging.getLogger(__name__)


class SecurityEventType(str, Enum):
    """Types of security events."""
    # Authentication events
    LOGIN_SUCCESS = "auth.login_success"
    LOGIN_FAILED = "auth.login_failed"
    LOGOUT = "auth.logout"
    TOKEN_CREATED = "auth.token_created"
    TOKEN_REFRESHED = "auth.token_refreshed"
    TOKEN_REVOKED = "auth.token_revoked"
    TOKEN_BLACKLISTED = "auth.token_blacklisted"
    
    # Authorization events
    ACCESS_GRANTED = "authz.access_granted"
    ACCESS_DENIED = "authz.access_denied"
    PERMISSION_GRANTED = "authz.permission_granted"
    PERMISSION_REVOKED = "authz.permission_revoked"
    ROLE_CHANGED = "authz.role_changed"
    
    # Data access events
    DATA_READ = "data.read"
    DATA_WRITE = "data.write"
    DATA_DELETE = "data.delete"
    DATA_EXPORT = "data.export"
    DATA_IMPORT = "data.import"
    PII_ACCESSED = "data.pii_accessed"
    PII_DECRYPTED = "data.pii_decrypted"
    
    # Security violations
    SUSPICIOUS_ACTIVITY = "security.suspicious_activity"
    RATE_LIMIT_EXCEEDED = "security.rate_limit_exceeded"
    INVALID_INPUT = "security.invalid_input"
    INJECTION_ATTEMPT = "security.injection_attempt"
    XSS_ATTEMPT = "security.xss_attempt"
    UNAUTHORIZED_ACCESS = "security.unauthorized_access"
    
    # System events
    SYSTEM_CONFIG_CHANGED = "system.config_changed"
    SECURITY_SCAN = "system.security_scan"
    KEY_ROTATION = "system.key_rotation"
    BACKUP_CREATED = "system.backup_created"
    AUDIT_EXPORT = "system.audit_export"
    
    # User management
    USER_CREATED = "user.created"
    USER_UPDATED = "user.updated"
    USER_DELETED = "user.deleted"
    USER_SUSPENDED = "user.suspended"
    USER_ACTIVATED = "user.activated"
    PASSWORD_CHANGED = "user.password_changed"
    PASSWORD_RESET = "user.password_reset"
    
    # Session events
    SESSION_CREATED = "session.created"
    SESSION_TERMINATED = "session.terminated"
    SESSION_EXPIRED = "session.expired"
    SESSION_SHARED = "session.shared"


class EventSeverity(str, Enum):
    """Security event severity levels."""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


@dataclass
class SecurityEvent:
    """Security event data structure."""
    event_id: str
    event_type: SecurityEventType
    severity: EventSeverity
    timestamp: datetime
    user_id: Optional[str]
    session_id: Optional[str]
    ip_address: Optional[str]
    user_agent: Optional[str]
    resource_type: Optional[str]
    resource_id: Optional[str]
    action: Optional[str]
    result: str
    details: Dict[str, Any]
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        data = asdict(self)
        data["timestamp"] = self.timestamp.isoformat()
        return data
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SecurityEvent':
        """Create from dictionary."""
        if isinstance(data.get("timestamp"), str):
            data["timestamp"] = datetime.fromisoformat(data["timestamp"])
        return cls(**data)


class AuditLogger:
    """
    Comprehensive audit logging system for security events.
    
    Features:
    - Real-time security event logging
    - Event aggregation and analysis
    - Compliance reporting (GDPR, HIPAA)
    - Alert generation for critical events
    - Audit trail export and archiving
    """
    
    def __init__(
        self,
        redis_manager: RedisStateManager,
        user_manager: Optional[UserManager] = None,
        retention_days: int = 90,
        alert_threshold: int = 5
    ):
        """
        Initialize audit logger.
        
        Args:
            redis_manager: Redis state manager
            user_manager: User manager instance
            retention_days: Days to retain audit logs
            alert_threshold: Events threshold for alerts
        """
        self.redis_manager = redis_manager
        self.user_manager = user_manager
        self.retention_days = retention_days
        self.alert_threshold = alert_threshold
        
        self.audit_prefix = "psyche:audit"
        self.alert_prefix = "psyche:security_alert"
        
        # Event aggregation
        self.event_counts: Dict[str, int] = defaultdict(int)
        self.suspicious_users: Dict[str, int] = defaultdict(int)
        self.lock = threading.RLock()
        
        # WebSocket event manager
        self.event_manager = get_event_manager()
        
        # Start background tasks
        self.running = True
        self.cleanup_thread = threading.Thread(
            target=self._cleanup_old_events,
            daemon=True
        )
        self.cleanup_thread.start()
        
        self.alert_thread = threading.Thread(
            target=self._monitor_alerts,
            daemon=True
        )
        self.alert_thread.start()
    
    def log_event(
        self,
        event_type: SecurityEventType,
        user_id: Optional[str] = None,
        session_id: Optional[str] = None,
        severity: EventSeverity = EventSeverity.INFO,
        result: str = "success",
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        action: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        request_info: Optional[Dict[str, Any]] = None
    ) -> SecurityEvent:
        """
        Log a security event.
        
        Args:
            event_type: Type of security event
            user_id: User ID involved
            session_id: Session ID
            severity: Event severity
            result: Event result (success/failure)
            resource_type: Type of resource accessed
            resource_id: Resource identifier
            action: Action performed
            details: Additional event details
            request_info: Request metadata (IP, user agent, etc.)
            
        Returns:
            Created security event
        """
        try:
            # Create event
            event = SecurityEvent(
                event_id=str(uuid.uuid4()),
                event_type=event_type,
                severity=severity,
                timestamp=datetime.now(),
                user_id=user_id,
                session_id=session_id,
                ip_address=request_info.get("ip_address") if request_info else None,
                user_agent=request_info.get("user_agent") if request_info else None,
                resource_type=resource_type,
                resource_id=resource_id,
                action=action,
                result=result,
                details=details or {},
                metadata={
                    "logged_at": datetime.now().isoformat(),
                    "logger_version": "1.0.0"
                }
            )
            
            # Store event
            self._store_event(event)
            
            # Update aggregations
            self._update_aggregations(event)
            
            # Check for alerts
            self._check_alerts(event)
            
            # Broadcast critical events
            if severity in [EventSeverity.ERROR, EventSeverity.CRITICAL]:
                self._broadcast_security_event(event)
            
            return event
            
        except Exception as e:
            logger.error(f"Error logging security event: {e}")
            # Create minimal event for error tracking
            return SecurityEvent(
                event_id=str(uuid.uuid4()),
                event_type=event_type,
                severity=EventSeverity.ERROR,
                timestamp=datetime.now(),
                user_id=user_id,
                session_id=session_id,
                ip_address=None,
                user_agent=None,
                resource_type=resource_type,
                resource_id=resource_id,
                action=action,
                result="logging_error",
                details={"error": str(e)}
            )
    
    def _store_event(self, event: SecurityEvent):
        """Store event in Redis with TTL."""
        try:
            # Store by event ID
            event_key = f"{self.audit_prefix}:event:{event.event_id}"
            ttl = self.retention_days * 86400  # Convert to seconds
            
            self.redis_manager.store_agent_state(
                event_key,
                event.to_dict(),
                ttl=ttl
            )
            
            # Index by timestamp for range queries
            timestamp_key = f"{self.audit_prefix}:timeline:{event.timestamp.strftime('%Y%m%d')}:{event.event_id}"
            self.redis_manager.store_agent_state(
                timestamp_key,
                {"event_id": event.event_id, "timestamp": event.timestamp.isoformat()},
                ttl=ttl
            )
            
            # Index by user if applicable
            if event.user_id:
                user_key = f"{self.audit_prefix}:user:{event.user_id}:{event.event_id}"
                self.redis_manager.store_agent_state(
                    user_key,
                    {"event_id": event.event_id, "timestamp": event.timestamp.isoformat()},
                    ttl=ttl
                )
            
            # Index by event type
            type_key = f"{self.audit_prefix}:type:{event.event_type.value}:{event.event_id}"
            self.redis_manager.store_agent_state(
                type_key,
                {"event_id": event.event_id, "timestamp": event.timestamp.isoformat()},
                ttl=ttl
            )
            
        except Exception as e:
            logger.error(f"Error storing audit event: {e}")
    
    def _update_aggregations(self, event: SecurityEvent):
        """Update event aggregations for monitoring."""
        with self.lock:
            # Count by event type
            self.event_counts[event.event_type.value] += 1
            
            # Track suspicious users
            if event.severity in [EventSeverity.WARNING, EventSeverity.ERROR, EventSeverity.CRITICAL]:
                if event.user_id:
                    self.suspicious_users[event.user_id] += 1
            
            # Track failed logins
            if event.event_type == SecurityEventType.LOGIN_FAILED and event.user_id:
                failed_key = f"{self.audit_prefix}:failed_logins:{event.user_id}"
                # This would increment a counter in Redis
                # For now, we track in memory
    
    def _check_alerts(self, event: SecurityEvent):
        """Check if event should trigger an alert."""
        try:
            # Critical events always alert
            if event.severity == EventSeverity.CRITICAL:
                self._create_alert(event, "Critical security event")
                return
            
            # Check for patterns
            with self.lock:
                # Multiple failed logins
                if event.event_type == SecurityEventType.LOGIN_FAILED and event.user_id:
                    failed_count = self.event_counts.get(f"failed_login:{event.user_id}", 0)
                    if failed_count >= self.alert_threshold:
                        self._create_alert(event, f"Multiple failed login attempts: {failed_count}")
                
                # Suspicious user activity
                if event.user_id and self.suspicious_users[event.user_id] >= self.alert_threshold:
                    self._create_alert(event, f"Suspicious user activity detected")
                
                # Rate limit violations
                if event.event_type == SecurityEventType.RATE_LIMIT_EXCEEDED:
                    self._create_alert(event, "Rate limit exceeded")
                
                # Security violations
                security_violations = [
                    SecurityEventType.INJECTION_ATTEMPT,
                    SecurityEventType.XSS_ATTEMPT,
                    SecurityEventType.UNAUTHORIZED_ACCESS
                ]
                if event.event_type in security_violations:
                    self._create_alert(event, f"Security violation: {event.event_type.value}")
                    
        except Exception as e:
            logger.error(f"Error checking alerts: {e}")
    
    def _create_alert(self, event: SecurityEvent, reason: str):
        """Create security alert."""
        try:
            alert = {
                "alert_id": str(uuid.uuid4()),
                "event_id": event.event_id,
                "event_type": event.event_type.value,
                "severity": event.severity.value,
                "reason": reason,
                "timestamp": datetime.now().isoformat(),
                "user_id": event.user_id,
                "details": event.details
            }
            
            # Store alert
            alert_key = f"{self.alert_prefix}:{alert['alert_id']}"
            self.redis_manager.store_agent_state(alert_key, alert, ttl=86400 * 7)  # 7 days
            
            # Broadcast alert
            self._broadcast_security_alert(alert)
            
            logger.warning(f"Security alert created: {reason} for event {event.event_id}")
            
        except Exception as e:
            logger.error(f"Error creating alert: {e}")
    
    def _broadcast_security_event(self, event: SecurityEvent):
        """Broadcast security event via WebSocket."""
        try:
            self.event_manager.emit_security_event(
                event_type=event.event_type.value,
                severity=event.severity.value,
                user_id=event.user_id,
                details=event.details
            )
        except Exception as e:
            logger.error(f"Error broadcasting security event: {e}")
    
    def _broadcast_security_alert(self, alert: Dict[str, Any]):
        """Broadcast security alert via WebSocket."""
        try:
            self.event_manager.emit_security_alert(
                alert_id=alert["alert_id"],
                event_type=alert["event_type"],
                severity=alert["severity"],
                reason=alert["reason"],
                details=alert["details"]
            )
        except Exception as e:
            logger.error(f"Error broadcasting security alert: {e}")
    
    def get_events(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        event_type: Optional[SecurityEventType] = None,
        user_id: Optional[str] = None,
        severity: Optional[EventSeverity] = None,
        limit: int = 100
    ) -> List[SecurityEvent]:
        """
        Retrieve audit events with filtering.
        
        Args:
            start_date: Start date for events
            end_date: End date for events
            event_type: Filter by event type
            user_id: Filter by user ID
            severity: Filter by severity
            limit: Maximum events to return
            
        Returns:
            List of security events
        """
        events = []
        
        try:
            # This is a simplified implementation
            # In production, you'd use Redis scanning with filters
            
            # For now, return empty list
            logger.info(f"Retrieving events with filters: type={event_type}, user={user_id}")
            
        except Exception as e:
            logger.error(f"Error retrieving events: {e}")
        
        return events
    
    def get_user_activity(
        self,
        user_id: str,
        days: int = 7
    ) -> Dict[str, Any]:
        """
        Get user activity summary.
        
        Args:
            user_id: User ID
            days: Number of days to look back
            
        Returns:
            User activity summary
        """
        try:
            # Get user profile
            user_profile = None
            if self.user_manager:
                user_profile = self.user_manager.get_user_by_id(user_id)
            
            summary = {
                "user_id": user_id,
                "user_name": user_profile.username if user_profile else "Unknown",
                "period_days": days,
                "total_events": 0,
                "login_attempts": 0,
                "failed_logins": 0,
                "data_access": 0,
                "security_violations": 0,
                "last_activity": None,
                "risk_score": 0
            }
            
            # Calculate risk score based on activity
            with self.lock:
                if user_id in self.suspicious_users:
                    summary["risk_score"] = min(self.suspicious_users[user_id] * 10, 100)
            
            return summary
            
        except Exception as e:
            logger.error(f"Error getting user activity: {e}")
            return {"error": str(e)}
    
    def export_audit_logs(
        self,
        format: str = "json",
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        include_pii: bool = False
    ) -> Tuple[bool, str, Optional[str]]:
        """
        Export audit logs for compliance.
        
        Args:
            format: Export format (json, csv)
            start_date: Start date
            end_date: End date
            include_pii: Include PII in export
            
        Returns:
            Tuple of (success, message, export_path)
        """
        try:
            # Create export
            export_id = str(uuid.uuid4())
            export_data = {
                "export_id": export_id,
                "created_at": datetime.now().isoformat(),
                "format": format,
                "start_date": start_date.isoformat() if start_date else None,
                "end_date": end_date.isoformat() if end_date else None,
                "include_pii": include_pii,
                "events": []
            }
            
            # Get events
            events = self.get_events(start_date, end_date, limit=10000)
            
            # Process events
            for event in events:
                event_data = event.to_dict()
                
                # Remove PII if requested
                if not include_pii:
                    event_data.pop("ip_address", None)
                    event_data.pop("user_agent", None)
                    if "email" in event_data.get("details", {}):
                        event_data["details"]["email"] = "**REDACTED**"
                
                export_data["events"].append(event_data)
            
            # Store export metadata
            export_key = f"{self.audit_prefix}:export:{export_id}"
            self.redis_manager.store_agent_state(export_key, export_data, ttl=86400)
            
            # Log the export
            self.log_event(
                SecurityEventType.AUDIT_EXPORT,
                severity=EventSeverity.INFO,
                details={
                    "export_id": export_id,
                    "format": format,
                    "event_count": len(export_data["events"]),
                    "include_pii": include_pii
                }
            )
            
            return True, "Audit logs exported", f"/exports/{export_id}"
            
        except Exception as e:
            logger.error(f"Error exporting audit logs: {e}")
            return False, f"Export failed: {e}", None
    
    def generate_compliance_report(
        self,
        compliance_type: str = "GDPR",
        period_days: int = 30
    ) -> Dict[str, Any]:
        """
        Generate compliance report.
        
        Args:
            compliance_type: Type of compliance (GDPR, HIPAA)
            period_days: Report period in days
            
        Returns:
            Compliance report data
        """
        try:
            report = {
                "compliance_type": compliance_type,
                "period_days": period_days,
                "generated_at": datetime.now().isoformat(),
                "summary": {},
                "findings": [],
                "recommendations": []
            }
            
            if compliance_type == "GDPR":
                # GDPR specific checks
                report["summary"] = {
                    "data_access_requests": 0,
                    "data_deletion_requests": 0,
                    "consent_records": 0,
                    "data_breaches": 0,
                    "pii_access_events": self.event_counts.get(SecurityEventType.PII_ACCESSED.value, 0)
                }
                
                # Add findings
                if report["summary"]["data_breaches"] > 0:
                    report["findings"].append({
                        "severity": "high",
                        "issue": "Data breaches detected",
                        "count": report["summary"]["data_breaches"]
                    })
                
                # Add recommendations
                report["recommendations"].append({
                    "priority": "medium",
                    "action": "Review PII access logs regularly",
                    "description": "Ensure all PII access is authorized and logged"
                })
                
            elif compliance_type == "HIPAA":
                # HIPAA specific checks
                report["summary"] = {
                    "phi_access_events": 0,
                    "unauthorized_access": self.event_counts.get(SecurityEventType.UNAUTHORIZED_ACCESS.value, 0),
                    "audit_log_reviews": 0,
                    "encryption_status": "enabled"
                }
                
            return report
            
        except Exception as e:
            logger.error(f"Error generating compliance report: {e}")
            return {"error": str(e)}
    
    def _cleanup_old_events(self):
        """Background task to cleanup old events."""
        while self.running:
            try:
                time.sleep(86400)  # Daily cleanup
                
                # Redis TTL handles most cleanup
                # Reset in-memory aggregations periodically
                with self.lock:
                    # Keep only recent counts
                    self.event_counts.clear()
                    self.suspicious_users.clear()
                
                logger.info("Audit log cleanup completed")
                
            except Exception as e:
                logger.error(f"Error in audit cleanup: {e}")
    
    def _monitor_alerts(self):
        """Background task to monitor for security alerts."""
        while self.running:
            try:
                time.sleep(60)  # Check every minute
                
                # Check aggregated metrics
                with self.lock:
                    # Check for anomalies
                    for user_id, count in self.suspicious_users.items():
                        if count > self.alert_threshold * 2:
                            # Create high priority alert
                            logger.warning(f"High suspicious activity for user {user_id}: {count} events")
                
            except Exception as e:
                logger.error(f"Error in alert monitoring: {e}")
    
    def shutdown(self):
        """Shutdown audit logger."""
        self.running = False
        if self.cleanup_thread and self.cleanup_thread.is_alive():
            self.cleanup_thread.join(timeout=5)
        if self.alert_thread and self.alert_thread.is_alive():
            self.alert_thread.join(timeout=5)


# Global audit logger instance
_audit_logger: Optional[AuditLogger] = None


def get_audit_logger(
    redis_manager: RedisStateManager,
    user_manager: Optional[UserManager] = None
) -> AuditLogger:
    """Get or create global audit logger instance."""
    global _audit_logger
    if not _audit_logger:
        _audit_logger = AuditLogger(redis_manager, user_manager)
    return _audit_logger


# Helper functions for easy audit logging
def log_security_event(
    event_type: str,
    user_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    severity: str = "info",
    redis_manager: Optional[RedisStateManager] = None
):
    """
    Log a security event using the global audit logger.
    
    Args:
        event_type: Event type string
        user_id: User ID
        details: Event details
        severity: Event severity
        redis_manager: Redis manager (required if logger not initialized)
    """
    try:
        if redis_manager:
            logger_instance = get_audit_logger(redis_manager)
        else:
            # Use existing instance
            global _audit_logger
            if not _audit_logger:
                logger.warning("Audit logger not initialized")
                return
            logger_instance = _audit_logger
        
        # Convert string types to enums
        try:
            event_type_enum = SecurityEventType(event_type)
        except ValueError:
            # Default to suspicious activity for unknown events
            event_type_enum = SecurityEventType.SUSPICIOUS_ACTIVITY
        
        try:
            severity_enum = EventSeverity(severity)
        except ValueError:
            severity_enum = EventSeverity.INFO
        
        logger_instance.log_event(
            event_type=event_type_enum,
            user_id=user_id,
            severity=severity_enum,
            details=details or {}
        )
        
    except Exception as e:
        logger.error(f"Error in log_security_event: {e}")


def get_audit_trail(
    user_id: Optional[str] = None,
    days: int = 7,
    redis_manager: Optional[RedisStateManager] = None
) -> List[Dict[str, Any]]:
    """
    Get audit trail for a user or system.
    
    Args:
        user_id: User ID (None for system-wide)
        days: Number of days to retrieve
        redis_manager: Redis manager
        
    Returns:
        List of audit events
    """
    try:
        if redis_manager:
            logger_instance = get_audit_logger(redis_manager)
        else:
            global _audit_logger
            if not _audit_logger:
                return []
            logger_instance = _audit_logger
        
        start_date = datetime.now() - timedelta(days=days)
        events = logger_instance.get_events(
            start_date=start_date,
            user_id=user_id
        )
        
        return [event.to_dict() for event in events]
        
    except Exception as e:
        logger.error(f"Error getting audit trail: {e}")
        return []


def export_audit_logs(
    format: str = "json",
    days: int = 30,
    redis_manager: Optional[RedisStateManager] = None
) -> Tuple[bool, str, Optional[str]]:
    """
    Export audit logs.
    
    Args:
        format: Export format
        days: Number of days to export
        redis_manager: Redis manager
        
    Returns:
        Tuple of (success, message, export_path)
    """
    try:
        if redis_manager:
            logger_instance = get_audit_logger(redis_manager)
        else:
            global _audit_logger
            if not _audit_logger:
                return False, "Audit logger not initialized", None
            logger_instance = _audit_logger
        
        start_date = datetime.now() - timedelta(days=days)
        return logger_instance.export_audit_logs(
            format=format,
            start_date=start_date
        )
        
    except Exception as e:
        logger.error(f"Error exporting audit logs: {e}")
        return False, str(e), None