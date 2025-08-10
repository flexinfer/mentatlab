"""WebSocket Event Broadcaster for NiceGUI integration.

This module provides a WebSocket broadcaster that integrates with NiceGUI
and properly handles client storage access.
"""

import asyncio
import logging
import json
from datetime import datetime
from typing import Dict, Any, Optional, List
from nicegui import ui

from .websocket_events import (
    get_event_manager,
    EventType,
    WebSocketEvent,
    broadcast_agent_message as _broadcast_agent_message,
    broadcast_network_update as _broadcast_network_update,
    broadcast_system_status as _broadcast_system_status,
    broadcast_user_login as _broadcast_user_login,
    broadcast_user_logout as _broadcast_user_logout,
    broadcast_session_update as _broadcast_session_update,
    broadcast_agent_processing_started,
    broadcast_agent_processing_update,
    broadcast_agent_processing_complete
)

logger = logging.getLogger(__name__)


class WebSocketEventBroadcaster:
    """WebSocket event broadcaster with NiceGUI client integration."""
    
    def __init__(self):
        """Initialize the broadcaster."""
        self.event_manager = get_event_manager()
        self._clients = {}  # Track clients by user_id
        
    async def broadcast_agent_message(self, agent_id: str, message: str, 
                                    recipient: Optional[str] = None,
                                    metadata: Optional[Dict[str, Any]] = None):
        """Broadcast agent message to all connected clients.
        
        Args:
            agent_id: ID of the agent sending the message
            message: The message content
            recipient: Optional specific recipient
            metadata: Additional metadata
        """
        try:
            # Use existing broadcast function
            _broadcast_agent_message(
                agent_id=agent_id,
                agent_type=metadata.get('agent_type', 'unknown') if metadata else 'unknown',
                message=message,
                sentiment_data=metadata.get('sentiment') if metadata else None,
                metadata=metadata
            )
            
            # Also broadcast via NiceGUI UI updates
            await self._update_ui_clients('agent_message', {
                'agent_id': agent_id,
                'content': message,  # Changed from 'message' to 'content'
                'recipient': recipient,
                'metadata': metadata,
                'sentiment': metadata.get('sentiment') if metadata else {'score': 0.0, 'label': 'neutral'}
            })
            
        except Exception as e:
            logger.error(f"Error broadcasting agent message: {e}")
    
    async def broadcast_network_update(self, connections: List[Dict[str, Any]], 
                                     metrics: Optional[Dict[str, Any]] = None):
        """Broadcast network update to all connected clients.
        
        Args:
            connections: List of network connections
            metrics: Optional network metrics
        """
        try:
            # Use existing broadcast function
            _broadcast_network_update(
                connections=connections,
                communication_stats=metrics
            )
            
            # Also broadcast via NiceGUI UI updates
            await self._update_ui_clients('network_update', {
                'connections': connections,
                'metrics': metrics
            })
            
        except Exception as e:
            logger.error(f"Error broadcasting network update: {e}")
    
    async def broadcast_system_event(self, event_type: str, data: Dict[str, Any]):
        """Broadcast system event to all connected clients.
        
        Args:
            event_type: Type of system event
            data: Event data
        """
        try:
            # Determine if this is a status update
            if event_type == 'system_status':
                _broadcast_system_status(
                    is_running=data.get('is_running', True),
                    performance_data=data.get('performance_data'),
                    active_agents=data.get('active_agents')
                )
            
            # Broadcast via NiceGUI UI updates
            await self._update_ui_clients(event_type, data)
            
        except Exception as e:
            logger.error(f"Error broadcasting system event: {e}")
    
    async def emit_to_user(self, user_id: str, event_type: str, data: Dict[str, Any]):
        """Emit event to a specific user.
        
        Args:
            user_id: Target user ID
            event_type: Type of event
            data: Event data
        """
        try:
            # Find client for user and send update
            await self._update_specific_user(user_id, event_type, data)
            
        except Exception as e:
            logger.error(f"Error emitting to user {user_id}: {e}")
    
    async def _update_ui_clients(self, event_type: str, data: Dict[str, Any]):
        """Update all connected UI clients.
        
        Args:
            event_type: Type of event
            data: Event data
        """
        try:
            # Use ui.run_javascript to send events to all clients
            js_code = f"""
            if (window.websocketEventHandler) {{
                window.websocketEventHandler({{
                    type: '{event_type}',
                    data: {json.dumps(data)}
                }});
            }}
            """
            
            # Fire and forget - don't await on auto-index page
            # Simply execute without awaiting
            ui.run_javascript(js_code)
            
        except Exception as e:
            logger.error(f"Error updating UI clients: {e}")
    
    async def _update_specific_user(self, user_id: str, event_type: str, data: Dict[str, Any]):
        """Update a specific user's UI.
        
        Args:
            user_id: Target user ID
            event_type: Type of event
            data: Event data
        """
        try:
            # In NiceGUI, we need to use a different approach for user-specific updates
            # We'll use a JavaScript check for the user ID
            js_code = f"""
            if (window.currentUserId === '{user_id}' && window.websocketEventHandler) {{
                window.websocketEventHandler({{
                    type: '{event_type}',
                    data: {json.dumps(data)}
                }});
            }}
            """
            
            # Fire and forget - don't await on auto-index page
            ui.run_javascript(js_code)
            
        except Exception as e:
            logger.error(f"Error updating specific user {user_id}: {e}")
    
    async def _broadcast_to_users(self, event_type: str, data: Dict[str, Any], user_ids: Optional[List[str]] = None):
        """Broadcast event to specific users or all users.
        
        This method is provided for compatibility but uses the UI update methods internally.
        
        Args:
            event_type: Type of event
            data: Event data
            user_ids: Optional list of user IDs to target
        """
        try:
            if user_ids is None:
                # Broadcast to all
                await self._update_ui_clients(event_type, data)
            else:
                # Broadcast to specific users
                for user_id in user_ids:
                    await self._update_specific_user(user_id, event_type, data)
                    
        except Exception as e:
            logger.error(f"Error in broadcast: {e}")
    
    async def _send_to_client(self, client: Any, event_type: str, data: Dict[str, Any]):
        """Send event to a specific client.
        
        This method is provided for compatibility.
        
        Args:
            client: Client object (not used in this implementation)
            event_type: Type of event
            data: Event data
        """
        # In this implementation, we use JavaScript-based updates
        await self._update_ui_clients(event_type, data)


class RealtimeUIUpdater:
    """Manages real-time UI updates based on WebSocket events."""
    
    def __init__(self, broadcaster: Optional['WebSocketBroadcaster'] = None):
        """Initialize the UI updater.
        
        Args:
            broadcaster: Optional WebSocket broadcaster instance
        """
        self.broadcaster = broadcaster
        self.ui_elements = {}
        self.event_handlers = {
            'agent_message': self.handle_agent_message,
            'agent_processing_started': self.handle_agent_processing_started,  # NEW
            'agent_processing_update': self.handle_agent_processing_update,    # NEW
            'agent_processing_complete': self.handle_agent_processing_complete, # NEW
            'network_update': self.handle_network_update,
            'system_status': self.handle_system_status,
            'health_update': self.handle_health_update,
            'emergency_status': self.handle_emergency_status
        }
        self._active_animations = {}
        self._message_counter = 0
        self._first_message_received = False
        
        # Subscribe to WebSocket events
        self._subscribe_to_events()
        
    def register_element(self, element_id: str, element: Any):
        """Register a UI element for updates.
        
        Args:
            element_id: Unique identifier for the element
            element: The NiceGUI element to update
        """
        self.ui_elements[element_id] = element
        logger.debug(f"Registered UI element: {element_id}")
        
    
    def handle_agent_message(self, event: WebSocketEvent):
        """Handle agent message events with visual updates."""
        data = event.data
        self._message_counter += 1
        
        # Update message counter element if registered
        if 'message_counter' in self.ui_elements:
            try:
                self.ui_elements['message_counter'].set_text(f'Messages: {self._message_counter}')
            except:
                pass
        
        # Note: JavaScript updates are handled by the WebSocketEventBroadcaster
        # which sends events to the client via the proper WebSocket channel
    def handle_agent_processing_started(self, event: WebSocketEvent):
        """Handle agent processing started events."""
        data = event.data
        
        # Update status element if registered
        if 'agent_status' in self.ui_elements:
            try:
                self.ui_elements['agent_status'].set_text(f"{data['agent_id']}: Processing...")
            except:
                pass
    def handle_agent_processing_update(self, event: WebSocketEvent):
        """Handle streaming updates during agent processing."""
        data = event.data
        
        # Note: Streaming updates are handled by the WebSocket connection
        # The client-side JavaScript will receive these events and update the UI
    def handle_health_update(self, event: WebSocketEvent):
        """Handle health metric updates with visual indicators."""
        data = event.data
        
        # Update health indicators with color coding
        for metric, value in data.items():
            if metric in self.ui_elements:
                element = self.ui_elements[metric]
                
                # Update progress bar
                if hasattr(element, 'set_value'):
                    element.set_value(value)
                    
                # Color coding based on thresholds
                color = self._get_health_color(metric, value)
                element.classes(f'bg-{color}-500', remove='bg-red-500 bg-yellow-500 bg-green-500')
                
                # Add warning animation for critical values
                if color == 'red':
                    ui.run_javascript(f"""
                        const element = document.querySelector('[data-metric="{metric}"]');
                        if (element) {{
                            element.classList.add('animate-pulse');
                        }}
                    """)
    
    def handle_emergency_status(self, event: WebSocketEvent):
        """Handle emergency status updates with alerts."""
        data = event.data
        
        if 'emergency_status' in self.ui_elements:
            try:
                is_emergency = data.get('emergency_mode', False)
                
                if is_emergency:
                    self.ui_elements['emergency_status'].set_text('🚨 EMERGENCY MODE ACTIVE')
                    self.ui_elements['emergency_status'].classes('text-red-500 animate-pulse font-bold')
                else:
                    self.ui_elements['emergency_status'].set_text('✅ Normal Operation')
                    self.ui_elements['emergency_status'].classes('text-green-400',
                        remove='text-red-500 animate-pulse font-bold')
            except:
                pass
    def handle_agent_processing_started(self, event: WebSocketEvent):
        """Handle agent processing started events."""
        data = event.data
        
        # Update status element if registered
        if 'agent_status' in self.ui_elements:
            try:
                self.ui_elements['agent_status'].set_text(f"{data['agent_id']}: Processing...")
            except:
                pass
    def handle_agent_processing_update(self, event: WebSocketEvent):
        """Handle streaming updates during agent processing."""
        data = event.data
        
        # Note: Streaming updates are handled by the WebSocket connection
        # The client-side JavaScript will receive these events and update the UI
    def handle_agent_processing_complete(self, event: WebSocketEvent):
        """Handle agent processing complete events."""
        data = event.data
        
        # Note: The completion event will be handled by the client-side JavaScript
        # The WebSocket system will deliver the event properly
    def _flash_notification(self, message: str):
        """Show a temporary notification flash."""
        # Note: Notifications should be handled by the client-side code
        # when it receives the WebSocket events
        pass
    def _get_agent_color(self, agent_id: str) -> str:
        """Get color for agent based on ID."""
        colors = {
            'Shadow': 'gray-600',
            'Persona': 'blue-600',
            'Anima/Animus': 'purple-600',
            'Self': 'orange-600',
            'Ego': 'green-600'
        }
        return colors.get(agent_id, 'gray-400')
    

    def _parse_thinking_content(self, text: str) -> dict:
        """Parse AI thinking tags and structure content for display."""
        import re
        
        # Patterns for different thinking tags
        patterns = {
            'think': r'<think>(.*?)</think>',
            'thinking': r'<thinking>(.*?)</thinking>',
            'reflection': r'<reflection>(.*?)</reflection>',
            'reasoning': r'<reasoning>(.*?)</reasoning>',
            'analysis': r'<analysis>(.*?)</analysis>',
            'thought': r'<thought>(.*?)</thought>',
        }
        
        thinking_sections = []
        main_content = text
        
        # Extract all thinking sections
        for tag_type, pattern in patterns.items():
            matches = re.finditer(pattern, text, re.DOTALL | re.IGNORECASE)
            for match in matches:
                thinking_content = match.group(1).strip()
                if thinking_content:
                    # Generate a one-line summary (first sentence or first 100 chars)
                    summary = thinking_content.split('.')[0].strip()
                    if len(summary) > 100:
                        summary = summary[:97] + '...'
                    
                    thinking_sections.append({
                        'type': tag_type,
                        'content': thinking_content,
                        'summary': summary
                    })
                
                # Remove from main content
                main_content = main_content.replace(match.group(0), '')
        
        # Clean up extra whitespace in main content
        main_content = re.sub(r'\s+', ' ', main_content).strip()
        
        return {
            'main_content': main_content,
            'thinking_sections': thinking_sections,
            'has_thinking': len(thinking_sections) > 0
        }

    def _get_sentiment_color(self, score: float) -> str:
        """Get color based on sentiment score."""
        if score > 0.6:
            return 'green-400'
        elif score > 0.3:
            return 'yellow-400'
        else:
            return 'red-400'
    
    def _get_health_color(self, metric: str, value: float) -> str:
        """Get color for health metric based on value."""
        if metric in ['stagnation', 'repetition']:
            if value > 0.7:
                return 'red'
            elif value > 0.4:
                return 'yellow'
            else:
                return 'green'
        elif metric in ['engagement', 'diversity']:
            if value < 0.3:
                return 'red'
            elif value < 0.6:
                return 'yellow'
            else:
                return 'green'
        else:
            if value > 0.8 or value < 0.2:
                return 'red'
            elif value > 0.6 or value < 0.4:
                return 'yellow'
            else:
                return 'green'
    
    def _subscribe_to_events(self):
        """Subscribe to WebSocket events from the event manager."""
        from .websocket_events import get_event_manager, EventType
        event_manager = get_event_manager()
        
        # Subscribe to all event types we handle
        event_types_map = {
            EventType.AGENT_MESSAGE: self.handle_agent_message,
            EventType.AGENT_PROCESSING_STARTED: self.handle_agent_processing_started,
            EventType.AGENT_PROCESSING_UPDATE: self.handle_agent_processing_update,
            EventType.AGENT_PROCESSING_COMPLETE: self.handle_agent_processing_complete,
            EventType.NETWORK_UPDATE: self.handle_network_update,
            EventType.SYSTEM_STATUS: self.handle_system_status,
        }
        
        for event_type, handler in event_types_map.items():
            event_manager.subscribe(event_type, handler)
            logger.info(f"RealtimeUIUpdater subscribed to {event_type.value}")


# Alias for compatibility
WebSocketBroadcaster = WebSocketEventBroadcaster


# Global broadcaster instance
_broadcaster: Optional[WebSocketEventBroadcaster] = None


def get_broadcaster() -> WebSocketEventBroadcaster:
    """Get or create the global broadcaster instance.
    
    Returns:
        The global WebSocketEventBroadcaster instance
    """
    global _broadcaster
    
    if _broadcaster is None:
        _broadcaster = WebSocketEventBroadcaster()
    
    return _broadcaster