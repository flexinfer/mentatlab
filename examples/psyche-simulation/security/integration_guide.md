# Security Integration Guide for Psyche Simulation

This guide provides step-by-step instructions for integrating the enhanced security features with the existing authentication system and API endpoints.

## Overview

The security enhancements have been integrated into the existing authentication system with backward compatibility. The integration includes:

- Enhanced JWT token management with blacklisting
- Granular permission system
- Comprehensive audit logging
- Data encryption capabilities
- API security middleware
- Real-time security event broadcasting

## Integration Status

### ✅ Completed Integrations

1. **Session Handler Integration** (`auth/session_handler.py`)
   - JWT middleware integration
   - Token blacklist support
   - Permission manager integration
   - Audit logging for session events
   - Enhanced token generation with permissions

2. **User Manager Integration** (`auth/user_manager.py`)
   - Audit logger integration
   - Enhanced security event logging
   - Graceful fallback for security components

### 🔄 Pending Integrations

The following integrations need to be completed to fully activate all security features:

## Step 1: API Endpoint Security Integration

### Flask/FastAPI Integration Example

```python
from flask import Flask, request, jsonify
from security import require_auth, require_permission, rate_limit
from security.api_security import apply_security_middleware, InputValidator

app = Flask(__name__)

# Apply security middleware
apply_security_middleware(app)

# Initialize input validator
input_validator = InputValidator()

@app.route('/api/sessions', methods=['POST'])
@require_auth
@require_permission('session.create')
@rate_limit(limit_type="general")
def create_session():
    """Create a new simulation session with security."""
    try:
        # Validate input
        data = request.get_json()
        validation = input_validator.validate_input(data.get('session_name', ''), 'session_name')
        if not validation['is_valid']:
            return jsonify({'error': 'Invalid input', 'details': validation['errors']}), 400
        
        # Your existing session creation logic here
        # ...
        
        return jsonify({'success': True, 'session_id': session_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/sessions/<session_id>', methods=['GET'])
@require_auth
@require_permission('session.view')
@rate_limit(limit_type="general")
def get_session(session_id):
    """Get session data with security validation."""
    # Validate session_id
    validation = input_validator.validate_input(session_id, 'uuid')
    if not validation['is_valid']:
        return jsonify({'error': 'Invalid session ID'}), 400
    
    # Your existing session retrieval logic here
    # ...
    
    return jsonify({'session_data': session_data})
```

### Required Dependencies

Add to your requirements.txt:
```
cryptography>=3.4.8
redis>=4.0.0
bcrypt>=3.2.0
PyJWT>=2.4.0
```

## Step 2: WebSocket Security Event Integration

### WebSocket Event Handler Setup

```python
from utils.websocket_broadcaster import WebSocketBroadcaster
from security import AuditLogger

class SecurityWebSocketHandler:
    def __init__(self, redis_manager, ws_broadcaster):
        self.redis_manager = redis_manager
        self.ws_broadcaster = ws_broadcaster
        self.audit_logger = AuditLogger(redis_manager, None)
    
    async def handle_security_event(self, event_type, user_id, details):
        """Handle and broadcast security events."""
        # Log the event
        await self.audit_logger.log_event(
            event_type=event_type,
            user_id=user_id,
            details=details
        )
        
        # Broadcast to relevant users
        security_alert = {
            'type': 'security_alert',
            'event_type': event_type,
            'severity': self._get_event_severity(event_type),
            'message': self._format_security_message(event_type, details),
            'timestamp': datetime.utcnow().isoformat()
        }
        
        await self.ws_broadcaster.broadcast_to_admins(security_alert)
    
    def _get_event_severity(self, event_type):
        """Determine event severity level."""
        high_severity = [
            'auth.multiple_failed_attempts',
            'auth.suspicious_activity',
            'permission.escalation_attempt',
            'security.injection_attempt'
        ]
        
        if event_type in high_severity:
            return 'high'
        elif 'failed' in event_type or 'denied' in event_type:
            return 'medium'
        else:
            return 'low'
```

## Step 3: Database Schema Updates

### Redis Key Structure

The security system uses the following Redis key patterns:

```
# JWT Token Blacklist
jwt:blacklist:{token_id}

# User Permissions
permissions:user:{user_id}
permissions:resource:{resource_id}:{user_id}

# Rate Limiting
rate_limit:{limit_type}:{client_id}
rate_limit:endpoint:{endpoint}:{client_id}

# Audit Logs
audit:event:{timestamp}:{event_id}
audit:user:{user_id}:{timestamp}

# Encryption Keys
encryption:key:{key_id}
encryption:metadata:{data_id}
```

## Step 4: Environment Configuration

### Security Configuration

Create or update your `.env` file:

```env
# JWT Configuration
JWT_SECRET_KEY=your-super-secure-jwt-secret-key-here
JWT_EXPIRATION_HOURS=24

# Encryption Configuration
ENCRYPTION_KEY=your-aes-256-encryption-key-here
ENCRYPTION_ALGORITHM=AES-256-GCM

# Rate Limiting
RATE_LIMIT_GENERAL=10
RATE_LIMIT_AUTH=5
RATE_LIMIT_WINDOW=60

# Audit Logging
AUDIT_LOG_RETENTION_DAYS=90
AUDIT_LOG_LEVEL=INFO

# Security Headers
SECURITY_HEADERS_ENABLED=true
CORS_ORIGINS=https://your-frontend-domain.com

# Redis Configuration
REDIS_URL=redis://localhost:6379/0
REDIS_PASSWORD=your-redis-password
```

## Step 5: Permission System Setup

### Initialize User Permissions

```python
import asyncio
from security import PermissionManager
from auth.user_manager import UserManager, UserRole
from data.redis_state_manager import RedisStateManager

async def setup_default_permissions():
    """Setup default permissions for existing users."""
    redis_manager = RedisStateManager()
    user_manager = UserManager(redis_manager)
    permission_manager = PermissionManager(redis_manager, user_manager)
    
    # Define role-based permissions
    role_permissions = {
        UserRole.ADMIN: [
            'admin.access', 'user.manage', 'session.create', 'session.view',
            'session.delete', 'data.export', 'system.configure', 'audit.view'
        ],
        UserRole.RESEARCHER: [
            'session.create', 'session.view', 'data.export', 'analysis.create',
            'agent.create', 'agent.manage'
        ],
        UserRole.OBSERVER: [
            'session.view', 'data.view'
        ]
    }
    
    # Apply permissions to existing users
    # Note: This would require implementing user enumeration
    # users = user_manager.list_users()  # Need to implement this
    # for user in users:
    #     permissions = role_permissions.get(user.role, [])
    #     for permission in permissions:
    #         await permission_manager.grant_permission(user.user_id, permission)

# Run setup
# asyncio.run(setup_default_permissions())
```

## Step 6: Monitoring and Alerting Setup

### Security Metrics Collection

```python
from utils.performance_monitor import PerformanceMonitor
from security import AuditLogger

class SecurityMonitor:
    def __init__(self, redis_manager, performance_monitor):
        self.redis_manager = redis_manager
        self.performance_monitor = performance_monitor
        self.audit_logger = AuditLogger(redis_manager, None)
    
    async def collect_security_metrics(self):
        """Collect security-related metrics."""
        with self.performance_monitor.track_operation("security.metrics_collection"):
            metrics = {
                'failed_logins_last_hour': await self._count_failed_logins(),
                'active_sessions': await self._count_active_sessions(),
                'rate_limit_violations': await self._count_rate_limit_violations(),
                'suspicious_activities': await self._count_suspicious_activities()
            }
            
            # Store metrics for dashboard
            self.redis_manager.store_agent_state(
                f"security:metrics:{int(time.time())}",
                metrics,
                ttl=86400  # 24 hours
            )
            
            # Check for alerts
            await self._check_security_alerts(metrics)
    
    async def _check_security_alerts(self, metrics):
        """Check metrics against alert thresholds."""
        alerts = []
        
        if metrics['failed_logins_last_hour'] > 50:
            alerts.append({
                'type': 'high_failed_login_rate',
                'severity': 'high',
                'message': f"High failed login rate detected: {metrics['failed_logins_last_hour']} in last hour"
            })
        
        if metrics['rate_limit_violations'] > 100:
            alerts.append({
                'type': 'high_rate_limit_violations',
                'severity': 'medium',
                'message': f"High rate limit violations: {metrics['rate_limit_violations']}"
            })
        
        # Send alerts via WebSocket or email
        for alert in alerts:
            await self._send_security_alert(alert)
```

## Step 7: Testing Security Integration

### Unit Tests

Create `tests/test_security_integration.py`:

```python
import pytest
import asyncio
from auth.session_handler import SessionManager
from auth.user_manager import UserManager, UserRole
from security import PermissionManager, AuditLogger

@pytest.mark.asyncio
async def test_session_creation_with_security():
    """Test session creation with enhanced security."""
    session_manager = SessionManager()
    
    # Create test user
    success, message, user_id = session_manager.user_manager.create_user(
        username="testuser",
        email="test@example.com",
        password="TestPass123!",
        role=UserRole.RESEARCHER
    )
    
    assert success, f"User creation failed: {message}"
    
    # Create session with security
    success, message, session_id, jwt_token = await session_manager.create_session(
        user_id=user_id,
        session_type=SessionType.SINGLE_USER
    )
    
    assert success, f"Session creation failed: {message}"
    assert jwt_token is not None
    assert session_id is not None
    
    # Validate token
    valid, msg, token_user_id, token_session_id = session_manager.validate_session_token(jwt_token)
    assert valid, f"Token validation failed: {msg}"
    assert token_user_id == user_id
    assert token_session_id == session_id

@pytest.mark.asyncio
async def test_permission_enforcement():
    """Test permission system enforcement."""
    redis_manager = RedisStateManager()
    user_manager = UserManager(redis_manager)
    permission_manager = PermissionManager(redis_manager, user_manager)
    
    # Create test user
    success, message, user_id = user_manager.create_user(
        username="testuser2",
        email="test2@example.com",
        password="TestPass123!",
        role=UserRole.OBSERVER
    )
    
    assert success
    
    # Test permission check
    has_permission = await permission_manager.check_permission(user_id, "admin.access")
    assert not has_permission, "Observer should not have admin access"
    
    # Grant permission
    await permission_manager.grant_permission(user_id, "admin.access")
    has_permission = await permission_manager.check_permission(user_id, "admin.access")
    assert has_permission, "Permission should be granted"
```

### Integration Tests

```python
@pytest.mark.asyncio
async def test_full_security_workflow():
    """Test complete security workflow."""
    # Initialize components
    redis_manager = RedisStateManager()
    session_manager = SessionManager(redis_manager)
    
    # Create user and session
    success, message, user_id = session_manager.user_manager.create_user(
        username="integrationtest",
        email="integration@example.com",
        password="IntegrationTest123!",
        role=UserRole.RESEARCHER
    )
    
    # Create session
    success, message, session_id, jwt_token = await session_manager.create_session(
        user_id=user_id
    )
    
    # Verify audit log entry
    audit_events = await session_manager.audit_logger.get_user_events(user_id, limit=1)
    assert len(audit_events) > 0
    assert audit_events[0]['event_type'] == 'session.created'
    
    # Test token blacklisting
    await session_manager.token_blacklist.blacklist_token(jwt_token, "test_logout")
    
    # Verify token is blacklisted
    valid, message, _ = session_manager.jwt_middleware.validate_token(jwt_token)
    assert not valid
    assert "blacklisted" in message.lower()
```

## Step 8: Deployment Checklist

### Pre-Deployment

- [ ] All security environment variables configured
- [ ] Redis security settings enabled (AUTH, SSL if needed)
- [ ] Security tests passing
- [ ] Rate limiting thresholds configured
- [ ] CORS origins properly set
- [ ] JWT secrets are cryptographically secure
- [ ] Encryption keys are properly generated and stored
- [ ] Audit log retention policy configured

### Post-Deployment

- [ ] Security monitoring dashboard operational
- [ ] Alert notifications working
- [ ] Audit logs being generated
- [ ] Rate limiting functioning
- [ ] JWT token validation working
- [ ] Permission system enforcing access control
- [ ] WebSocket security events broadcasting

## Troubleshooting

### Common Issues

1. **ImportError: No module named 'security'**
   - Ensure the security module is in your Python path
   - Verify all security dependencies are installed

2. **Redis connection errors**
   - Check Redis server is running
   - Verify Redis connection parameters
   - Ensure Redis AUTH is configured if using password

3. **JWT token validation failures**
   - Verify JWT_SECRET_KEY is consistent across instances
   - Check token expiration settings
   - Ensure clock synchronization between servers

4. **Permission denied errors**
   - Verify user permissions are properly set
   - Check permission inheritance rules
   - Ensure permission cache is updated

### Debugging Tools

```python
# Enable debug logging
import logging
logging.getLogger('security').setLevel(logging.DEBUG)
logging.getLogger('auth').setLevel(logging.DEBUG)

# Test security components
from security.debug import SecurityDebugger
debugger = SecurityDebugger(redis_manager)
await debugger.run_diagnostics()
```

## Support

For additional support with security integration:

1. Check the security module documentation: `security/README.md`
2. Review the integration example: `examples/security_integration_demo.py`
3. Run the security test suite: `python -m pytest tests/test_security_integration.py`
4. Enable debug logging for detailed troubleshooting

## Security Best Practices

1. **Regular Security Audits**
   - Review audit logs weekly
   - Monitor failed authentication attempts
   - Check for suspicious access patterns

2. **Key Management**
   - Rotate encryption keys every 90 days
   - Use strong, unique JWT secrets
   - Store keys securely (environment variables, key management service)

3. **Access Control**
   - Follow principle of least privilege
   - Regularly review user permissions
   - Implement approval workflows for sensitive operations

4. **Monitoring**
   - Set up alerting for security events
   - Monitor system resource usage
   - Track API response times and error rates

5. **Updates and Patches**
   - Keep security dependencies updated
   - Monitor security advisories
   - Test security updates in staging environment first