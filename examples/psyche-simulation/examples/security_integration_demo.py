#!/usr/bin/env python3
"""
Security Integration Demo for Psyche Simulation

This example demonstrates how to integrate and use all security components
together in a real-world application scenario.
"""

import asyncio
import sys
import os
from pathlib import Path
from datetime import datetime, timedelta
import json
from typing import Dict, Any, Optional

# Add the parent directory to the Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from data.redis_state_manager import RedisStateManager
from auth.user_manager import UserManager
from auth.session_handler import SessionManager
from utils.websocket_broadcaster import WebSocketBroadcaster
from utils.performance_monitor import PerformanceMonitor

# Import all security components
from security import (
    JWTMiddleware, TokenBlacklist,
    PermissionManager, 
    DataEncryption,
    AuditLogger,
    RateLimiter, InputValidator, apply_security_middleware,
    require_auth, require_permission, rate_limit,
    log_security_event
)

# Configuration
DEBUG = True
DEMO_USER_ID = "demo_user_123"
DEMO_USERNAME = "john_doe"
DEMO_EMAIL = "john.doe@example.com"
DEMO_ROLE = "analyst"

class SecurityIntegrationDemo:
    """
    Demonstrates the integration of all security components
    """
    
    def __init__(self):
        """Initialize the demo with all necessary components"""
        print("Initializing Security Integration Demo...")
        
        # Initialize Redis
        self.redis_manager = RedisStateManager()
        
        # Initialize core components
        self.user_manager = UserManager(self.redis_manager.client)
        self.session_manager = SessionManager(self.redis_manager)
        self.ws_broadcaster = WebSocketBroadcaster(self.redis_manager)
        self.performance_monitor = PerformanceMonitor(self.redis_manager)
        
        # Initialize security components
        self.token_blacklist = TokenBlacklist(self.redis_manager)
        self.jwt_middleware = JWTMiddleware(self.session_manager, self.token_blacklist)
        self.permission_manager = PermissionManager(self.redis_manager, self.user_manager)
        self.encryption = DataEncryption(self.redis_manager)
        self.audit_logger = AuditLogger(self.redis_manager, self.user_manager)
        self.rate_limiter = RateLimiter(self.redis_manager)
        self.input_validator = InputValidator()
        
        print("✅ All components initialized successfully")
    
    async def setup_demo_user(self) -> Dict[str, Any]:
        """Create a demo user with specific permissions"""
        print("\n🔧 Setting up demo user...")
        
        # Create user profile
        user_profile = {
            "user_id": DEMO_USER_ID,
            "username": DEMO_USERNAME,
            "email": DEMO_EMAIL,
            "role": DEMO_ROLE,
            "created_at": datetime.utcnow().isoformat(),
            "status": "active"
        }
        
        # Save user to Redis
        self.redis_manager.hset(
            f"user:{DEMO_USER_ID}",
            "profile",
            json.dumps(user_profile)
        )
        
        # Set user permissions
        permissions = [
            "session.view",
            "session.create",
            "agent.view",
            "analysis.view",
            "data.export"
        ]
        
        for permission in permissions:
            await self.permission_manager.grant_permission(DEMO_USER_ID, permission)
        
        print(f"✅ Created user: {DEMO_USERNAME} with role: {DEMO_ROLE}")
        print(f"✅ Granted permissions: {', '.join(permissions)}")
        
        return user_profile
    
    async def demonstrate_jwt_authentication(self) -> str:
        """Demonstrate JWT token generation and validation"""
        print("\n🔐 Demonstrating JWT Authentication...")
        
        # Generate JWT token
        permissions = await self.permission_manager.get_user_permissions(DEMO_USER_ID)
        token = self.jwt_middleware.generate_token(DEMO_USER_ID, list(permissions))
        
        print(f"✅ Generated JWT token for user: {DEMO_USER_ID}")
        print(f"   Token (truncated): {token[:50]}...")
        
        # Validate token
        valid, message, token_info = self.jwt_middleware.validate_token(token)
        
        if valid:
            print(f"✅ Token validation successful")
            print(f"   User ID: {token_info.get('user_id')}")
            print(f"   Expires: {datetime.fromtimestamp(token_info.get('exp'))}")
        else:
            print(f"❌ Token validation failed: {message}")
        
        # Log authentication event
        await log_security_event(
            self.audit_logger,
            "auth.token_generated",
            user_id=DEMO_USER_ID,
            details={"token_type": "access", "method": "demo"}
        )
        
        return token
    
    async def demonstrate_permissions(self, token: str):
        """Demonstrate permission checking"""
        print("\n🛡️  Demonstrating Permission System...")
        
        # Check various permissions
        test_permissions = [
            ("session.create", True),
            ("session.delete", False),
            ("agent.create", False),
            ("data.export", True)
        ]
        
        for permission, expected in test_permissions:
            has_permission = await self.permission_manager.check_permission(
                DEMO_USER_ID, 
                permission
            )
            
            result = "✅" if has_permission == expected else "❌"
            print(f"{result} Permission '{permission}': {has_permission} (expected: {expected})")
        
        # Demonstrate resource-level permission
        resource_id = "session_123"
        await self.permission_manager.grant_resource_permission(
            DEMO_USER_ID,
            resource_id,
            ["read", "write"]
        )
        
        has_resource_permission = await self.permission_manager.check_resource_permission(
            DEMO_USER_ID,
            resource_id,
            "write"
        )
        
        print(f"\n✅ Resource permission for '{resource_id}': {has_resource_permission}")
    
    async def demonstrate_encryption(self) -> Dict[str, Any]:
        """Demonstrate data encryption capabilities"""
        print("\n🔒 Demonstrating Data Encryption...")
        
        # Encrypt sensitive data
        sensitive_data = {
            "ssn": "123-45-6789",
            "credit_card": "4111-1111-1111-1111",
            "medical_record": "MR-2024-001",
            "api_key": "sk_test_123456789"
        }
        
        print("Original data:", json.dumps(sensitive_data, indent=2))
        
        # Encrypt the data
        encrypted_data = {}
        metadata = {}
        
        for key, value in sensitive_data.items():
            encrypted, meta = self.encryption.encrypt_data(value, data_type=key)
            encrypted_data[key] = encrypted
            metadata[key] = meta
        
        print("\n✅ Data encrypted successfully")
        print("Encrypted (truncated):", {k: v[:30] + "..." for k, v in encrypted_data.items()})
        
        # Encrypt PII automatically
        user_data = {
            "username": DEMO_USERNAME,
            "email": DEMO_EMAIL,
            "phone": "+1-555-123-4567",
            "address": "123 Main St, Anytown, USA"
        }
        
        encrypted_pii = self.encryption.encrypt_pii(user_data)
        print("\n✅ PII automatically encrypted")
        print(f"   Encrypted fields: {list(encrypted_pii['_encrypted_fields'])}")
        
        return encrypted_pii
    
    async def demonstrate_audit_logging(self):
        """Demonstrate comprehensive audit logging"""
        print("\n📋 Demonstrating Audit Logging...")
        
        # Log various security events
        events = [
            ("auth.login_attempt", {"ip": "192.168.1.100", "method": "password"}),
            ("auth.login_success", {"ip": "192.168.1.100", "session_id": "sess_123"}),
            ("data.export", {"resource": "user_data", "format": "csv", "records": 100}),
            ("permission.granted", {"permission": "admin.access", "granted_by": "admin"}),
            ("security.suspicious_activity", {"type": "multiple_failed_logins", "count": 5})
        ]
        
        for event_type, details in events:
            await log_security_event(
                self.audit_logger,
                event_type,
                user_id=DEMO_USER_ID,
                details=details
            )
            print(f"✅ Logged event: {event_type}")
        
        # Get recent events
        recent_events = await self.audit_logger.get_user_events(DEMO_USER_ID, limit=5)
        print(f"\n📊 Recent events for user: {len(recent_events)} events found")
        
        # Generate audit report
        report = await self.audit_logger.generate_audit_report(
            start_time=datetime.utcnow() - timedelta(hours=1),
            end_time=datetime.utcnow()
        )
        
        print(f"\n📈 Audit Report Summary:")
        print(f"   Total Events: {report.get('total_events', 0)}")
        print(f"   Event Types: {len(report.get('event_types', {}))}")
        print(f"   Active Users: {len(report.get('users', {}))}")
    
    async def demonstrate_rate_limiting(self):
        """Demonstrate rate limiting functionality"""
        print("\n⏱️  Demonstrating Rate Limiting...")
        
        # Test general rate limit
        endpoint = "/api/v1/sessions"
        client_id = "demo_client_123"
        
        print(f"Testing rate limit for endpoint: {endpoint}")
        
        for i in range(12):
            allowed, info = await self.rate_limiter.check_rate_limit(
                client_id,
                limit_type="general"
            )
            
            if allowed:
                print(f"✅ Request {i+1}: Allowed (remaining: {info.get('remaining', 0)})")
            else:
                print(f"❌ Request {i+1}: Rate limited! Reset in {info.get('reset_in', 0)}s")
            
            # Small delay
            await asyncio.sleep(0.1)
        
        # Test endpoint-specific rate limit
        print(f"\n🎯 Testing endpoint-specific rate limit...")
        
        for i in range(7):
            allowed, info = await self.rate_limiter.check_endpoint_limit(
                client_id,
                endpoint,
                limit=5,
                window=60
            )
            
            if allowed:
                print(f"✅ Endpoint request {i+1}: Allowed")
            else:
                print(f"❌ Endpoint request {i+1}: Rate limited!")
    
    async def demonstrate_input_validation(self):
        """Demonstrate input validation and sanitization"""
        print("\n🧹 Demonstrating Input Validation...")
        
        # Test various inputs
        test_inputs = [
            ("username", "john_doe123", True),
            ("username", "john'; DROP TABLE users;--", False),
            ("email", "john@example.com", True),
            ("email", "<script>alert('xss')</script>", False),
            ("path", "/api/users/123", True),
            ("path", "../../etc/passwd", False),
            ("query", "SELECT * FROM users WHERE id=1", False),
            ("number", "12345", True),
            ("number", "12345<script>", False)
        ]
        
        for field, value, expected_valid in test_inputs:
            validation = self.input_validator.validate_input(value, field)
            is_valid = validation["is_valid"]
            
            result = "✅" if is_valid == expected_valid else "❌"
            status = "Valid" if is_valid else f"Invalid: {validation.get('errors', [])}"
            print(f"{result} {field}: '{value[:30]}...' - {status}")
        
        # Demonstrate sanitization
        print("\n🧽 Demonstrating Input Sanitization...")
        
        dirty_inputs = [
            "<p>Hello <script>alert('xss')</script> World</p>",
            "Robert'); DROP TABLE Students;--",
            "../../etc/passwd",
            "Hello\x00World\x1b[31m"
        ]
        
        for dirty in dirty_inputs:
            clean = self.input_validator.sanitize_input(dirty)
            print(f"✅ Sanitized: '{dirty[:30]}...' → '{clean[:30]}...'")
    
    async def demonstrate_security_headers(self):
        """Demonstrate security headers configuration"""
        print("\n🛡️  Security Headers Configuration...")
        
        headers = self.input_validator.security_headers.copy()
        headers.update(self.input_validator.get_cors_headers("https://example.com"))
        
        print("Configured Security Headers:")
        for header, value in headers.items():
            print(f"   {header}: {value[:60]}...")
    
    async def demonstrate_websocket_security_events(self):
        """Demonstrate security event broadcasting via WebSocket"""
        print("\n📡 Demonstrating WebSocket Security Events...")
        
        # Broadcast security alerts
        security_events = [
            {
                "type": "security.alert",
                "severity": "high",
                "message": "Multiple failed login attempts detected",
                "user_id": DEMO_USER_ID,
                "details": {"attempts": 5, "ip": "192.168.1.100"}
            },
            {
                "type": "security.permission_change",
                "severity": "medium",
                "message": "User permissions updated",
                "user_id": DEMO_USER_ID,
                "details": {"added": ["admin.access"], "removed": ["guest.access"]}
            },
            {
                "type": "security.data_export",
                "severity": "low",
                "message": "Data export completed",
                "user_id": DEMO_USER_ID,
                "details": {"format": "csv", "records": 1000}
            }
        ]
        
        for event in security_events:
            await self.ws_broadcaster.broadcast(event)
            print(f"✅ Broadcasted: {event['type']} - {event['message']}")
    
    async def cleanup(self):
        """Clean up demo data"""
        print("\n🧹 Cleaning up demo data...")
        
        # Remove demo user
        self.redis_manager.delete(f"user:{DEMO_USER_ID}")
        
        # Clear permissions
        await self.permission_manager.revoke_all_permissions(DEMO_USER_ID)
        
        # Clear rate limit data
        self.redis_manager.delete(f"rate_limit:general:demo_client_123")
        
        print("✅ Cleanup completed")
    
    async def run(self):
        """Run the complete security integration demo"""
        try:
            print("\n" + "="*60)
            print("🚀 PSYCHE SIMULATION SECURITY INTEGRATION DEMO")
            print("="*60)
            
            # Setup
            await self.setup_demo_user()
            
            # Demonstrate each security component
            token = await self.demonstrate_jwt_authentication()
            await self.demonstrate_permissions(token)
            encrypted_data = await self.demonstrate_encryption()
            await self.demonstrate_audit_logging()
            await self.demonstrate_rate_limiting()
            await self.demonstrate_input_validation()
            await self.demonstrate_security_headers()
            await self.demonstrate_websocket_security_events()
            
            # Performance metrics
            print("\n📊 Security Performance Metrics:")
            with self.performance_monitor.track_operation("security.demo"):
                metrics = self.performance_monitor.get_metrics()
                print(f"   Operations tracked: {len(metrics)}")
            
            print("\n" + "="*60)
            print("✅ SECURITY INTEGRATION DEMO COMPLETED SUCCESSFULLY")
            print("="*60)
            
        except Exception as e:
            print(f"\n❌ Error during demo: {str(e)}")
            raise
        finally:
            await self.cleanup()


async def main():
    """Main entry point for the security demo"""
    demo = SecurityIntegrationDemo()
    await demo.run()


if __name__ == "__main__":
    # Run the demo
    asyncio.run(main())