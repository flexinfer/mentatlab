"""Enhanced WebSocket event system for real-time visualization.

This module provides structured event types and handlers for real-time
communication between the simulation backend and frontend visualization.
Implements the event schema specified in REALTIME_VISUALIZATION_ARCHITECTURE.md.
"""

import asyncio
import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import TypedDict, Union, List, Optional, Dict, Any, Callable
from dataclasses import dataclass, asdict, field
from enum import Enum
from queue import Queue, Empty
import uuid

logger = logging.getLogger(__name__)


class EventType(str, Enum):
    """Enumeration of WebSocket event types."""
    AGENT_MESSAGE = "agent_message"
    NETWORK_UPDATE = "network_update"
    SYSTEM_STATUS = "system_status"
    USER_SESSION = "user_session"
    USER_AUTH = "user_auth"
    
    # Real-time processing events
    AGENT_PROCESSING_STARTED = "agent_processing_started"
    AGENT_PROCESSING_UPDATE = "agent_processing_update"
    AGENT_PROCESSING_COMPLETE = "agent_processing_complete"


class SentimentType(str, Enum):
    """Enumeration of sentiment types for agent messages."""
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"
    MIXED = "mixed"


class SystemHealthStatus(str, Enum):
    """System health status levels."""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    CRITICAL = "critical"


# TypedDict definitions for event schemas
class SentimentData(TypedDict):
    """Sentiment data structure."""
    score: float
    label: str


class AgentMessageData(TypedDict):
    """Data structure for agent message events."""
    type: str
    timestamp: str
    agent_id: str
    recipient: str
    content: str
    message_type: str  # normal|emergency
    sentiment: SentimentData
    metadata: Dict[str, Any]


class NetworkConnection(TypedDict):
    """Data structure for network connections."""
    from_: str  # 'from' is reserved, using 'from_'
    to: str
    strength: float
    active: bool


class NetworkMetrics(TypedDict):
    """Network performance metrics."""
    total_messages: int
    avg_response_time: float
    network_health: float


class NetworkUpdateData(TypedDict):
    """Data structure for network update events."""
    type: str
    timestamp: str
    connections: List[NetworkConnection]
    metrics: NetworkMetrics
    performance: Dict[str, Any]


class ResourceUsage(TypedDict):
    """Resource usage metrics."""
    cpu_percent: float
    memory_percent: float
    memory_mb: int
    active_threads: int


class SystemStatusData(TypedDict):
    """Data structure for system status events."""
    type: str
    timestamp: str
    status: str  # healthy|degraded|critical
    active_agents: List[str]
    resource_usage: ResourceUsage


class UserSessionData(TypedDict):
    """Data structure for user session events."""
    type: str
    timestamp: str
    session_id: str
    user_id: str
    username: str
    action: str  # created|terminated|updated|joined
    session_type: str  # single_user|shared|observer_only
    participant_count: int
    metadata: Dict[str, Any]


class UserAuthData(TypedDict):
    """Data structure for user authentication events."""
    type: str
    timestamp: str
    user_id: str
    username: str
    action: str  # login|logout|registration|password_change
    role: str
    success: bool
    metadata: Dict[str, Any]


# Union type for all event data types
EventData = Union[AgentMessageData, NetworkUpdateData, SystemStatusData, UserSessionData, UserAuthData]


@dataclass
class WebSocketEvent:
    """Base class for all WebSocket events with validation and serialization."""
    
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    type: EventType = field(default=None)
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    
    def __post_init__(self):
        """Validate event data after initialization."""
        self._validate()
    
    def _validate(self):
        """Validate event structure and data."""
        if not isinstance(self.type, EventType):
            raise ValueError(f"Invalid event type: {self.type}")
        
        if not isinstance(self.data, dict):
            raise ValueError("Event data must be a dictionary")
        
        # Ensure data includes type and timestamp
        self.data['type'] = self.type.value
        self.data['timestamp'] = self.timestamp
        
        # Validate timestamp format
        try:
            datetime.fromisoformat(self.timestamp.replace('Z', '+00:00'))
        except ValueError:
            raise ValueError(f"Invalid timestamp format: {self.timestamp}")
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert event to dictionary for serialization."""
        return {
            "event_id": self.event_id,
            "type": self.type.value,
            "data": self.data,
            "timestamp": self.timestamp
        }
    
    def to_json(self) -> str:
        """Convert event to JSON string."""
        return json.dumps(self.to_dict(), default=str)


class WebSocketEventManager:
    """Thread-safe manager for WebSocket events with Redis integration."""
    
    def __init__(self, redis_manager=None):
        """Initialize the WebSocket event manager.
        
        Args:
            redis_manager: Optional Redis manager for pub/sub integration
        """
        self.redis_manager = redis_manager
        self.event_queue: Queue[WebSocketEvent] = Queue()
        self.subscribers: Dict[str, List[Callable]] = {}
        self.lock = threading.RLock()
        self.running = False
        self.worker_thread = None
        
        # Event statistics
        self.event_counts = {event_type: 0 for event_type in EventType}
        self.last_event_time = {event_type: None for event_type in EventType}
        
        # Start worker thread
        self.start()
    
    def start(self):
        """Start the event manager worker thread."""
        with self.lock:
            if not self.running:
                self.running = True
                self.worker_thread = threading.Thread(
                    target=self._process_events,
                    daemon=True
                )
                self.worker_thread.start()
                logger.info("WebSocket event manager started")
    
    def stop(self):
        """Stop the event manager worker thread."""
        with self.lock:
            if self.running:
                self.running = False
                if self.worker_thread:
                    self.worker_thread.join(timeout=5)
                logger.info("WebSocket event manager stopped")
    
    def _process_events(self):
        """Process events from the queue and distribute to subscribers."""
        while self.running:
            try:
                event = self.event_queue.get(timeout=0.1)
                self._distribute_event(event)
                
                # Update statistics
                with self.lock:
                    self.event_counts[event.type] += 1
                    self.last_event_time[event.type] = event.timestamp
                
                # Publish to Redis if available
                if self.redis_manager and hasattr(self.redis_manager, 'publish_real_time_update'):
                    self._publish_to_redis(event)
                    
            except Empty:
                continue
            except Exception as e:
                logger.error(f"Error processing event: {e}")
    
    def _distribute_event(self, event: WebSocketEvent):
        """Distribute event to all subscribers."""
        with self.lock:
            # Get subscribers for event type
            type_subscribers = self.subscribers.get(event.type.value, [])
            all_subscribers = self.subscribers.get('*', [])
            
            subscribers_to_notify = list(set(type_subscribers + all_subscribers))
        
        for subscriber in subscribers_to_notify:
            try:
                # Call subscriber with event
                if asyncio.iscoroutinefunction(subscriber):
                    # For async subscribers, we need to handle them properly
                    # Since we're in a thread, we need to get or create an event loop
                    try:
                        loop = asyncio.get_running_loop()
                        asyncio.create_task(subscriber(event))
                    except RuntimeError:
                        # No running loop in this thread
                        # For NiceGUI, we should use the main thread's loop
                        import threading
                        main_thread = threading.main_thread()
                        
                        # Try to get the main thread's event loop
                        if hasattr(main_thread, '_loop'):
                            loop = main_thread._loop
                            asyncio.run_coroutine_threadsafe(subscriber(event), loop)
                        else:
                            # Create a new event loop for this thread if needed
                            if not hasattr(self, '_thread_loop'):
                                self._thread_loop = asyncio.new_event_loop()
                                # Run the loop in a separate thread
                                import threading
                                def run_loop():
                                    asyncio.set_event_loop(self._thread_loop)
                                    self._thread_loop.run_forever()
                                
                                loop_thread = threading.Thread(target=run_loop, daemon=True)
                                loop_thread.start()
                            
                            asyncio.run_coroutine_threadsafe(subscriber(event), self._thread_loop)
                else:
                    subscriber(event)
            except Exception as e:
                logger.error(f"Error in subscriber {subscriber}: {e}")
    
    def _publish_to_redis(self, event: WebSocketEvent):
        """Publish event to Redis pub/sub channel."""
        try:
            channel = f"websocket:events:{event.type.value}"
            self.redis_manager.publish_real_time_update(
                f"events:{event.type.value}",
                event.to_dict()
            )
        except Exception as e:
            logger.error(f"Error publishing to Redis: {e}")
    
    def subscribe(self, event_type: Union[EventType, str], callback: Callable[[WebSocketEvent], None]):
        """Subscribe to WebSocket events.
        
        Args:
            event_type: Event type to subscribe to, or '*' for all events
            callback: Function to call when events are received
        """
        with self.lock:
            key = event_type.value if isinstance(event_type, EventType) else event_type
            if key not in self.subscribers:
                self.subscribers[key] = []
            self.subscribers[key].append(callback)
    
    def unsubscribe(self, event_type: Union[EventType, str], callback: Callable[[WebSocketEvent], None]):
        """Unsubscribe from WebSocket events.
        
        Args:
            event_type: Event type to unsubscribe from
            callback: Function to remove from subscribers
        """
        with self.lock:
            key = event_type.value if isinstance(event_type, EventType) else event_type
            if key in self.subscribers and callback in self.subscribers[key]:
                self.subscribers[key].remove(callback)
                if not self.subscribers[key]:
                    del self.subscribers[key]
    
    def emit_event(self, event: WebSocketEvent):
        """Emit a WebSocket event.
        
        Args:
            event: The event to emit
        """
        self.event_queue.put(event)
    
    def create_agent_message(self, agent_id: str, recipient: str, 
                           content: str, sentiment: Optional[Dict[str, Any]] = None,
                           message_type: str = "normal",
                           metadata: Optional[Dict[str, Any]] = None) -> WebSocketEvent:
        """Create an agent message event.
        
        Args:
            agent_id: Unique identifier for the agent
            recipient: Recipient agent ID
            content: The message content
            sentiment: Sentiment analysis results
            message_type: Type of message (normal or emergency)
            metadata: Additional metadata
        
        Returns:
            WebSocketEvent for agent message
        """
        sentiment_data: SentimentData = {
            "score": sentiment.get("score", 0.0) if sentiment else 0.0,
            "label": sentiment.get("label", "neutral") if sentiment else "neutral"
        }
        
        data: AgentMessageData = {
            "type": EventType.AGENT_MESSAGE.value,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent_id": agent_id,
            "recipient": recipient,
            "content": content,
            "message_type": message_type,
            "sentiment": sentiment_data,
            "metadata": metadata or {}
        }
        
        return WebSocketEvent(type=EventType.AGENT_MESSAGE, data=data)
    
    def create_network_update(self, connections: List[NetworkConnection],
                            metrics: NetworkMetrics,
                            performance: Optional[Dict[str, Any]] = None) -> WebSocketEvent:
        """Create a network update event.
        
        Args:
            connections: List of network connections
            metrics: Network performance metrics
            performance: Additional performance data
        
        Returns:
            WebSocketEvent for network update
        """
        data: NetworkUpdateData = {
            "type": EventType.NETWORK_UPDATE.value,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "connections": connections,
            "metrics": metrics,
            "performance": performance or {}
        }
        
        return WebSocketEvent(type=EventType.NETWORK_UPDATE, data=data)
    
    def create_system_status(self, status: str, active_agents: List[str],
                           resource_usage: ResourceUsage) -> WebSocketEvent:
        """Create a system status event.
        
        Args:
            status: System health status (healthy, degraded, critical)
            active_agents: List of active agent IDs
            resource_usage: Resource usage metrics
        
        Returns:
            WebSocketEvent for system status
        """
        data: SystemStatusData = {
            "type": EventType.SYSTEM_STATUS.value,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": status,
            "active_agents": active_agents,
            "resource_usage": resource_usage
        }
        
        return WebSocketEvent(type=EventType.SYSTEM_STATUS, data=data)
    
    def create_user_session_event(self, session_id: str, user_id: str, username: str,
                                 action: str, session_type: str = "single_user",
                                 participant_count: int = 1,
                                 metadata: Optional[Dict[str, Any]] = None) -> WebSocketEvent:
        """Create a user session event.
        
        Args:
            session_id: Session identifier
            user_id: User identifier
            username: Username
            action: Action performed (created, terminated, updated, joined)
            session_type: Type of session
            participant_count: Number of participants
            metadata: Additional metadata
        
        Returns:
            WebSocketEvent for user session
        """
        data: UserSessionData = {
            "type": EventType.USER_SESSION.value,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "session_id": session_id,
            "user_id": user_id,
            "username": username,
            "action": action,
            "session_type": session_type,
            "participant_count": participant_count,
            "metadata": metadata or {}
        }
        
        return WebSocketEvent(type=EventType.USER_SESSION, data=data)
    
    def create_user_auth_event(self, user_id: str, username: str, action: str,
                              role: str, success: bool = True,
                              metadata: Optional[Dict[str, Any]] = None) -> WebSocketEvent:
        """Create a user authentication event.
        
        Args:
            user_id: User identifier
            username: Username
            action: Authentication action (login, logout, registration, password_change)
            role: User role
            success: Whether the action was successful
            metadata: Additional metadata
        
        Returns:
            WebSocketEvent for user authentication
        """
        data: UserAuthData = {
            "type": EventType.USER_AUTH.value,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "user_id": user_id,
            "username": username,
            "action": action,
            "role": role,
            "success": success,
            "metadata": metadata or {}
        }
        
        return WebSocketEvent(type=EventType.USER_AUTH, data=data)
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get event statistics.
        
        Returns:
            Dictionary with event counts and last event times
        """
        with self.lock:
            return {
                "event_counts": self.event_counts.copy(),
                "last_event_time": self.last_event_time.copy(),
                "subscriber_count": sum(len(subs) for subs in self.subscribers.values()),
                "queue_size": self.event_queue.qsize()
            }


# Global event manager instance
_event_manager: Optional[WebSocketEventManager] = None
_manager_lock = threading.Lock()


def get_event_manager(redis_manager=None) -> WebSocketEventManager:
    """Get or create the global event manager instance.
    
    Args:
        redis_manager: Optional Redis manager for integration
    
    Returns:
        The global WebSocketEventManager instance
    """
    global _event_manager
    
    with _manager_lock:
        if _event_manager is None:
            _event_manager = WebSocketEventManager(redis_manager)
    
    return _event_manager


# Integration helper functions
def broadcast_agent_message(agent_id: str, agent_type: str, message: str,
                          sentiment_data: Optional[Dict[str, Any]] = None,
                          metadata: Optional[Dict[str, Any]] = None):
    """Helper function to broadcast agent messages.
    
    Args:
        agent_id: The agent's unique identifier
        agent_type: The type of agent
        message: The message content
        sentiment_data: Optional sentiment analysis results
        metadata: Optional additional metadata
    """
    manager = get_event_manager()
    
    # Merge agent type into metadata
    if metadata is None:
        metadata = {}
    metadata['agent_type'] = agent_type
    
    event = manager.create_agent_message(
        agent_id=agent_id,
        recipient="all",  # Broadcast to all
        content=message,
        sentiment=sentiment_data,
        message_type="normal",
        metadata=metadata
    )
    
    manager.emit_event(event)


def broadcast_network_update(connections: Optional[List[Dict[str, Any]]] = None,
                           communication_stats: Optional[Dict[str, Any]] = None,
                           event_type: Optional[str] = None,
                           details: Optional[Dict[str, Any]] = None,
                           agent_network=None):
    """Helper function to broadcast network updates.
    
    This function supports two calling styles:
    1. New style with keyword arguments (connections, communication_stats, etc.)
    2. Old style with single agent_network argument for backward compatibility
    
    Args:
        connections: List of network connections (new style)
        communication_stats: Communication statistics (new style)
        event_type: Type of network event (new style)
        details: Additional event details (new style)
        agent_network: The agent network instance (old style)
    """
    manager = get_event_manager()
    
    # Handle old-style call with agent_network
    if agent_network is not None and connections is None:
        # Extract network data from agent_network
        connections = []
        
        # Get communication matrix
        if hasattr(agent_network, 'get_communication_matrix'):
            matrix = agent_network.get_communication_matrix()
            for from_agent, targets in matrix.items():
                for to_agent, strength in targets.items():
                    if strength > 0:
                        connections.append({
                            "from_": from_agent,
                            "to": to_agent,
                            "strength": strength,
                            "active": True
                        })
        
        # Get network statistics
        metrics: NetworkMetrics = {
            "total_messages": 0,
            "avg_response_time": 0.0,
            "network_health": 1.0
        }
        
        if hasattr(agent_network, 'get_stats'):
            stats = agent_network.get_stats()
            # Calculate total messages
            for agent_stats in stats.values():
                metrics["total_messages"] += agent_stats.get("sent", 0)
        
        # Get emergency mode status
        performance = {}
        if hasattr(agent_network, 'get_emergency_status'):
            emergency_status = agent_network.get_emergency_status()
            performance["emergency_mode"] = emergency_status.get("emergency_mode", False)
            performance["stagnation_level"] = emergency_status.get("current_stagnation", 0.0)
    
    # Handle new-style call with keyword arguments
    else:
        # Convert connections format if needed
        if connections:
            for conn in connections:
                # Ensure we use 'from_' key for TypedDict compatibility
                if 'from' in conn and 'from_' not in conn:
                    conn['from_'] = conn.pop('from')
        
        # Build metrics from communication_stats if provided
        metrics: NetworkMetrics = {
            "total_messages": 0,
            "avg_response_time": 0.0,
            "network_health": 1.0
        }
        
        if communication_stats:
            # Calculate total messages from stats
            for agent_stats in communication_stats.values():
                metrics["total_messages"] += agent_stats.get("sent", 0)
        
        # Build performance data from details
        performance = {}
        if details:
            if 'stagnation' in details:
                performance["stagnation_level"] = details['stagnation']
            if 'emergency_mode' in details:
                performance["emergency_mode"] = details['emergency_mode']
            # Add event_type to performance if provided
            if event_type:
                performance["event_type"] = event_type
            # Merge all other details
            performance.update(details)
    
    event = manager.create_network_update(
        connections=connections,
        metrics=metrics,
        performance=performance
    )
    
    manager.emit_event(event)


def broadcast_system_status(is_running: bool, performance_data: Optional[Dict[str, Any]] = None,
                          active_agents: Optional[List[str]] = None):
    """Helper function to broadcast system status.
    
    Args:
        is_running: Whether the system is running
        performance_data: Optional performance metrics
        active_agents: Optional list of active agents
    """
    manager = get_event_manager()
    
    # Determine health status
    health = SystemHealthStatus.HEALTHY.value
    
    if performance_data:
        cpu = performance_data.get("cpu_percent", 0)
        memory = performance_data.get("memory_percent", 0)
        errors = performance_data.get("error_count", 0)
        
        if cpu > 90 or memory > 90 or errors > 100:
            health = SystemHealthStatus.CRITICAL.value
        elif cpu > 70 or memory > 70 or errors > 50:
            health = SystemHealthStatus.DEGRADED.value
    
    if not is_running:
        health = SystemHealthStatus.CRITICAL.value
    
    # Build resource usage
    resource_usage: ResourceUsage = {
        "cpu_percent": performance_data.get("cpu_percent", 0.0) if performance_data else 0.0,
        "memory_percent": performance_data.get("memory_percent", 0.0) if performance_data else 0.0,
        "memory_mb": performance_data.get("memory_mb", 0) if performance_data else 0,
        "active_threads": performance_data.get("active_threads", threading.active_count()) if performance_data else threading.active_count()
    }
    
    event = manager.create_system_status(
        status=health,
        active_agents=active_agents or [],
        resource_usage=resource_usage
    )
    
    manager.emit_event(event)


def broadcast_user_login(user_id: str, username: str, role: str, session_id: str):
    """Helper function to broadcast user login events.
    
    Args:
        user_id: User identifier
        username: Username
        role: User role
        session_id: Session identifier created for the user
    """
    manager = get_event_manager()
    
    # Broadcast auth event
    auth_event = manager.create_user_auth_event(
        user_id=user_id,
        username=username,
        action="login",
        role=role,
        success=True,
        metadata={"session_id": session_id}
    )
    manager.emit_event(auth_event)
    
    # Broadcast session creation event
    session_event = manager.create_user_session_event(
        session_id=session_id,
        user_id=user_id,
        username=username,
        action="created",
        session_type="single_user",
        participant_count=1,
        metadata={"created_on_login": True}
    )
    manager.emit_event(session_event)


def broadcast_user_logout(user_id: str, username: str, role: str, session_id: Optional[str] = None):
    """Helper function to broadcast user logout events.
    
    Args:
        user_id: User identifier
        username: Username
        role: User role
        session_id: Optional session identifier
    """
    manager = get_event_manager()
    
    # Broadcast auth event
    auth_event = manager.create_user_auth_event(
        user_id=user_id,
        username=username,
        action="logout",
        role=role,
        success=True,
        metadata={"session_id": session_id} if session_id else {}
    )
    manager.emit_event(auth_event)
    
    # Broadcast session termination if session_id provided
    if session_id:
        session_event = manager.create_user_session_event(
            session_id=session_id,
            user_id=user_id,
            username=username,
            action="terminated",
            session_type="single_user",
            participant_count=0,
            metadata={"terminated_on_logout": True}
        )
        manager.emit_event(session_event)


def broadcast_session_update(session_id: str, user_id: str, username: str,
                            action: str, session_type: str = "single_user",
                            participant_count: int = 1, metadata: Optional[Dict[str, Any]] = None):
    """Helper function to broadcast session update events.
    
    Args:
        session_id: Session identifier
        user_id: User identifier
        username: Username
        action: Action performed (updated, joined, etc.)
        session_type: Type of session
        participant_count: Number of participants
        metadata: Additional metadata
    """
    manager = get_event_manager()
    
    session_event = manager.create_user_session_event(
        session_id=session_id,
        user_id=user_id,
        username=username,
        action=action,
        session_type=session_type,
        participant_count=participant_count,
        metadata=metadata or {}
    )
    manager.emit_event(session_event)


def broadcast_agent_processing_started(
    agent_id: str,
    agent_type: str,
    situation: str,
    metadata: Optional[Dict[str, Any]] = None
) -> None:
    """Broadcast that an agent has started processing.
    
    Args:
        agent_id: Agent identifier
        agent_type: Type of agent
        situation: Current situation being processed
        metadata: Additional metadata
    """
    manager = get_event_manager()
    
    event_data = {
        "type": EventType.AGENT_PROCESSING_STARTED.value,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent_id": agent_id,
        "agent_type": agent_type,
        "situation": situation,
        "metadata": metadata or {}
    }
    
    event = WebSocketEvent(type=EventType.AGENT_PROCESSING_STARTED, data=event_data)
    manager.emit_event(event)


def broadcast_agent_processing_update(
    agent_id: str,
    partial_content: str,
    progress: float,
    metadata: Optional[Dict[str, Any]] = None
) -> None:
    """Broadcast partial update during agent processing.
    
    Args:
        agent_id: Agent identifier
        partial_content: Partial content being generated
        progress: Progress percentage (0.0 to 1.0)
        metadata: Additional metadata
    """
    manager = get_event_manager()
    
    event_data = {
        "type": EventType.AGENT_PROCESSING_UPDATE.value,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent_id": agent_id,
        "partial_content": partial_content,
        "progress": progress,
        "metadata": metadata or {}
    }
    
    event = WebSocketEvent(type=EventType.AGENT_PROCESSING_UPDATE, data=event_data)
    manager.emit_event(event)


def broadcast_agent_processing_complete(
    agent_id: str,
    final_content: str,
    sentiment_data: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None
) -> None:
    """Broadcast that agent processing is complete.
    
    Args:
        agent_id: Agent identifier
        final_content: Final generated content
        sentiment_data: Sentiment analysis results
        metadata: Additional metadata
    """
    manager = get_event_manager()
    
    event_data = {
        "type": EventType.AGENT_PROCESSING_COMPLETE.value,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent_id": agent_id,
        "final_content": final_content,
        "sentiment": sentiment_data or {"score": 0.0, "label": "neutral"},
        "metadata": metadata or {}
    }
    
    event = WebSocketEvent(type=EventType.AGENT_PROCESSING_COMPLETE, data=event_data)
    manager.emit_event(event)


# Example usage and testing
if __name__ == "__main__":
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    # Create event manager
    manager = get_event_manager()
    
    # Example subscriber
    def print_event(event: WebSocketEvent):
        print(f"Received event: {event.to_dict()}")
    
    manager.subscribe(EventType.AGENT_MESSAGE, print_event)
    manager.subscribe(EventType.NETWORK_UPDATE, print_event)
    manager.subscribe(EventType.SYSTEM_STATUS, print_event)
    
    # Test events
    print("Testing WebSocket event system...")
    
    # Agent message
    broadcast_agent_message(
        agent_id="ego_001",
        agent_type="ego",
        message="Processing integration request",
        sentiment_data={"score": 0.75, "label": "positive"}
    )
    
    # System status
    broadcast_system_status(
        is_running=True,
        performance_data={
            "cpu_percent": 35.2,
            "memory_percent": 42.8,
            "error_count": 0
        },
        active_agents=["ego_001", "shadow_001"]
    )
    
    # Give time for events to process
    time.sleep(1)
    
    # Print statistics
    print(f"\nEvent statistics: {manager.get_statistics()}")
    
    # Clean up
    manager.stop()