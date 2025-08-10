"""
Simple Audit Logger that handles both string and enum types safely.
"""

import logging
import json
from datetime import datetime
from typing import Dict, Any, Optional
from .events import SecurityEventType, EventStatus, EventSeverity

logger = logging.getLogger(__name__)


class SimpleAuditLogger:
    """Simple audit logger that safely handles enum and string values."""
    
    def __init__(self, redis_manager=None):
        self.redis_manager = redis_manager
    
    async def log_event(self, event_type, status=None, **kwargs):
        """
        Log a security event with safe enum handling.
        
        Args:
            event_type: Event type (string or enum)
            status: Event status (string or enum) 
            **kwargs: Additional event data
        """
        try:
            # Safely convert event_type to string
            if hasattr(event_type, 'value'):
                event_type_str = event_type.value
            else:
                event_type_str = str(event_type)
            
            # Safely convert status to string
            if status is not None:
                if hasattr(status, 'value'):
                    status_str = status.value
                else:
                    status_str = str(status)
            else:
                status_str = "success"
            
            # Create event data
            event_data = {
                'timestamp': datetime.utcnow().isoformat(),
                'event_type': event_type_str,
                'status': status_str,
                **kwargs
            }
            
            # Log the event
            logger.info(f"Security Event: {event_type_str} - {status_str}")
            
            # Store in Redis if available
            if self.redis_manager:
                key = f"psyche:audit:{int(datetime.utcnow().timestamp())}"
                self.redis_manager.store_agent_state(key, event_data, ttl=86400 * 30)  # 30 days
            
            return event_data
            
        except Exception as e:
            logger.error(f"Error storing audit event: {e}")
            return None


# Global instance
_audit_logger = None


def get_audit_logger(redis_manager=None):
    """Get or create the global audit logger."""
    global _audit_logger
    if _audit_logger is None:
        _audit_logger = SimpleAuditLogger(redis_manager)
    return _audit_logger


async def log_security_event(event_type, status=None, **kwargs):
    """Log a security event using the global audit logger."""
    try:
        audit_logger = get_audit_logger()
        return await audit_logger.log_event(event_type, status, **kwargs)
    except Exception as e:
        logger.error(f"Error logging security event: {e}")
        return None