"""
Security Enhancement Module for Psyche Simulation

This module provides comprehensive security features including:
- JWT token validation and management
- Enhanced role-based access control with granular permissions
- Data encryption for sensitive information
- Security audit logging
- API security (rate limiting, input validation, CORS)
- Integration with existing authentication system
"""

from .auth_middleware import (
    JWTMiddleware,
    TokenBlacklist,
    require_auth,
    require_permission,
    validate_token
)

from .permissions import (
    Permission,
    PermissionManager,
    ResourcePermission,
    check_permission,
    has_permission
)

from .encryption import (
    DataEncryption,
    encrypt_data,
    decrypt_data,
    hash_sensitive_data,
    generate_encryption_key
)

from .audit_log import (
    AuditLogger,
    SecurityEvent,
    log_security_event,
    get_audit_trail,
    export_audit_logs
)

from .api_security import (
    RateLimiter,
    InputValidator,
    SecurityHeaders,
    CORSConfig,
    apply_security_middleware
)

__version__ = "1.0.0"
__all__ = [
    # JWT Middleware
    "JWTMiddleware",
    "TokenBlacklist", 
    "require_auth",
    "require_permission",
    "validate_token",
    
    # Permissions
    "Permission",
    "PermissionManager",
    "ResourcePermission",
    "check_permission",
    "has_permission",
    
    # Encryption
    "DataEncryption",
    "encrypt_data",
    "decrypt_data",
    "hash_sensitive_data",
    "generate_encryption_key",
    
    # Audit Logging
    "AuditLogger",
    "SecurityEvent",
    "log_security_event",
    "get_audit_trail",
    "export_audit_logs",
    
    # API Security
    "RateLimiter",
    "InputValidator", 
    "SecurityHeaders",
    "CORSConfig",
    "apply_security_middleware"
]