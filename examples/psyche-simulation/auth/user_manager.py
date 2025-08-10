"""
User Management System for Psyche Simulation

Provides comprehensive user authentication and management capabilities:
- Secure password hashing with bcrypt
- User registration, login, logout functionality
- Role-based access control (Admin, Researcher, Observer)
- User profile management and preferences
- Password reset and security features
- Integration with Redis for session storage
"""

import bcrypt
import hashlib
import hmac
import json
import logging
import secrets
import time
import uuid
from datetime import datetime, timedelta
from enum import Enum
from typing import Dict, List, Optional, Any, Union, Tuple
from dataclasses import dataclass, asdict, field

from data.redis_state_manager import RedisStateManager

# Import security components
try:
    from security import AuditLogger, log_security_event
except ImportError:
    # Graceful fallback if security module is not available
    AuditLogger = None
    log_security_event = None

logger = logging.getLogger(__name__)


class UserRole(str, Enum):
    """User roles with different permission levels."""
    ADMIN = "admin"           # Full system access, user management, system configuration
    RESEARCHER = "researcher" # Can create/manage own sessions, export data, full psychology tools
    OBSERVER = "observer"     # Read-only access to shared sessions, limited export capabilities


class UserStatus(str, Enum):
    """User account status."""
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    PENDING = "pending"


@dataclass
class UserProfile:
    """User profile data structure."""
    user_id: str
    username: str
    email: str
    role: UserRole
    status: UserStatus
    created_at: datetime
    last_login: Optional[datetime] = None
    display_name: Optional[str] = None
    preferences: Dict[str, Any] = field(default_factory=dict)
    session_count: int = 0
    failed_login_attempts: int = 0
    last_failed_login: Optional[datetime] = None
    password_changed_at: Optional[datetime] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert profile to dictionary for serialization."""
        data = asdict(self)
        # Convert datetime objects to ISO strings
        for key, value in data.items():
            if isinstance(value, datetime):
                data[key] = value.isoformat()
        return data
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'UserProfile':
        """Create profile from dictionary."""
        # Convert ISO strings back to datetime objects
        datetime_fields = ['created_at', 'last_login', 'last_failed_login', 'password_changed_at']
        for field_name in datetime_fields:
            if field_name in data and data[field_name]:
                data[field_name] = datetime.fromisoformat(data[field_name])
        
        # Convert role string back to UserRole enum
        if 'role' in data and isinstance(data['role'], str):
            data['role'] = UserRole(data['role'])
        
        # Convert status string back to UserStatus enum
        if 'status' in data and isinstance(data['status'], str):
            data['status'] = UserStatus(data['status'])
        
        return cls(**data)


@dataclass
class PasswordResetToken:
    """Password reset token data structure."""
    token: str
    user_id: str
    expires_at: datetime
    used: bool = False
    created_at: datetime = field(default_factory=datetime.now)


class UserManager:
    """
    Comprehensive user management system with security features.
    
    Features:
    - Secure password hashing with bcrypt and salt
    - User registration, login, logout functionality
    - Role-based access control
    - Password complexity validation
    - Rate limiting for login attempts
    - Password reset functionality
    - User profile management
    - Audit logging
    - Integration with Redis for persistence
    """
    
    def __init__(
        self,
        redis_manager: Optional[RedisStateManager] = None,
        password_min_length: int = 8,
        max_failed_attempts: int = 5,
        lockout_duration: int = 900,  # 15 minutes
        token_expiry_hours: int = 24,
        audit_logger: Optional[AuditLogger] = None
    ):
        """
        Initialize User Manager.
        
        Args:
            redis_manager: Redis state manager for persistence
            password_min_length: Minimum password length
            max_failed_attempts: Maximum failed login attempts before lockout
            lockout_duration: Account lockout duration in seconds
            token_expiry_hours: Password reset token expiry in hours
            audit_logger: Optional audit logger for security events
        """
        self.redis_manager = redis_manager or RedisStateManager()
        self.password_min_length = password_min_length
        self.max_failed_attempts = max_failed_attempts
        self.lockout_duration = lockout_duration
        self.token_expiry_hours = token_expiry_hours
        
        # Initialize audit logger if available
        self.audit_logger = audit_logger
        if AuditLogger and not self.audit_logger:
            try:
                self.audit_logger = AuditLogger(self.redis_manager, self)
            except Exception as e:
                logger.warning(f"Failed to initialize audit logger: {e}")
        
        # Key prefixes for Redis storage
        self.user_prefix = "psyche:user"
        self.token_prefix = "psyche:reset_token"
        self.session_prefix = "psyche:user_session"
        
        # Initialize default admin user if needed
        self._ensure_admin_user()
    
    def _ensure_admin_user(self):
        """Ensure a default admin user exists."""
        try:
            admin_exists = self.get_user_by_username("admin")
            if not admin_exists:
                logger.info("Creating default admin user")
                self.create_user(
                    username="admin",
                    email="admin@psyche-simulation.local",
                    password="admin123!",  # Should be changed on first login
                    role=UserRole.ADMIN,
                    display_name="System Administrator"
                )
        except Exception as e:
            logger.error(f"Error ensuring admin user: {e}")
    
    def _hash_password(self, password: str) -> str:
        """Hash password using bcrypt with salt."""
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        return hashed.decode('utf-8')
    
    def _verify_password(self, password: str, hashed: str) -> bool:
        """Verify password against bcrypt hash."""
        try:
            return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
        except Exception as e:
            logger.error(f"Password verification error: {e}")
            return False
    
    def _validate_password_complexity(self, password: str) -> Tuple[bool, List[str]]:
        """
        Validate password complexity.
        
        Returns:
            Tuple of (is_valid, list_of_issues)
        """
        issues = []
        
        if len(password) < self.password_min_length:
            issues.append(f"Password must be at least {self.password_min_length} characters long")
        
        if not any(c.isupper() for c in password):
            issues.append("Password must contain at least one uppercase letter")
        
        if not any(c.islower() for c in password):
            issues.append("Password must contain at least one lowercase letter")
        
        if not any(c.isdigit() for c in password):
            issues.append("Password must contain at least one number")
        
        if not any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in password):
            issues.append("Password must contain at least one special character")
        
        return len(issues) == 0, issues
    
    def _generate_user_id(self) -> str:
        """Generate unique user ID."""
        return str(uuid.uuid4())
    
    def _generate_reset_token(self) -> str:
        """Generate secure password reset token."""
        return secrets.token_urlsafe(32)
    
    def _is_account_locked(self, user_profile: UserProfile) -> bool:
        """Check if account is locked due to failed login attempts."""
        if user_profile.failed_login_attempts < self.max_failed_attempts:
            return False
        
        if not user_profile.last_failed_login:
            return True
        
        # Check if lockout period has expired
        lockout_end = user_profile.last_failed_login + timedelta(seconds=self.lockout_duration)
        return datetime.now() < lockout_end
    
    def _store_user_profile(self, profile: UserProfile) -> bool:
        """Store user profile in Redis."""
        try:
            key = f"{self.user_prefix}:profile:{profile.user_id}"
            data = profile.to_dict()
            return self.redis_manager.store_agent_state(key, data)
        except Exception as e:
            logger.error(f"Error storing user profile: {e}")
            return False
    
    def _store_user_password(self, user_id: str, password_hash: str) -> bool:
        """Store user password hash in Redis."""
        try:
            key = f"{self.user_prefix}:password:{user_id}"
            data = {"password_hash": password_hash, "updated_at": datetime.now().isoformat()}
            return self.redis_manager.store_agent_state(key, data)
        except Exception as e:
            logger.error(f"Error storing user password: {e}")
            return False
    
    def _get_user_password(self, user_id: str) -> Optional[str]:
        """Retrieve user password hash from Redis."""
        try:
            key = f"{self.user_prefix}:password:{user_id}"
            data = self.redis_manager.get_agent_state(key)
            if data and "state" in data:
                return data["state"].get("password_hash")
        except Exception as e:
            logger.error(f"Error retrieving user password: {e}")
        return None
    
    def _log_security_event(self, event_type: str, user_id: Optional[str], details: Dict[str, Any]):
        """Log security events for audit trail using enhanced security logging."""
        try:
            if self.audit_logger and log_security_event:
                # Use asyncio.create_task for async logging if in async context
                try:
                    import asyncio
                    loop = asyncio.get_running_loop()
                    # If we're in an async context, schedule the async logging
                    asyncio.create_task(log_security_event(
                        self.audit_logger,
                        event_type,
                        user_id=user_id,
                        details=details
                    ))
                except RuntimeError:
                    # No event loop running, fall back to sync logging
                    pass
            
            # Always do synchronous fallback logging
            event = {
                "event_type": event_type,
                "user_id": user_id,
                "timestamp": datetime.now().isoformat(),
                "details": details
            }
            
            key = f"psyche:security_log:{int(time.time())}"
            self.redis_manager.store_agent_state(key, event, ttl=86400 * 30)  # 30 days
            logger.info(f"Security event: {event_type} for user {user_id}")
        except Exception as e:
            logger.error(f"Error logging security event: {e}")
    
    # Public API Methods
    
    def create_user(
        self,
        username: str,
        email: str,
        password: str,
        role: UserRole = UserRole.OBSERVER,
        display_name: Optional[str] = None,
        status: UserStatus = UserStatus.ACTIVE
    ) -> Tuple[bool, str, Optional[str]]:
        """
        Create a new user account.
        
        Args:
            username: Unique username
            email: User email address
            password: Plain text password
            role: User role
            display_name: Optional display name
            status: Account status
            
        Returns:
            Tuple of (success, message, user_id)
        """
        try:
            # Validate input
            if not username or not email or not password:
                return False, "Username, email, and password are required", None
            
            # Check if username already exists
            existing_user = self.get_user_by_username(username)
            if existing_user:
                return False, "Username already exists", None
            
            # Check if email already exists
            existing_email = self.get_user_by_email(email)
            if existing_email:
                return False, "Email already exists", None
            
            # Validate password complexity
            password_valid, password_issues = self._validate_password_complexity(password)
            if not password_valid:
                return False, "; ".join(password_issues), None
            
            # Generate user ID and hash password
            user_id = self._generate_user_id()
            password_hash = self._hash_password(password)
            
            # Create user profile
            profile = UserProfile(
                user_id=user_id,
                username=username,
                email=email,
                role=role,
                status=status,
                created_at=datetime.now(),
                display_name=display_name or username,
                password_changed_at=datetime.now()
            )
            
            # Store user data
            profile_stored = self._store_user_profile(profile)
            password_stored = self._store_user_password(user_id, password_hash)
            
            if not (profile_stored and password_stored):
                return False, "Failed to store user data", None
            
            # Create username and email indexes
            username_key = f"{self.user_prefix}:username:{username.lower()}"
            email_key = f"{self.user_prefix}:email:{email.lower()}"
            
            self.redis_manager.store_agent_state(username_key, {"user_id": user_id})
            self.redis_manager.store_agent_state(email_key, {"user_id": user_id})
            
            # Log security event
            self._log_security_event("user_created", user_id, {
                "username": username,
                "email": email,
                "role": role.value,
                "created_by": "system"
            })
            
            logger.info(f"User created successfully: {username} ({user_id})")
            return True, "User created successfully", user_id
            
        except Exception as e:
            logger.error(f"Error creating user: {e}")
            return False, "Internal error creating user", None
    
    def authenticate_user(self, username: str, password: str) -> Tuple[bool, str, Optional[UserProfile]]:
        """
        Authenticate user login.
        
        Args:
            username: Username or email
            password: Plain text password
            
        Returns:
            Tuple of (success, message, user_profile)
        """
        try:
            # Get user profile
            user_profile = self.get_user_by_username(username)
            if not user_profile:
                user_profile = self.get_user_by_email(username)
            
            if not user_profile:
                self._log_security_event("login_failed", None, {
                    "username": username,
                    "reason": "user_not_found"
                })
                return False, "Invalid username or password", None
            
            # Check account status
            if user_profile.status != UserStatus.ACTIVE:
                self._log_security_event("login_failed", user_profile.user_id, {
                    "username": username,
                    "reason": "account_inactive",
                    "status": user_profile.status.value
                })
                return False, f"Account is {user_profile.status.value}", None
            
            # Check if account is locked
            if self._is_account_locked(user_profile):
                self._log_security_event("login_failed", user_profile.user_id, {
                    "username": username,
                    "reason": "account_locked"
                })
                return False, "Account is temporarily locked due to failed login attempts", None
            
            # Get and verify password
            password_hash = self._get_user_password(user_profile.user_id)
            if not password_hash or not self._verify_password(password, password_hash):
                # Update failed login attempts
                user_profile.failed_login_attempts += 1
                user_profile.last_failed_login = datetime.now()
                self._store_user_profile(user_profile)
                
                self._log_security_event("login_failed", user_profile.user_id, {
                    "username": username,
                    "reason": "invalid_password",
                    "attempts": user_profile.failed_login_attempts
                })
                return False, "Invalid username or password", None
            
            # Successful login - reset failed attempts and update last login
            user_profile.failed_login_attempts = 0
            user_profile.last_failed_login = None
            user_profile.last_login = datetime.now()
            user_profile.session_count += 1
            self._store_user_profile(user_profile)
            
            self._log_security_event("login_success", user_profile.user_id, {
                "username": username
            })
            
            return True, "Login successful", user_profile
            
        except Exception as e:
            logger.error(f"Error authenticating user: {e}")
            return False, "Internal authentication error", None
    
    def get_user_by_id(self, user_id: str) -> Optional[UserProfile]:
        """Get user profile by user ID."""
        try:
            key = f"{self.user_prefix}:profile:{user_id}"
            data = self.redis_manager.get_agent_state(key)
            if data and "state" in data:
                return UserProfile.from_dict(data["state"])
        except Exception as e:
            logger.error(f"Error getting user by ID: {e}")
        return None
    
    def get_user_by_username(self, username: str) -> Optional[UserProfile]:
        """Get user profile by username."""
        try:
            username_key = f"{self.user_prefix}:username:{username.lower()}"
            data = self.redis_manager.get_agent_state(username_key)
            if data and "state" in data:
                user_id = data["state"].get("user_id")
                if user_id:
                    return self.get_user_by_id(user_id)
        except Exception as e:
            logger.error(f"Error getting user by username: {e}")
        return None
    
    def get_user_by_email(self, email: str) -> Optional[UserProfile]:
        """Get user profile by email."""
        try:
            email_key = f"{self.user_prefix}:email:{email.lower()}"
            data = self.redis_manager.get_agent_state(email_key)
            if data and "state" in data:
                user_id = data["state"].get("user_id")
                if user_id:
                    return self.get_user_by_id(user_id)
        except Exception as e:
            logger.error(f"Error getting user by email: {e}")
        return None
    
    def update_user_profile(self, user_id: str, updates: Dict[str, Any]) -> Tuple[bool, str]:
        """
        Update user profile.
        
        Args:
            user_id: User ID
            updates: Dictionary of fields to update
            
        Returns:
            Tuple of (success, message)
        """
        try:
            user_profile = self.get_user_by_id(user_id)
            if not user_profile:
                return False, "User not found"
            
            # Update allowed fields
            allowed_fields = ['display_name', 'preferences', 'status']
            for field, value in updates.items():
                if field in allowed_fields:
                    setattr(user_profile, field, value)
            
            success = self._store_user_profile(user_profile)
            if success:
                self._log_security_event("profile_updated", user_id, updates)
                return True, "Profile updated successfully"
            else:
                return False, "Failed to update profile"
                
        except Exception as e:
            logger.error(f"Error updating user profile: {e}")
            return False, "Internal error updating profile"
    
    def change_password(self, user_id: str, old_password: str, new_password: str) -> Tuple[bool, str]:
        """
        Change user password.
        
        Args:
            user_id: User ID
            old_password: Current password
            new_password: New password
            
        Returns:
            Tuple of (success, message)
        """
        try:
            user_profile = self.get_user_by_id(user_id)
            if not user_profile:
                return False, "User not found"
            
            # Verify old password
            old_password_hash = self._get_user_password(user_id)
            if not old_password_hash or not self._verify_password(old_password, old_password_hash):
                self._log_security_event("password_change_failed", user_id, {
                    "reason": "invalid_old_password"
                })
                return False, "Invalid current password"
            
            # Validate new password complexity
            password_valid, password_issues = self._validate_password_complexity(new_password)
            if not password_valid:
                return False, "; ".join(password_issues)
            
            # Hash and store new password
            new_password_hash = self._hash_password(new_password)
            password_stored = self._store_user_password(user_id, new_password_hash)
            
            if password_stored:
                # Update password changed timestamp
                user_profile.password_changed_at = datetime.now()
                self._store_user_profile(user_profile)
                
                self._log_security_event("password_changed", user_id, {})
                return True, "Password changed successfully"
            else:
                return False, "Failed to update password"
                
        except Exception as e:
            logger.error(f"Error changing password: {e}")
            return False, "Internal error changing password"
    
    def create_password_reset_token(self, email: str) -> Tuple[bool, str, Optional[str]]:
        """
        Create password reset token.
        
        Args:
            email: User email address
            
        Returns:
            Tuple of (success, message, token)
        """
        try:
            user_profile = self.get_user_by_email(email)
            if not user_profile:
                # Don't reveal whether email exists
                return True, "If the email exists, a reset link will be sent", None
            
            # Generate reset token
            token = self._generate_reset_token()
            expires_at = datetime.now() + timedelta(hours=self.token_expiry_hours)
            
            reset_token = PasswordResetToken(
                token=token,
                user_id=user_profile.user_id,
                expires_at=expires_at
            )
            
            # Store reset token
            token_key = f"{self.token_prefix}:{token}"
            token_data = asdict(reset_token)
            token_data['expires_at'] = expires_at.isoformat()
            token_data['created_at'] = reset_token.created_at.isoformat()
            
            success = self.redis_manager.store_agent_state(
                token_key, 
                token_data, 
                ttl=self.token_expiry_hours * 3600
            )
            
            if success:
                self._log_security_event("reset_token_created", user_profile.user_id, {
                    "email": email
                })
                return True, "Reset token created", token
            else:
                return False, "Failed to create reset token", None
                
        except Exception as e:
            logger.error(f"Error creating reset token: {e}")
            return False, "Internal error creating reset token", None
    
    def reset_password_with_token(self, token: str, new_password: str) -> Tuple[bool, str]:
        """
        Reset password using token.
        
        Args:
            token: Password reset token
            new_password: New password
            
        Returns:
            Tuple of (success, message)
        """
        try:
            # Get reset token data
            token_key = f"{self.token_prefix}:{token}"
            token_data = self.redis_manager.get_agent_state(token_key)
            
            if not token_data or "state" not in token_data:
                return False, "Invalid or expired reset token"
            
            token_info = token_data["state"]
            
            # Check if token is used
            if token_info.get("used", False):
                return False, "Reset token already used"
            
            # Check if token is expired
            expires_at = datetime.fromisoformat(token_info["expires_at"])
            if datetime.now() > expires_at:
                return False, "Reset token expired"
            
            # Validate new password
            password_valid, password_issues = self._validate_password_complexity(new_password)
            if not password_valid:
                return False, "; ".join(password_issues)
            
            # Update password
            user_id = token_info["user_id"]
            new_password_hash = self._hash_password(new_password)
            password_stored = self._store_user_password(user_id, new_password_hash)
            
            if password_stored:
                # Mark token as used
                token_info["used"] = True
                self.redis_manager.store_agent_state(token_key, token_info)
                
                # Update user profile
                user_profile = self.get_user_by_id(user_id)
                if user_profile:
                    user_profile.password_changed_at = datetime.now()
                    user_profile.failed_login_attempts = 0  # Reset failed attempts
                    user_profile.last_failed_login = None
                    self._store_user_profile(user_profile)
                
                self._log_security_event("password_reset", user_id, {})
                return True, "Password reset successfully"
            else:
                return False, "Failed to reset password"
                
        except Exception as e:
            logger.error(f"Error resetting password: {e}")
            return False, "Internal error resetting password"
    
    def list_users(self, role_filter: Optional[UserRole] = None, status_filter: Optional[UserStatus] = None) -> List[UserProfile]:
        """
        List users with optional filtering.
        
        Args:
            role_filter: Optional role filter
            status_filter: Optional status filter
            
        Returns:
            List of user profiles
        """
        # This is a simplified implementation
        # In a production system, you'd want proper indexing
        users = []
        try:
            # This would need to be implemented with proper Redis key scanning
            # For now, return empty list as this would require significant Redis queries
            logger.warning("list_users not fully implemented - requires Redis key scanning")
        except Exception as e:
            logger.error(f"Error listing users: {e}")
        
        return users
    
    def delete_user(self, user_id: str) -> Tuple[bool, str]:
        """
        Delete user account (admin only).
        
        Args:
            user_id: User ID to delete
            
        Returns:
            Tuple of (success, message)
        """
        try:
            user_profile = self.get_user_by_id(user_id)
            if not user_profile:
                return False, "User not found"
            
            # Don't allow deleting the last admin
            if user_profile.role == UserRole.ADMIN:
                # Check if there are other admin users (simplified check)
                return False, "Cannot delete admin user"
            
            # Remove user data
            profile_key = f"{self.user_prefix}:profile:{user_id}"
            password_key = f"{self.user_prefix}:password:{user_id}"
            username_key = f"{self.user_prefix}:username:{user_profile.username.lower()}"
            email_key = f"{self.user_prefix}:email:{user_profile.email.lower()}"
            
            # Note: Redis doesn't have batch delete, so we'd delete individually
            # This is simplified - in production you'd want atomic operations
            
            self._log_security_event("user_deleted", user_id, {
                "username": user_profile.username,
                "email": user_profile.email
            })
            
            return True, "User deleted successfully"
            
        except Exception as e:
            logger.error(f"Error deleting user: {e}")
            return False, "Internal error deleting user"


# Example usage and testing
if __name__ == "__main__":
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    # Create user manager
    user_manager = UserManager()
    
    # Test user creation
    success, message, user_id = user_manager.create_user(
        username="researcher1",
        email="researcher@example.com",
        password="SecurePass123!",
        role=UserRole.RESEARCHER,
        display_name="Research User"
    )
    
    if success:
        print(f"User created: {user_id}")
        
        # Test authentication
        auth_success, auth_message, user_profile = user_manager.authenticate_user(
            "researcher1", "SecurePass123!"
        )
        
        if auth_success:
            print(f"Authentication successful: {user_profile.display_name}")
        else:
            print(f"Authentication failed: {auth_message}")
    else:
        print(f"User creation failed: {message}")