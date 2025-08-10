"""
Authentication Components for Psyche Simulation UI

Provides NiceGUI-based authentication interface components:
- Login/logout interface with NiceGUI
- User registration and profile management UI
- Session selection and management interface
- Role-based UI element visibility and access control
- Password reset interface
- Session monitoring dashboard for administrators
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any, Callable
from nicegui import ui, app, Client
from contextlib import contextmanager

from auth.user_manager import UserManager, UserRole, UserStatus, UserProfile
from auth.session_handler import SessionManager, SessionType, SessionStatus
from data.redis_state_manager import RedisStateManager

logger = logging.getLogger(__name__)


class AuthState:
    """Global authentication state management."""
    
    def __init__(self):
        self.current_user: Optional[UserProfile] = None
        self.current_session_id: Optional[str] = None
        self.jwt_token: Optional[str] = None
        self.session_manager: Optional[SessionManager] = None
        self.user_manager: Optional[UserManager] = None
        self.callbacks: Dict[str, List[Callable]] = {
            'login': [],
            'logout': [],
            'session_change': []
        }
    
    def add_callback(self, event: str, callback: Callable):
        """Add callback for authentication events."""
        if event in self.callbacks:
            self.callbacks[event].append(callback)
    
    def trigger_callbacks(self, event: str, *args, **kwargs):
        """Trigger callbacks for authentication events."""
        if event in self.callbacks:
            for callback in self.callbacks[event]:
                try:
                    callback(*args, **kwargs)
                except Exception as e:
                    logger.error(f"Error in auth callback: {e}")
    
    def is_authenticated(self) -> bool:
        """Check if user is authenticated."""
        return self.current_user is not None and self.jwt_token is not None
    
    def has_role(self, role: UserRole) -> bool:
        """Check if current user has specific role."""
        return self.current_user and self.current_user.role == role
    
    def has_permission(self, permission: str) -> bool:
        """Check if current user has specific permission."""
        if not self.current_user:
            return False
        
        # Admin has all permissions
        if self.current_user.role == UserRole.ADMIN:
            return True
        
        # Define role-based permissions
        role_permissions = {
            UserRole.RESEARCHER: ['read', 'write', 'create_session', 'export_data'],
            UserRole.OBSERVER: ['read', 'export_limited']
        }
        
        return permission in role_permissions.get(self.current_user.role, [])
    
    def login(self, user_profile: UserProfile, session_id: str, jwt_token: str):
        """Set authentication state for logged in user."""
        self.current_user = user_profile
        self.current_session_id = session_id
        self.jwt_token = jwt_token
        self.trigger_callbacks('login', user_profile, session_id, jwt_token)
    
    def logout(self):
        """Clear authentication state."""
        old_user = self.current_user
        self.current_user = None
        self.current_session_id = None
        self.jwt_token = None
        
        if old_user:
            self.trigger_callbacks('logout', old_user)
    
    @property
    def user_profile(self) -> Optional[UserProfile]:
        """Get current user profile."""
        return self.current_user
    
    @property
    def session_id(self) -> Optional[str]:
        """Get current session ID."""
        return self.current_session_id


# Global auth state
auth_state = AuthState()


class LoginComponent:
    """Login interface component."""
    
    def __init__(self, on_success: Optional[Callable] = None):
        self.on_success = on_success
        self.user_manager = UserManager()
        self.session_manager = SessionManager(user_manager=self.user_manager)
        
        # Set global references
        auth_state.user_manager = self.user_manager
        auth_state.session_manager = self.session_manager
        
        self.container = None
        self.username_input = None
        self.password_input = None
        self.remember_me = None
        self.login_button = None
        self.error_label = None
        self.loading = False
    
    def create_ui(self) -> ui.element:
        """Create login UI components."""
        with ui.card().classes('w-full max-w-md mx-auto p-6') as self.container:
            ui.label('🧠 Psyche Simulation Login').classes('text-2xl font-bold text-center mb-6')
            
            with ui.column().classes('w-full gap-4'):
                self.username_input = ui.input(
                    'Username or Email',
                    placeholder='Enter your username or email'
                ).classes('w-full').props('outlined')
                
                self.password_input = ui.input(
                    'Password',
                    placeholder='Enter your password',
                    password=True,
                    password_toggle_button=True
                ).classes('w-full').props('outlined')
                
                self.remember_me = ui.checkbox('Remember me').classes('mb-2')
                
                self.login_button = ui.button(
                    'Login',
                    on_click=self._handle_login
                ).classes('w-full bg-blue-600 text-white')
                
                self.error_label = ui.label('').classes('text-red-500 text-sm text-center hidden')
                
                ui.separator().classes('my-4')
                
                with ui.row().classes('w-full justify-between'):
                    ui.button(
                        'Register',
                        on_click=self._show_register
                    ).classes('text-blue-600').props('flat')
                    
                    ui.button(
                        'Forgot Password?',
                        on_click=self._show_forgot_password
                    ).classes('text-blue-600').props('flat')
        
        # Handle Enter key
        self.password_input.on('keydown.enter', self._handle_login)
        
        return self.container
    
    def _show_error(self, message: str):
        """Show error message."""
        self.error_label.set_text(message)
        self.error_label.classes(remove='hidden')
    
    def _hide_error(self):
        """Hide error message."""
        self.error_label.classes(add='hidden')
    
    async def _handle_login(self):
        """Handle login attempt."""
        if self.loading:
            return
        
        try:
            self.loading = True
            self.login_button.set_text('Logging in...')
            self.login_button.disable()
            self._hide_error()
            
            username = self.username_input.value.strip()
            password = self.password_input.value
            
            if not username or not password:
                self._show_error('Please enter both username and password')
                return
            
            # Authenticate user
            success, message, user_profile = self.user_manager.authenticate_user(username, password)
            
            if success and user_profile:
                # Create session
                try:
                    session_result = await self.session_manager.create_session(
                        user_id=user_profile.user_id,
                        session_type=SessionType.SINGLE_USER
                    )
                    session_success, session_message, session_id, jwt_token = session_result
                except Exception as session_error:
                    logger.error(f"Session creation unpacking error: {session_error}")
                    session_success, session_message, session_id, jwt_token = False, f"Session creation failed: {session_error}", None, None
                
                if session_success:
                    # Update auth state
                    auth_state.current_user = user_profile
                    auth_state.current_session_id = session_id
                    auth_state.jwt_token = jwt_token
                    
                    # Store in client storage if remember me
                    if self.remember_me.value:
                        app.storage.client['jwt_token'] = jwt_token
                        app.storage.client['user_id'] = user_profile.user_id
                        app.storage.client['session_id'] = session_id
                    
                    # Trigger callbacks
                    auth_state.trigger_callbacks('login', user_profile)
                    
                    ui.notify(f'Welcome, {user_profile.display_name}!', type='positive')
                    
                    if self.on_success:
                        if asyncio.iscoroutinefunction(self.on_success):
                            await self.on_success(user_profile)
                        else:
                            self.on_success(user_profile)
                else:
                    self._show_error(f'Session creation failed: {session_message}')
            else:
                self._show_error(message)
                
        except Exception as e:
            logger.error(f"Login error: {e}")
            self._show_error('Login failed due to system error')
        finally:
            self.loading = False
            self.login_button.set_text('Login')
            self.login_button.enable()
    
    def _show_register(self):
        """Show registration dialog."""
        RegisterDialog().show()
    
    def _show_forgot_password(self):
        """Show forgot password dialog."""
        ForgotPasswordDialog().show()


class RegisterDialog:
    """User registration dialog.""" 
    
    def __init__(self):
        self.user_manager = auth_state.user_manager or UserManager()
        self.dialog = None
        self.form_data = {}
        self.loading = False
    
    def show(self):
        """Show registration dialog."""
        with ui.dialog().classes('w-full max-w-lg') as self.dialog:
            with ui.card().classes('w-full p-6'):
                ui.label('Create Account').classes('text-xl font-bold mb-4')
                
                with ui.column().classes('w-full gap-4'):
                    username_input = ui.input(
                        'Username',
                        placeholder='Choose a username'
                    ).classes('w-full').props('outlined')
                    
                    email_input = ui.input(
                        'Email',
                        placeholder='Enter your email address'
                    ).classes('w-full').props('outlined')
                    
                    display_name_input = ui.input(
                        'Display Name',
                        placeholder='Your display name'
                    ).classes('w-full').props('outlined')
                    
                    password_input = ui.input(
                        'Password',
                        placeholder='Create a password',
                        password=True,
                        password_toggle_button=True
                    ).classes('w-full').props('outlined')
                    
                    confirm_password_input = ui.input(
                        'Confirm Password',
                        placeholder='Confirm your password',
                        password=True
                    ).classes('w-full').props('outlined')
                    
                    role_select = ui.select(
                        options={
                            'observer': 'Observer (Read-only access)',
                            'researcher': 'Researcher (Full access)'
                        },
                        value='observer',
                        label='Role'
                    ).classes('w-full')
                    
                    error_label = ui.label('').classes('text-red-500 text-sm hidden')
                    
                    with ui.row().classes('w-full justify-end gap-2 mt-4'):
                        ui.button('Cancel', on_click=self.dialog.close).props('flat')
                        
                        register_button = ui.button(
                            'Create Account',
                            on_click=lambda: self._handle_register(
                                username_input, email_input, display_name_input,
                                password_input, confirm_password_input, role_select,
                                error_label, register_button
                            )
                        ).classes('bg-green-600 text-white')
        
        self.dialog.open()
    
    async def _handle_register(self, username_input, email_input, display_name_input,
                             password_input, confirm_password_input, role_select,
                             error_label, register_button):
        """Handle user registration."""
        if self.loading:
            return
        
        try:
            self.loading = True
            register_button.set_text('Creating Account...')
            register_button.disable()
            error_label.classes(add='hidden')
            
            # Validate inputs
            username = username_input.value.strip()
            email = email_input.value.strip()
            display_name = display_name_input.value.strip()
            password = password_input.value
            confirm_password = confirm_password_input.value
            role = UserRole(role_select.value)
            
            if not all([username, email, password, confirm_password]):
                error_label.set_text('All fields are required')
                error_label.classes(remove='hidden')
                return
            
            if password != confirm_password:
                error_label.set_text('Passwords do not match')
                error_label.classes(remove='hidden')
                return
            
            # Create user account
            success, message, user_id = self.user_manager.create_user(
                username=username,
                email=email,
                password=password,
                role=role,
                display_name=display_name or username
            )
            
            if success:
                ui.notify('Account created successfully! Please log in.', type='positive')
                self.dialog.close()
            else:
                error_label.set_text(message)
                error_label.classes(remove='hidden')
                
        except Exception as e:
            logger.error(f"Registration error: {e}")
            error_label.set_text('Registration failed due to system error')
            error_label.classes(remove='hidden')
        finally:
            self.loading = False
            register_button.set_text('Create Account')
            register_button.enable()


class ForgotPasswordDialog:
    """Password reset dialog."""
    
    def __init__(self):
        self.user_manager = auth_state.user_manager or UserManager()
        self.dialog = None
        self.loading = False
    
    def show(self):
        """Show forgot password dialog."""
        with ui.dialog().classes('w-full max-w-md') as self.dialog:
            with ui.card().classes('w-full p-6'):
                ui.label('Reset Password').classes('text-xl font-bold mb-4')
                ui.label('Enter your email address to receive a password reset token.').classes('text-sm text-gray-600 mb-4')
                
                with ui.column().classes('w-full gap-4'):
                    email_input = ui.input(
                        'Email Address',
                        placeholder='Enter your email'
                    ).classes('w-full').props('outlined')
                    
                    error_label = ui.label('').classes('text-red-500 text-sm hidden')
                    success_label = ui.label('').classes('text-green-500 text-sm hidden')
                    
                    with ui.row().classes('w-full justify-end gap-2 mt-4'):
                        ui.button('Cancel', on_click=self.dialog.close).props('flat')
                        
                        reset_button = ui.button(
                            'Send Reset Link',
                            on_click=lambda: self._handle_reset(
                                email_input, error_label, success_label, reset_button
                            )
                        ).classes('bg-blue-600 text-white')
        
        self.dialog.open()
    
    async def _handle_reset(self, email_input, error_label, success_label, reset_button):
        """Handle password reset request."""
        if self.loading:
            return
        
        try:
            self.loading = True
            reset_button.set_text('Sending...')
            reset_button.disable()
            error_label.classes(add='hidden')
            success_label.classes(add='hidden')
            
            email = email_input.value.strip()
            
            if not email:
                error_label.set_text('Email address is required')
                error_label.classes(remove='hidden')
                return
            
            # Create reset token
            success, message, token = self.user_manager.create_password_reset_token(email)
            
            if success:
                success_label.set_text('If the email exists, a reset token has been created. Use the token to reset your password.')
                success_label.classes(remove='hidden')
                
                # In a real application, you'd send an email with the token
                # For demo purposes, show the token
                if token:
                    ui.notify(f'Demo: Reset token is {token}', type='info')
            else:
                error_label.set_text(message)
                error_label.classes(remove='hidden')
                
        except Exception as e:
            logger.error(f"Password reset error: {e}")
            error_label.set_text('Password reset failed due to system error')
            error_label.classes(remove='hidden')
        finally:
            self.loading = False
            reset_button.set_text('Send Reset Link')
            reset_button.enable()


class UserProfileComponent:
    """User profile management component."""
    
    def __init__(self):
        self.user_manager = auth_state.user_manager
        self.container = None
    
    def create_ui(self) -> ui.element:
        """Create user profile UI."""
        if not auth_state.is_authenticated():
            return ui.label('Please log in to view profile').classes('text-gray-500')
        
        user = auth_state.current_user
        
        with ui.card().classes('w-full max-w-2xl p-6') as self.container:
            ui.label('👤 User Profile').classes('text-xl font-bold mb-4')
            
            with ui.grid(columns=2).classes('w-full gap-4'):
                # Profile Information
                with ui.card().classes('p-4'):
                    ui.label('Profile Information').classes('font-semibold mb-3')
                    
                    ui.label(f'Username: {user.username}').classes('mb-2')
                    ui.label(f'Email: {user.email}').classes('mb-2')
                    ui.label(f'Display Name: {user.display_name}').classes('mb-2')
                    ui.label(f'Role: {user.role.value.title()}').classes('mb-2')
                    ui.label(f'Status: {user.status.value.title()}').classes('mb-2')
                    ui.label(f'Member Since: {user.created_at.strftime("%Y-%m-%d")}').classes('mb-2')
                    
                    if user.last_login:
                        ui.label(f'Last Login: {user.last_login.strftime("%Y-%m-%d %H:%M")}').classes('mb-2')
                
                # Account Actions
                with ui.card().classes('p-4'):
                    ui.label('Account Actions').classes('font-semibold mb-3')
                    
                    ui.button(
                        'Change Password',
                        on_click=self._show_change_password
                    ).classes('w-full mb-2 bg-blue-600 text-white')
                    
                    ui.button(
                        'Update Profile',
                        on_click=self._show_update_profile
                    ).classes('w-full mb-2 bg-green-600 text-white')
                    
                    ui.button(
                        'Logout',
                        on_click=self._handle_logout
                    ).classes('w-full bg-red-600 text-white')
        
        return self.container
    
    def _show_change_password(self):
        """Show change password dialog."""
        ChangePasswordDialog().show()
    
    def _show_update_profile(self):
        """Show update profile dialog."""
        UpdateProfileDialog().show()
    
    def _handle_logout(self):
        """Handle user logout."""
        auth_state.logout()
        
        # Clear client storage
        app.storage.client.pop('jwt_token', None)
        app.storage.client.pop('user_id', None)
        app.storage.client.pop('session_id', None)
        
        ui.notify('Logged out successfully', type='positive')


class ChangePasswordDialog:
    """Change password dialog."""
    
    def __init__(self):
        self.user_manager = auth_state.user_manager
        self.dialog = None
        self.loading = False
    
    def show(self):
        """Show change password dialog."""
        with ui.dialog().classes('w-full max-w-md') as self.dialog:
            with ui.card().classes('w-full p-6'):
                ui.label('Change Password').classes('text-xl font-bold mb-4')
                
                with ui.column().classes('w-full gap-4'):
                    current_password_input = ui.input(
                        'Current Password',
                        password=True
                    ).classes('w-full').props('outlined')
                    
                    new_password_input = ui.input(
                        'New Password',
                        password=True,
                        password_toggle_button=True
                    ).classes('w-full').props('outlined')
                    
                    confirm_password_input = ui.input(
                        'Confirm New Password',
                        password=True
                    ).classes('w-full').props('outlined')
                    
                    error_label = ui.label('').classes('text-red-500 text-sm hidden')
                    
                    with ui.row().classes('w-full justify-end gap-2 mt-4'):
                        ui.button('Cancel', on_click=self.dialog.close).props('flat')
                        
                        change_button = ui.button(
                            'Change Password',
                            on_click=lambda: self._handle_change_password(
                                current_password_input, new_password_input,
                                confirm_password_input, error_label, change_button
                            )
                        ).classes('bg-blue-600 text-white')
        
        self.dialog.open()
    
    async def _handle_change_password(self, current_password_input, new_password_input,
                                    confirm_password_input, error_label, change_button):
        """Handle password change."""
        if self.loading:
            return
        
        try:
            self.loading = True
            change_button.set_text('Changing...')
            change_button.disable()
            error_label.classes(add='hidden')
            
            current_password = current_password_input.value
            new_password = new_password_input.value
            confirm_password = confirm_password_input.value
            
            if not all([current_password, new_password, confirm_password]):
                error_label.set_text('All fields are required')
                error_label.classes(remove='hidden')
                return
            
            if new_password != confirm_password:
                error_label.set_text('New passwords do not match')
                error_label.classes(remove='hidden')
                return
            
            # Change password
            success, message = self.user_manager.change_password(
                auth_state.current_user.user_id,
                current_password,
                new_password
            )
            
            if success:
                ui.notify('Password changed successfully', type='positive')
                self.dialog.close()
            else:
                error_label.set_text(message)
                error_label.classes(remove='hidden')
                
        except Exception as e:
            logger.error(f"Password change error: {e}")
            error_label.set_text('Password change failed due to system error')
            error_label.classes(remove='hidden')
        finally:
            self.loading = False
            change_button.set_text('Change Password')
            change_button.enable()


class UpdateProfileDialog:
    """Update profile dialog."""
    
    def __init__(self):
        self.user_manager = auth_state.user_manager
        self.dialog = None
        self.loading = False
    
    def show(self):
        """Show update profile dialog."""
        user = auth_state.current_user
        
        with ui.dialog().classes('w-full max-w-md') as self.dialog:
            with ui.card().classes('w-full p-6'):
                ui.label('Update Profile').classes('text-xl font-bold mb-4')
                
                with ui.column().classes('w-full gap-4'):
                    display_name_input = ui.input(
                        'Display Name',
                        value=user.display_name
                    ).classes('w-full').props('outlined')
                    
                    # Add preference toggles
                    dark_mode_toggle = ui.checkbox(
                        'Dark Mode',
                        value=user.preferences.get('dark_mode', True)
                    )
                    
                    notifications_toggle = ui.checkbox(
                        'Email Notifications',
                        value=user.preferences.get('notifications', False)
                    )
                    
                    error_label = ui.label('').classes('text-red-500 text-sm hidden')
                    
                    with ui.row().classes('w-full justify-end gap-2 mt-4'):
                        ui.button('Cancel', on_click=self.dialog.close).props('flat')
                        
                        update_button = ui.button(
                            'Update Profile',
                            on_click=lambda: self._handle_update_profile(
                                display_name_input, dark_mode_toggle, notifications_toggle,
                                error_label, update_button
                            )
                        ).classes('bg-green-600 text-white')
        
        self.dialog.open()
    
    async def _handle_update_profile(self, display_name_input, dark_mode_toggle,
                                   notifications_toggle, error_label, update_button):
        """Handle profile update."""
        if self.loading:
            return
        
        try:
            self.loading = True
            update_button.set_text('Updating...')
            update_button.disable()
            error_label.classes(add='hidden')
            
            display_name = display_name_input.value.strip()
            
            if not display_name:
                error_label.set_text('Display name is required')
                error_label.classes(remove='hidden')
                return
            
            # Update profile
            updates = {
                'display_name': display_name,
                'preferences': {
                    'dark_mode': dark_mode_toggle.value,
                    'notifications': notifications_toggle.value
                }
            }
            
            success, message = self.user_manager.update_user_profile(
                auth_state.current_user.user_id,
                updates
            )
            
            if success:
                # Update auth state
                auth_state.current_user.display_name = display_name
                auth_state.current_user.preferences.update(updates['preferences'])
                
                ui.notify('Profile updated successfully', type='positive')
                self.dialog.close()
            else:
                error_label.set_text(message)
                error_label.classes(remove='hidden')
                
        except Exception as e:
            logger.error(f"Profile update error: {e}")
            error_label.set_text('Profile update failed due to system error')
            error_label.classes(remove='hidden')
        finally:
            self.loading = False
            update_button.set_text('Update Profile')
            update_button.enable()


class SessionManagementComponent:
    """Session management interface."""
    
    def __init__(self):
        self.session_manager = auth_state.session_manager
        self.container = None
        self.sessions_container = None
    
    def create_ui(self) -> ui.element:
        """Create session management UI."""
        if not auth_state.is_authenticated():
            return ui.label('Please log in to manage sessions').classes('text-gray-500')
        
        with ui.card().classes('w-full p-6') as self.container:
            ui.label('🔄 Session Management').classes('text-xl font-bold mb-4')
            
            # Session creation
            with ui.card().classes('w-full p-4 mb-4'):
                ui.label('Create New Session').classes('font-semibold mb-3')
                
                with ui.row().classes('w-full items-end gap-4'):
                    session_type_select = ui.select(
                        options=[
                            {'label': 'Single User', 'value': SessionType.SINGLE_USER.value},
                            {'label': 'Shared', 'value': SessionType.SHARED.value},
                            {'label': 'Observer Only', 'value': SessionType.OBSERVER_ONLY.value}
                        ],
                        value=SessionType.SINGLE_USER.value,
                        label='Session Type'
                    ).classes('flex-grow')
                    
                    ui.button(
                        'Create Session',
                        on_click=lambda: self._create_session(session_type_select.value)
                    ).classes('bg-green-600 text-white')
            
            # Active sessions
            ui.label('Your Sessions').classes('font-semibold mb-3')
            with ui.column().classes('w-full gap-2') as self.sessions_container:
                self._refresh_sessions()
        
        return self.container
    
    def _refresh_sessions(self):
        """Refresh session list."""
        if not self.sessions_container:
            return
        
        self.sessions_container.clear()
        
        try:
            sessions = self.session_manager.list_user_sessions(auth_state.current_user.user_id)
            
            if not sessions:
                with self.sessions_container:
                    ui.label('No active sessions').classes('text-gray-500 text-center p-4')
                return
            
            with self.sessions_container:
                for session in sessions:
                    with ui.card().classes('w-full p-4'):
                        with ui.row().classes('w-full items-center justify-between'):
                            with ui.column():
                                ui.label(f"Session: {session['session_id'][:8]}...").classes('font-semibold')
                                ui.label(f"Type: {session['session_type'].replace('_', ' ').title()}").classes('text-sm')
                                ui.label(f"Status: {session['status'].title()}").classes('text-sm')
                                ui.label(f"Created: {session['created_at'][:19]}").classes('text-sm')
                            
                            with ui.row().classes('gap-2'):
                                if session['status'] == 'active':
                                    ui.button(
                                        'Join',
                                        on_click=lambda s=session: self._join_session(s['session_id'])
                                    ).classes('bg-blue-600 text-white').props('size=sm')
                                
                                if session['is_owner']:
                                    ui.button(
                                        'Terminate',
                                        on_click=lambda s=session: self._terminate_session(s['session_id'])
                                    ).classes('bg-red-600 text-white').props('size=sm')
        
        except Exception as e:
            logger.error(f"Error refreshing sessions: {e}")
            with self.sessions_container:
                ui.label('Error loading sessions').classes('text-red-500')
    
    async def _create_session(self, session_type: str):
        """Create new session."""
        try:
            success, message, session_id, jwt_token = await self.session_manager.create_session(
                user_id=auth_state.current_user.user_id,
                session_type=SessionType(session_type)
            )
            
            if success:
                ui.notify(f'Session created: {session_id[:8]}...', type='positive')
                self._refresh_sessions()
            else:
                ui.notify(f'Failed to create session: {message}', type='negative')
                
        except Exception as e:
            logger.error(f"Error creating session: {e}")
            ui.notify('Error creating session', type='negative')
    
    async def _join_session(self, session_id: str):
        """Join session."""
        try:
            # Update current session
            auth_state.current_session_id = session_id
            auth_state.trigger_callbacks('session_change', session_id)
            
            ui.notify(f'Joined session: {session_id[:8]}...', type='positive')
            
        except Exception as e:
            logger.error(f"Error joining session: {e}")
            ui.notify('Error joining session', type='negative')
    
    async def _terminate_session(self, session_id: str):
        """Terminate session."""
        try:
            success, message = self.session_manager.terminate_session(
                session_id,
                auth_state.current_user.user_id
            )
            
            if success:
                ui.notify('Session terminated', type='positive')
                self._refresh_sessions()
            else:
                ui.notify(f'Failed to terminate session: {message}', type='negative')
                
        except Exception as e:
            logger.error(f"Error terminating session: {e}")
            ui.notify('Error terminating session', type='negative')


@contextmanager
def require_auth():
    """Context manager for authentication requirement."""
    if not auth_state.is_authenticated():
        with ui.card().classes('w-full max-w-md mx-auto p-6'):
            ui.label('Authentication Required').classes('text-xl font-bold text-center mb-4')
            ui.label('Please log in to access this feature.').classes('text-center mb-4')
            LoginComponent().create_ui()
        return
    
    yield


@contextmanager
def require_permission(permission: str):
    """Context manager for permission requirement."""
    if not auth_state.is_authenticated():
        with ui.card().classes('w-full max-w-md mx-auto p-6'):
            ui.label('Authentication Required').classes('text-xl font-bold text-center mb-4')
            LoginComponent().create_ui()
        return
    
    if not auth_state.has_permission(permission):
        with ui.card().classes('w-full max-w-md mx-auto p-6'):
            ui.label('Access Denied').classes('text-xl font-bold text-center mb-4')
            ui.label(f'You do not have permission to {permission}.').classes('text-center')
        return
    
    yield


def create_auth_header() -> ui.element:
    """Create authentication header component."""
    with ui.row().classes('w-full items-center justify-between') as header:
        ui.label('🧠 Psyche Simulation').classes('text-xl font-bold')
        
        if auth_state.is_authenticated():
            user = auth_state.current_user
            with ui.row().classes('items-center gap-4'):
                ui.label(f'Welcome, {user.display_name}').classes('text-sm')
                ui.label(f'({user.role.value.title()})').classes('text-xs text-gray-500')
                
                ui.button(
                    'Profile',
                    on_click=lambda: ProfileDialog().show()
                ).props('size=sm flat')
                
                ui.button(
                    'Sessions',
                    on_click=lambda: SessionsDialog().show()
                ).props('size=sm flat')
                
                ui.button(
                    'Logout',
                    on_click=auth_state.logout
                ).props('size=sm flat')
        else:
            ui.button(
                'Login',
                on_click=lambda: LoginDialog().show()
            ).props('size=sm')
    
    return header


class ProfileDialog:
    """Profile dialog wrapper."""
    
    def show(self):
        with ui.dialog().classes('w-full max-w-2xl'):
            UserProfileComponent().create_ui()


class SessionsDialog:
    """Sessions dialog wrapper."""
    
    def show(self):
        with ui.dialog().classes('w-full max-w-4xl'):
            SessionManagementComponent().create_ui()


class LoginDialog:
    """Login dialog wrapper."""
    
    def show(self):
        with ui.dialog().classes('w-full max-w-md'):
            LoginComponent().create_ui()


def create_login_page(user_manager, session_manager, on_success, on_show_register):
    """Create login page UI component."""
    async def handle_login_wrapper(user_profile):
        """Async wrapper to properly handle login success."""
        await _handle_login_success(
            user_manager, session_manager, user_profile, on_success
        )
    
    login_component = LoginComponent(on_success=handle_login_wrapper)
    
    # Override the register button to call on_show_register
    def show_register():
        on_show_register()
    
    login_component._show_register = show_register
    
    return login_component.create_ui()

async def _handle_login_success(user_manager, session_manager, user_profile, on_success):
    """Handle successful login and create session."""
    logger.info("=== _handle_login_success: Called ===")
    logger.info(f"Current UI context: {ui.context}")
    logger.info(f"UI context stack depth: {len(getattr(ui.context, 'stack', []))}")
    
    try:
        logger.info("Creating session...")
        success, message, session_id, jwt_token = await session_manager.create_session(
            user_id=user_profile.user_id,
            session_type=SessionType.SINGLE_USER
        )
        
        if success:
            logger.info("Session created successfully, calling on_success callback")
            logger.info(f"on_success is coroutine: {asyncio.iscoroutinefunction(on_success)}")
            logger.info(f"UI context before on_success: {ui.context}")
            
            # Check if on_success is a coroutine and handle appropriately
            if asyncio.iscoroutinefunction(on_success):
                await on_success(user_profile, session_id, jwt_token)
            else:
                on_success(user_profile, session_id, jwt_token)
                
            logger.info("on_success callback completed")
        else:
            logger.error(f"Session creation failed: {message}")
            ui.notify(f'Session creation failed: {message}', type='negative')
    except Exception as e:
        logger.error(f"Error creating session after login: {e}")
        logger.error(f"Exception type: {type(e).__name__}")
        logger.error(f"Exception details: {str(e)}")
        ui.notify('Failed to create session', type='negative')

def create_registration_page(user_manager, on_success, on_show_login):
    """Create registration page UI component."""
    with ui.column().classes('w-full max-w-md mx-auto p-6'):
        ui.label('🧠 Psyche Simulation Registration').classes('text-2xl font-bold text-center mb-6')
        
        with ui.card().classes('w-full p-6'):
            with ui.column().classes('w-full gap-4'):
                username_input = ui.input('Username', placeholder='Choose a username').classes('w-full').props('outlined')
                email_input = ui.input('Email', placeholder='Enter your email address').classes('w-full').props('outlined')
                display_name_input = ui.input('Display Name', placeholder='Your display name').classes('w-full').props('outlined')
                password_input = ui.input('Password', placeholder='Create a password', password=True, password_toggle_button=True).classes('w-full').props('outlined')
                confirm_password_input = ui.input('Confirm Password', placeholder='Confirm your password', password=True).classes('w-full').props('outlined')
                
                role_select = ui.select(
                    options={
                        'observer': 'Observer (Read-only access)',
                        'researcher': 'Researcher (Full access)'
                    },
                    value='observer',
                    label='Role'
                ).classes('w-full')
                
                error_label = ui.label('').classes('text-red-500 text-sm hidden')
                
                async def handle_register():
                    try:
                        username = username_input.value.strip()
                        email = email_input.value.strip()
                        display_name = display_name_input.value.strip()
                        password = password_input.value
                        confirm_password = confirm_password_input.value
                        role = UserRole(role_select.value)
                        
                        if not all([username, email, password, confirm_password]):
                            error_label.set_text('All fields are required')
                            error_label.classes(remove='hidden')
                            return
                        
                        if password != confirm_password:
                            error_label.set_text('Passwords do not match')
                            error_label.classes(remove='hidden')
                            return
                        
                        success, message, user_id = user_manager.create_user(
                            username=username,
                            email=email,
                            password=password,
                            role=role,
                            display_name=display_name or username
                        )
                        
                        if success:
                            ui.notify('Account created successfully!', type='positive')
                            # Check if on_success is a coroutine and handle appropriately
                            if asyncio.iscoroutinefunction(on_success):
                                await on_success()
                            else:
                                on_success()
                        else:
                            error_label.set_text(message)
                            error_label.classes(remove='hidden')
                            
                    except Exception as e:
                        logger.error(f"Registration error: {e}")
                        error_label.set_text('Registration failed due to system error')
                        error_label.classes(remove='hidden')
                
                with ui.row().classes('w-full justify-between gap-2 mt-4'):
                    ui.button('Back to Login', on_click=on_show_login).props('flat')
                    ui.button('Create Account', on_click=handle_register).classes('bg-green-600 text-white')


# Example usage and testing
def create_auth_demo():
    """Create authentication demo interface."""
    ui.dark_mode().enable()
    
    with ui.column().classes('w-full max-w-4xl mx-auto gap-4 p-4'):
        # Header
        create_auth_header()
        
        ui.separator()
        
        # Main content based on auth state
        if auth_state.is_authenticated():
            with ui.tabs().classes('w-full') as tabs:
                profile_tab = ui.tab('Profile')
                sessions_tab = ui.tab('Sessions')
                
            with ui.tab_panels(tabs, value=profile_tab).classes('w-full'):
                with ui.tab_panel(profile_tab):
                    UserProfileComponent().create_ui()
                
                with ui.tab_panel(sessions_tab):
                    SessionManagementComponent().create_ui()
        else:
            LoginComponent().create_ui()


if __name__ == "__main__":
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    # Create demo interface
    create_auth_demo()
    
    # Run UI
    ui.run(title='Psyche Simulation Auth Demo', port=8081)