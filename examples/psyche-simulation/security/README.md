# Security Enhancement Module for Psyche Simulation

This module provides comprehensive enterprise-grade security features for the Psyche Simulation system, implementing industry best practices and standards.

## Overview

The security module enhances the existing authentication system with:
- Advanced JWT token management with blacklisting
- Granular role-based access control (RBAC)
- Data encryption for sensitive information
- Comprehensive audit logging
- API security features (rate limiting, input validation, CORS)

## Components

### 1. JWT Token Management (`auth_middleware.py`)
- **Token Blacklisting**: Secure logout and token revocation
- **Token Refresh**: Automatic token refresh with rotation
- **Multi-device Management**: Track and limit concurrent devices
- **Suspicious Activity Detection**: Monitor for unusual access patterns

### 2. Enhanced Permissions (`permissions.py`)
- **Granular Permissions**: Beyond basic roles (read, write, admin, export, etc.)
- **Resource-Level Access**: Control access to specific resources
- **Dynamic Permission Rules**: Context-aware permission evaluation
- **Permission Inheritance**: Hierarchical permission structure

### 3. Data Encryption (`encryption.py`)
- **AES-256 Encryption**: Industry-standard encryption for data at rest
- **Field-Level Encryption**: Encrypt specific sensitive fields
- **PII Protection**: Automatic encryption of personally identifiable information
- **Key Rotation**: Support for periodic key rotation
- **Data Anonymization**: Privacy-preserving data analytics

### 4. Audit Logging (`audit_log.py`)
- **Comprehensive Event Tracking**: All security-relevant events logged
- **Real-time Alerts**: Immediate notification of critical events
- **Compliance Reporting**: GDPR and HIPAA compliance reports
- **Event Aggregation**: Pattern detection and anomaly identification
- **Export Capabilities**: Audit trail export for external analysis

### 5. API Security (`api_security.py`)
- **Rate Limiting**: Multi-tier rate limiting with burst protection
- **Input Validation**: SQL injection and XSS prevention
- **Security Headers**: CSP, HSTS, X-Frame-Options, etc.
- **CORS Configuration**: Flexible cross-origin resource sharing
- **Request Sanitization**: Automatic input sanitization

## Security Standards Compliance

### OWASP Top 10 Protection
- **Injection**: Input validation and parameterized queries
- **Broken Authentication**: JWT with secure token management
- **Sensitive Data Exposure**: Encryption at rest and in transit
- **XML External Entities**: Input validation and sanitization
- **Broken Access Control**: RBAC with resource-level permissions
- **Security Misconfiguration**: Secure defaults and headers
- **Cross-Site Scripting**: Input sanitization and CSP
- **Insecure Deserialization**: Type validation and sanitization
- **Using Components with Known Vulnerabilities**: Regular updates
- **Insufficient Logging**: Comprehensive audit logging

### Industry Standards
- **Encryption**: AES-256 for data, bcrypt for passwords
- **Key Management**: Secure key storage and rotation
- **Session Management**: Secure session handling with timeouts
- **Access Control**: Principle of least privilege
- **Audit Trail**: Immutable audit logs with retention

## Integration Guide

### 1. Basic Setup
```python
from data.redis_state_manager import RedisStateManager
from auth.user_manager import UserManager
from auth.session_handler import SessionManager
from security import (
    JWTMiddleware, TokenBlacklist,
    PermissionManager,
    DataEncryption,
    AuditLogger,
    RateLimiter, apply_security_middleware
)

# Initialize Redis
redis_manager = RedisStateManager()

# Initialize security components
token_blacklist = TokenBlacklist(redis_manager)
jwt_middleware = JWTMiddleware(session_manager, token_blacklist)
permission_manager = PermissionManager(redis_manager, user_manager)
encryption = DataEncryption(redis_manager)
audit_logger = AuditLogger(redis_manager, user_manager)
```

### 2. Protecting API Endpoints
```python
from security import require_auth, require_permission, rate_limit

@require_auth
@require_permission('session.create')
@rate_limit(limit_type="general")
async def create_session(request):
    # Endpoint is now protected with auth, permissions, and rate limiting
    pass
```

### 3. Encrypting Sensitive Data
```python
# Encrypt PII automatically
user_data = {
    "username": "john_doe",
    "email": "john@example.com",
    "ssn": "123-45-6789"
}
encrypted_data = encryption.encrypt_pii(user_data)

# Decrypt when authorized
decrypted_data = encryption.decrypt_pii(encrypted_data, authorized=True)
```

### 4. Audit Logging
```python
from security import log_security_event

# Log security events
log_security_event(
    "auth.login_success",
    user_id=user_id,
    details={"ip": request.client.host}
)
```

## Security Best Practices

### Password Requirements
- Minimum 8 characters
- Must contain uppercase, lowercase, number, and special character
- Bcrypt hashing with high cost factor
- Password history to prevent reuse

### Token Management
- JWT tokens expire after 24 hours
- Refresh tokens rotate on use
- Blacklist tokens on logout
- Monitor for concurrent sessions

### Data Protection
- Encrypt all PII fields
- Use field-level encryption for sensitive data
- Implement data retention policies
- Anonymize data for analytics

### API Security
- Rate limit all endpoints
- Validate and sanitize all inputs
- Implement CORS properly
- Use security headers
- Monitor for suspicious patterns

## Monitoring and Alerts

### Security Events to Monitor
- Multiple failed login attempts
- Unusual access patterns
- Rate limit violations
- Permission escalation attempts
- Data export activities

### Alert Thresholds
- 5 failed login attempts: Account lockout
- 10 suspicious events: Security alert
- Rate limit exceeded: Temporary block
- Injection attempts: Immediate alert

## Testing Security

### Unit Tests
```python
# Test JWT validation
def test_jwt_validation():
    token = jwt_middleware.generate_token(user_id, permissions)
    valid, message, info = jwt_middleware.validate_token(token)
    assert valid

# Test encryption
def test_encryption():
    data = "sensitive information"
    encrypted, metadata = encryption.encrypt_data(data)
    decrypted = encryption.decrypt_data(encrypted, metadata)
    assert decrypted == data
```

### Security Testing Checklist
- [ ] Test authentication bypass attempts
- [ ] Test authorization escalation
- [ ] Test input validation (SQL injection, XSS)
- [ ] Test rate limiting
- [ ] Test encryption/decryption
- [ ] Test audit logging
- [ ] Test session management
- [ ] Test CORS configuration

## Maintenance

### Regular Tasks
1. **Key Rotation**: Rotate encryption keys every 90 days
2. **Audit Review**: Review audit logs weekly
3. **Permission Audit**: Review user permissions monthly
4. **Security Updates**: Update dependencies regularly
5. **Penetration Testing**: Conduct quarterly security tests

### Monitoring Metrics
- Failed login attempts
- Active sessions
- API request rates
- Security event frequency
- System resource usage

## Troubleshooting

### Common Issues

1. **Token Validation Failures**
   - Check token expiration
   - Verify JWT secret consistency
   - Check blacklist status

2. **Permission Denied**
   - Verify user role
   - Check resource permissions
   - Review permission rules

3. **Rate Limit Exceeded**
   - Check rate limit configuration
   - Review request patterns
   - Consider increasing limits

4. **Encryption Errors**
   - Verify encryption keys
   - Check key rotation status
   - Review data format

## Future Enhancements

1. **Multi-Factor Authentication (MFA)**
2. **OAuth2/SAML Integration**
3. **Hardware Security Module (HSM) Support**
4. **Advanced Threat Detection**
5. **Machine Learning for Anomaly Detection**
6. **Blockchain-based Audit Trail**

## Support

For security-related issues or questions:
- Review security logs in Redis
- Check audit trail for events
- Monitor WebSocket security events
- Contact security team for critical issues