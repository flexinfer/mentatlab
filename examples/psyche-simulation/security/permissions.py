"""
Enhanced Role-Based Access Control and Permissions System

Provides granular permission management beyond basic roles,
supporting resource-level permissions, permission inheritance,
and dynamic permission evaluation.
"""

import logging
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple, Any, Union
from dataclasses import dataclass, field
from datetime import datetime

from auth.user_manager import UserManager, UserProfile, UserRole
from data.redis_state_manager import RedisStateManager

logger = logging.getLogger(__name__)


class Permission(str, Enum):
    """Core system permissions."""
    # Session permissions
    SESSION_CREATE = "session.create"
    SESSION_READ = "session.read"
    SESSION_WRITE = "session.write"
    SESSION_DELETE = "session.delete"
    SESSION_SHARE = "session.share"
    SESSION_EXPORT = "session.export"
    
    # Agent permissions
    AGENT_READ = "agent.read"
    AGENT_WRITE = "agent.write"
    AGENT_CONFIGURE = "agent.configure"
    AGENT_RESET = "agent.reset"
    
    # Analysis permissions
    ANALYSIS_VIEW = "analysis.view"
    ANALYSIS_CREATE = "analysis.create"
    ANALYSIS_EXPORT = "analysis.export"
    ANALYSIS_DELETE = "analysis.delete"
    
    # User management permissions
    USER_CREATE = "user.create"
    USER_READ = "user.read"
    USER_UPDATE = "user.update"
    USER_DELETE = "user.delete"
    USER_MANAGE_ROLES = "user.manage_roles"
    
    # System permissions
    SYSTEM_CONFIG = "system.config"
    SYSTEM_MONITOR = "system.monitor"
    SYSTEM_AUDIT = "system.audit"
    SYSTEM_BACKUP = "system.backup"
    
    # Data permissions
    DATA_EXPORT = "data.export"
    DATA_IMPORT = "data.import"
    DATA_ANONYMIZE = "data.anonymize"
    DATA_DELETE = "data.delete"


class ResourceType(str, Enum):
    """Types of resources that can have permissions."""
    SESSION = "session"
    AGENT = "agent"
    ANALYSIS = "analysis"
    USER = "user"
    SYSTEM = "system"
    DATA = "data"


@dataclass
class ResourcePermission:
    """Permission for a specific resource instance."""
    resource_type: ResourceType
    resource_id: str
    permissions: Set[Permission]
    granted_by: str
    granted_at: datetime
    expires_at: Optional[datetime] = None
    conditions: Dict[str, Any] = field(default_factory=dict)
    
    def is_expired(self) -> bool:
        """Check if permission has expired."""
        if not self.expires_at:
            return False
        return datetime.now() > self.expires_at
    
    def has_permission(self, permission: Permission) -> bool:
        """Check if this resource permission includes a specific permission."""
        return permission in self.permissions and not self.is_expired()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "resource_type": self.resource_type.value,
            "resource_id": self.resource_id,
            "permissions": [p.value for p in self.permissions],
            "granted_by": self.granted_by,
            "granted_at": self.granted_at.isoformat(),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "conditions": self.conditions
        }


@dataclass
class PermissionRule:
    """Dynamic permission rule for complex access control."""
    name: str
    description: str
    permission: Permission
    conditions: Dict[str, Any]
    priority: int = 0
    
    def evaluate(self, context: Dict[str, Any]) -> bool:
        """
        Evaluate if rule conditions are met.
        
        Args:
            context: Evaluation context with user, resource, etc.
            
        Returns:
            True if conditions are satisfied
        """
        try:
            # Example condition evaluations
            for key, expected_value in self.conditions.items():
                if key == "time_range":
                    # Check if current time is within allowed range
                    current_hour = datetime.now().hour
                    start, end = expected_value.get("start", 0), expected_value.get("end", 24)
                    if not (start <= current_hour < end):
                        return False
                
                elif key == "ip_range":
                    # Check if request IP is in allowed range
                    user_ip = context.get("ip_address")
                    allowed_ips = expected_value
                    if user_ip and user_ip not in allowed_ips:
                        return False
                
                elif key == "resource_owner":
                    # Check if user owns the resource
                    if expected_value:
                        resource_owner = context.get("resource_owner")
                        user_id = context.get("user_id")
                        if resource_owner != user_id:
                            return False
                
                elif key == "max_usage":
                    # Check usage limits
                    current_usage = context.get("usage_count", 0)
                    if current_usage >= expected_value:
                        return False
            
            return True
            
        except Exception as e:
            logger.error(f"Error evaluating permission rule {self.name}: {e}")
            return False


class PermissionManager:
    """
    Manages granular permissions beyond basic roles.
    
    Features:
    - Resource-level permissions
    - Permission inheritance
    - Dynamic permission rules
    - Temporary permissions
    - Audit trail
    """
    
    # Default permissions for each role
    ROLE_PERMISSIONS = {
        UserRole.ADMIN: {
            # Admins get all permissions
            Permission.SESSION_CREATE,
            Permission.SESSION_READ,
            Permission.SESSION_WRITE,
            Permission.SESSION_DELETE,
            Permission.SESSION_SHARE,
            Permission.SESSION_EXPORT,
            Permission.AGENT_READ,
            Permission.AGENT_WRITE,
            Permission.AGENT_CONFIGURE,
            Permission.AGENT_RESET,
            Permission.ANALYSIS_VIEW,
            Permission.ANALYSIS_CREATE,
            Permission.ANALYSIS_EXPORT,
            Permission.ANALYSIS_DELETE,
            Permission.USER_CREATE,
            Permission.USER_READ,
            Permission.USER_UPDATE,
            Permission.USER_DELETE,
            Permission.USER_MANAGE_ROLES,
            Permission.SYSTEM_CONFIG,
            Permission.SYSTEM_MONITOR,
            Permission.SYSTEM_AUDIT,
            Permission.SYSTEM_BACKUP,
            Permission.DATA_EXPORT,
            Permission.DATA_IMPORT,
            Permission.DATA_ANONYMIZE,
            Permission.DATA_DELETE
        },
        UserRole.RESEARCHER: {
            # Researchers get most permissions except user/system management
            Permission.SESSION_CREATE,
            Permission.SESSION_READ,
            Permission.SESSION_WRITE,
            Permission.SESSION_DELETE,
            Permission.SESSION_SHARE,
            Permission.SESSION_EXPORT,
            Permission.AGENT_READ,
            Permission.AGENT_WRITE,
            Permission.AGENT_CONFIGURE,
            Permission.ANALYSIS_VIEW,
            Permission.ANALYSIS_CREATE,
            Permission.ANALYSIS_EXPORT,
            Permission.DATA_EXPORT,
            Permission.DATA_ANONYMIZE
        },
        UserRole.OBSERVER: {
            # Observers get read-only permissions
            Permission.SESSION_READ,
            Permission.AGENT_READ,
            Permission.ANALYSIS_VIEW,
            Permission.DATA_ANONYMIZE
        }
    }
    
    def __init__(
        self,
        redis_manager: RedisStateManager,
        user_manager: UserManager
    ):
        """
        Initialize permission manager.
        
        Args:
            redis_manager: Redis state manager
            user_manager: User manager instance
        """
        self.redis_manager = redis_manager
        self.user_manager = user_manager
        self.permission_prefix = "psyche:permissions"
        
        # Cache for performance
        self.permission_cache: Dict[str, Dict[str, ResourcePermission]] = {}
        self.rule_cache: Dict[str, List[PermissionRule]] = {}
        
        # Initialize default permission rules
        self._initialize_default_rules()
    
    def _initialize_default_rules(self):
        """Initialize default permission rules."""
        self.default_rules = [
            PermissionRule(
                name="own_session_full_access",
                description="Users have full access to their own sessions",
                permission=Permission.SESSION_WRITE,
                conditions={"resource_owner": True},
                priority=10
            ),
            PermissionRule(
                name="business_hours_only",
                description="Certain operations only during business hours",
                permission=Permission.DATA_EXPORT,
                conditions={"time_range": {"start": 8, "end": 18}},
                priority=5
            ),
            PermissionRule(
                name="export_rate_limit",
                description="Limit data exports per user",
                permission=Permission.DATA_EXPORT,
                conditions={"max_usage": 100},  # Max 100 exports per day
                priority=5
            )
        ]
    
    def get_user_permissions(
        self,
        user_id: str,
        include_expired: bool = False
    ) -> Set[Permission]:
        """
        Get all permissions for a user including role-based and granted.
        
        Args:
            user_id: User ID
            include_expired: Include expired permissions
            
        Returns:
            Set of permissions
        """
        try:
            # Get user profile
            user_profile = self.user_manager.get_user_by_id(user_id)
            if not user_profile:
                return set()
            
            # Start with role-based permissions
            permissions = self.ROLE_PERMISSIONS.get(user_profile.role, set()).copy()
            
            # Add resource-specific permissions
            resource_perms = self._get_user_resource_permissions(user_id)
            for resource_perm in resource_perms.values():
                if include_expired or not resource_perm.is_expired():
                    permissions.update(resource_perm.permissions)
            
            return permissions
            
        except Exception as e:
            logger.error(f"Error getting user permissions: {e}")
            return set()
    
    def has_permission(
        self,
        user_id: str,
        permission: Permission,
        resource_type: Optional[ResourceType] = None,
        resource_id: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Check if user has a specific permission.
        
        Args:
            user_id: User ID
            permission: Permission to check
            resource_type: Optional resource type
            resource_id: Optional resource ID
            context: Optional context for dynamic rules
            
        Returns:
            True if user has permission
        """
        try:
            # Get user profile
            user_profile = self.user_manager.get_user_by_id(user_id)
            if not user_profile:
                return False
            
            # Check role-based permissions first
            role_perms = self.ROLE_PERMISSIONS.get(user_profile.role, set())
            if permission in role_perms:
                return True
            
            # Check resource-specific permissions
            if resource_type and resource_id:
                resource_key = f"{resource_type.value}:{resource_id}"
                resource_perms = self._get_user_resource_permissions(user_id)
                
                if resource_key in resource_perms:
                    resource_perm = resource_perms[resource_key]
                    if resource_perm.has_permission(permission):
                        return True
            
            # Evaluate dynamic rules
            if context:
                context["user_id"] = user_id
                context["user_role"] = user_profile.role.value
                
                for rule in self.default_rules:
                    if rule.permission == permission and rule.evaluate(context):
                        return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error checking permission: {e}")
            return False
    
    def grant_permission(
        self,
        user_id: str,
        granted_by: str,
        permission: Union[Permission, List[Permission]],
        resource_type: Optional[ResourceType] = None,
        resource_id: Optional[str] = None,
        expires_at: Optional[datetime] = None,
        conditions: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Grant permission(s) to a user.
        
        Args:
            user_id: User to grant permission to
            granted_by: User granting the permission
            permission: Permission(s) to grant
            resource_type: Optional resource type
            resource_id: Optional resource ID
            expires_at: Optional expiration time
            conditions: Optional conditions
            
        Returns:
            Success status
        """
        try:
            # Verify granting user has permission to grant
            if not self.has_permission(granted_by, Permission.USER_MANAGE_ROLES):
                logger.warning(f"User {granted_by} lacks permission to grant permissions")
                return False
            
            # Convert single permission to list
            permissions = [permission] if isinstance(permission, Permission) else permission
            
            # Create resource permission
            if resource_type and resource_id:
                resource_key = f"{resource_type.value}:{resource_id}"
                
                resource_perm = ResourcePermission(
                    resource_type=resource_type,
                    resource_id=resource_id,
                    permissions=set(permissions),
                    granted_by=granted_by,
                    granted_at=datetime.now(),
                    expires_at=expires_at,
                    conditions=conditions or {}
                )
                
                # Store in Redis
                key = f"{self.permission_prefix}:user:{user_id}:resource:{resource_key}"
                ttl = None
                if expires_at:
                    ttl = int((expires_at - datetime.now()).total_seconds())
                
                success = self.redis_manager.store_agent_state(
                    key,
                    resource_perm.to_dict(),
                    ttl=ttl
                )
                
                if success:
                    # Update cache
                    if user_id not in self.permission_cache:
                        self.permission_cache[user_id] = {}
                    self.permission_cache[user_id][resource_key] = resource_perm
                    
                    # Log the grant
                    self._log_permission_change(
                        "permission_granted",
                        user_id,
                        granted_by,
                        permissions,
                        resource_type,
                        resource_id
                    )
                
                return success
            else:
                # Global permission grant would modify user role
                # This should be done through user_manager
                logger.warning("Global permission grants not supported - use role changes")
                return False
                
        except Exception as e:
            logger.error(f"Error granting permission: {e}")
            return False
    
    def revoke_permission(
        self,
        user_id: str,
        revoked_by: str,
        permission: Union[Permission, List[Permission]],
        resource_type: Optional[ResourceType] = None,
        resource_id: Optional[str] = None
    ) -> bool:
        """
        Revoke permission(s) from a user.
        
        Args:
            user_id: User to revoke permission from
            revoked_by: User revoking the permission
            permission: Permission(s) to revoke
            resource_type: Optional resource type
            resource_id: Optional resource ID
            
        Returns:
            Success status
        """
        try:
            # Verify revoking user has permission
            if not self.has_permission(revoked_by, Permission.USER_MANAGE_ROLES):
                logger.warning(f"User {revoked_by} lacks permission to revoke permissions")
                return False
            
            if resource_type and resource_id:
                resource_key = f"{resource_type.value}:{resource_id}"
                
                # Remove from cache
                if user_id in self.permission_cache:
                    self.permission_cache[user_id].pop(resource_key, None)
                
                # Remove from Redis (would need delete method)
                key = f"{self.permission_prefix}:user:{user_id}:resource:{resource_key}"
                # Note: Redis interface doesn't have delete
                
                # Log the revocation
                permissions = [permission] if isinstance(permission, Permission) else permission
                self._log_permission_change(
                    "permission_revoked",
                    user_id,
                    revoked_by,
                    permissions,
                    resource_type,
                    resource_id
                )
                
                return True
            
            return False
            
        except Exception as e:
            logger.error(f"Error revoking permission: {e}")
            return False
    
    def get_resource_permissions(
        self,
        resource_type: ResourceType,
        resource_id: str
    ) -> Dict[str, Set[Permission]]:
        """
        Get all users with permissions for a resource.
        
        Args:
            resource_type: Resource type
            resource_id: Resource ID
            
        Returns:
            Dict mapping user IDs to permissions
        """
        # This would require scanning Redis keys
        # In production, you'd maintain an index
        logger.warning("get_resource_permissions not fully implemented")
        return {}
    
    def check_resource_access(
        self,
        user_id: str,
        resource_type: ResourceType,
        resource_id: str,
        required_permission: Permission,
        context: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, str]:
        """
        Check if user can access a specific resource.
        
        Args:
            user_id: User ID
            resource_type: Resource type
            resource_id: Resource ID
            required_permission: Required permission
            context: Optional context
            
        Returns:
            Tuple of (has_access, reason)
        """
        try:
            # Check basic permission
            if self.has_permission(
                user_id,
                required_permission,
                resource_type,
                resource_id,
                context
            ):
                return True, "Permission granted"
            
            # Check if user is resource owner
            if context and context.get("resource_owner") == user_id:
                # Owners typically have more permissions
                owner_perms = {
                    ResourceType.SESSION: {
                        Permission.SESSION_READ,
                        Permission.SESSION_WRITE,
                        Permission.SESSION_DELETE
                    },
                    ResourceType.ANALYSIS: {
                        Permission.ANALYSIS_VIEW,
                        Permission.ANALYSIS_EXPORT,
                        Permission.ANALYSIS_DELETE
                    }
                }
                
                if required_permission in owner_perms.get(resource_type, set()):
                    return True, "Owner access granted"
            
            return False, f"Missing permission: {required_permission.value}"
            
        except Exception as e:
            logger.error(f"Error checking resource access: {e}")
            return False, "Permission check failed"
    
    def _get_user_resource_permissions(
        self,
        user_id: str
    ) -> Dict[str, ResourcePermission]:
        """Get cached resource permissions for user."""
        if user_id in self.permission_cache:
            return self.permission_cache[user_id]
        
        # Load from Redis
        # This would scan for permission keys
        # In production, maintain an index
        return {}
    
    def _log_permission_change(
        self,
        action: str,
        user_id: str,
        changed_by: str,
        permissions: List[Permission],
        resource_type: Optional[ResourceType],
        resource_id: Optional[str]
    ):
        """Log permission changes for audit trail."""
        try:
            from .audit_log import log_security_event
            
            log_security_event(action, changed_by, {
                "target_user": user_id,
                "permissions": [p.value for p in permissions],
                "resource_type": resource_type.value if resource_type else None,
                "resource_id": resource_id
            })
        except ImportError:
            logger.info(f"Permission change: {action} for {user_id} by {changed_by}")


# Helper functions for permission checking
def check_permission(
    user_id: str,
    permission: Permission,
    permission_manager: PermissionManager,
    resource_type: Optional[ResourceType] = None,
    resource_id: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Check if user has a specific permission.
    
    Args:
        user_id: User ID
        permission: Permission to check
        permission_manager: Permission manager instance
        resource_type: Optional resource type
        resource_id: Optional resource ID
        context: Optional context
        
    Returns:
        True if user has permission
    """
    return permission_manager.has_permission(
        user_id,
        permission,
        resource_type,
        resource_id,
        context
    )


def has_permission(
    user_profile: UserProfile,
    permission: Permission,
    resource_permissions: Optional[Dict[str, ResourcePermission]] = None
) -> bool:
    """
    Quick permission check for user profile.
    
    Args:
        user_profile: User profile
        permission: Permission to check
        resource_permissions: Optional resource permissions
        
    Returns:
        True if user has permission
    """
    # Check role-based permissions
    role_perms = PermissionManager.ROLE_PERMISSIONS.get(user_profile.role, set())
    if permission in role_perms:
        return True
    
    # Check resource permissions if provided
    if resource_permissions:
        for resource_perm in resource_permissions.values():
            if resource_perm.has_permission(permission):
                return True
    
    return False


# Permission checking decorators
def requires_permission(permission: Permission):
    """
    Decorator to require specific permission for a method.
    
    Usage:
        @requires_permission(Permission.SESSION_CREATE)
        def create_session(self, user_id: str):
            # Method implementation
    """
    def decorator(func):
        def wrapper(self, *args, **kwargs):
            # Extract user_id from args or kwargs
            user_id = kwargs.get('user_id') or (args[0] if args else None)
            
            if not user_id:
                raise ValueError("No user_id provided for permission check")
            
            # Get permission manager
            permission_manager = getattr(self, 'permission_manager', None)
            if not permission_manager:
                raise ValueError("No permission_manager available")
            
            # Check permission
            if not permission_manager.has_permission(user_id, permission):
                raise PermissionError(f"User {user_id} lacks permission: {permission.value}")
            
            return func(self, *args, **kwargs)
        
        return wrapper
    return decorator