"""
Authentication and session management module for Psyche Simulation.

This module provides:
- User authentication and management
- Multi-user session handling
- Role-based access control
- Session persistence and security
"""

from .user_manager import UserManager, UserRole
from .session_handler import SessionHandler, SessionManager

__version__ = "1.0.0"
__all__ = [
    "UserManager", 
    "UserRole", 
    "SessionHandler", 
    "SessionManager"
]