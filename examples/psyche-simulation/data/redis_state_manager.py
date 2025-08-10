"""
Redis State Manager for Psyche Simulation
Implements Redis integration for real-time state management and pub/sub messaging
Based on REALTIME_VISUALIZATION_ARCHITECTURE.md (lines 399-443)
"""

import redis
import json
import time
import logging
import threading
from typing import Dict, List, Optional, Any, Callable
from datetime import datetime, timedelta
from contextlib import contextmanager
from redis.exceptions import ConnectionError, TimeoutError, RedisError

logger = logging.getLogger(__name__)


class RedisStateManager:
    """
    Thread-safe Redis state manager for the Psyche Simulation system.
    
    Provides:
    - Connection pooling with automatic reconnection
    - Conversation storage and retrieval with TTL
    - Agent state management with atomic operations
    - Real-time pub/sub for live updates
    - Comprehensive error handling and fallback mechanisms
    """
    
    def __init__(
        self,
        redis_url: str = "redis://localhost:6379",
        db: int = 0,
        max_connections: int = 50,
        socket_timeout: int = 5,
        retry_on_timeout: bool = True,
        decode_responses: bool = True
    ):
        """
        Initialize Redis State Manager with connection pooling.
        
        Args:
            redis_url: Redis connection URL
            db: Redis database number
            max_connections: Maximum number of connections in the pool
            socket_timeout: Socket timeout in seconds
            retry_on_timeout: Whether to retry operations on timeout
            decode_responses: Whether to decode responses to strings
        """
        self.redis_url = redis_url
        self.db = db
        self._lock = threading.RLock()
        self._pubsub_lock = threading.Lock()
        self._subscribers: Dict[str, List[Callable]] = {}
        self._pubsub_thread = None
        self._running = False
        
        # Create connection pool for better performance
        self.pool = redis.ConnectionPool.from_url(
            redis_url,
            db=db,
            max_connections=max_connections,
            socket_timeout=socket_timeout,
            retry_on_timeout=retry_on_timeout,
            decode_responses=decode_responses
        )
        
        self._client = None
        self._pubsub = None
        self._connect()
    
    def _connect(self) -> bool:
        """Establish Redis connection with error handling."""
        try:
            self._client = redis.Redis(connection_pool=self.pool)
            # Test connection
            self._client.ping()
            logger.info(f"Redis connection established: {self.redis_url}")
            return True
        except (ConnectionError, TimeoutError) as e:
            logger.error(f"Failed to connect to Redis: {e}")
            self._client = None
            return False
        except Exception as e:
            logger.error(f"Unexpected error connecting to Redis: {e}")
            self._client = None
            return False
    
    @contextmanager
    def _redis_operation(self, operation_name: str = "operation"):
        """Context manager for Redis operations with error handling."""
        if not self._client:
            if not self._connect():
                logger.warning(f"Redis {operation_name} skipped - no connection")
                yield None
                return
        
        try:
            yield self._client
        except (ConnectionError, TimeoutError) as e:
            logger.error(f"Redis {operation_name} failed - connection error: {e}")
            self._client = None
            yield None
        except RedisError as e:
            logger.error(f"Redis {operation_name} failed: {e}")
            yield None
        except Exception as e:
            logger.error(f"Unexpected error in Redis {operation_name}: {e}")
            yield None
    
    # Conversation Management
    
    def store_conversation(
        self,
        agent_id: str,
        conversation: Dict[str, Any],
        ttl: int = 3600
    ) -> bool:
        """
        Store conversation data with TTL.
        
        Args:
            agent_id: Unique identifier for the agent
            conversation: Conversation data to store
            ttl: Time to live in seconds (default: 1 hour)
            
        Returns:
            bool: Success status
        """
        with self._lock:
            timestamp = datetime.now().isoformat()
            key = f"psyche:conversation:{agent_id}:{timestamp}"
            
            data = {
                "agent_id": agent_id,
                "timestamp": timestamp,
                "ttl": ttl,
                **conversation
            }
            
            with self._redis_operation("store_conversation") as client:
                if client:
                    try:
                        # Handle sets and other non-JSON serializable objects
                        def json_serializer(obj):
                            if isinstance(obj, set):
                                return list(obj)
                            return str(obj)
                        
                        # Store conversation with TTL
                        client.setex(key, ttl, json.dumps(data, default=json_serializer))
                        
                        # Add to agent's conversation index
                        index_key = f"psyche:conversations:{agent_id}"
                        client.zadd(index_key, {key: time.time()})
                        client.expire(index_key, ttl)
                        
                        # Publish update event
                        self.publish_real_time_update("conversation_stored", {
                            "agent_id": agent_id,
                            "key": key,
                            "timestamp": timestamp
                        })
                        
                        return True
                    except Exception as e:
                        logger.error(f"Failed to store conversation: {e}")
            
            return False
    
    def get_conversation_history(
        self,
        agent_id: str,
        limit: int = 100,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """
        Retrieve conversation history for an agent.
        
        Args:
            agent_id: Agent identifier
            limit: Maximum number of conversations to retrieve
            start_time: Start time filter (optional)
            end_time: End time filter (optional)
            
        Returns:
            List of conversation dictionaries
        """
        with self._redis_operation("get_conversations") as client:
            if not client:
                return []
            
            try:
                index_key = f"psyche:conversations:{agent_id}"
                
                # Build score range for time filtering
                min_score = start_time.timestamp() if start_time else "-inf"
                max_score = end_time.timestamp() if end_time else "+inf"
                
                # Get conversation keys within time range
                keys = client.zrevrangebyscore(
                    index_key, max_score, min_score, start=0, num=limit
                )
                
                # Retrieve conversations
                conversations = []
                for key in keys:
                    data = client.get(key)
                    if data:
                        conversations.append(json.loads(data))
                
                return conversations
            except Exception as e:
                logger.error(f"Failed to retrieve conversations: {e}")
                return []
    
    # Agent State Management
    
    def store_agent_state(
        self,
        agent_id: str,
        state: Dict[str, Any],
        ttl: Optional[int] = None
    ) -> bool:
        """
        Store agent state with optional TTL.
        
        Args:
            agent_id: Agent identifier
            state: State data to store
            ttl: Optional TTL in seconds
            
        Returns:
            bool: Success status
        """
        with self._lock:
            key = f"psyche:agent_state:{agent_id}"
            data = {
                "agent_id": agent_id,
                "timestamp": datetime.now().isoformat(),
                "state": state
            }
            
            with self._redis_operation("store_agent_state") as client:
                if client:
                    try:
                        # Handle sets and other non-JSON serializable objects
                        def json_serializer(obj):
                            if isinstance(obj, set):
                                return list(obj)
                            return str(obj)
                        
                        if ttl:
                            client.setex(key, ttl, json.dumps(data, default=json_serializer))
                        else:
                            client.set(key, json.dumps(data, default=json_serializer))
                        
                        # Publish state update
                        self.publish_real_time_update("agent_state_updated", {
                            "agent_id": agent_id,
                            "timestamp": data["timestamp"]
                        })
                        
                        return True
                    except Exception as e:
                        logger.error(f"Failed to store agent state: {e}")
            
            return False
    
    def get_agent_state(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve agent state.
        
        Args:
            agent_id: Agent identifier
            
        Returns:
            Agent state dictionary or None
        """
        key = f"psyche:agent_state:{agent_id}"
        
        with self._redis_operation("get_agent_state") as client:
            if not client:
                return None
            
            try:
                data = client.get(key)
                if data:
                    return json.loads(data)
            except Exception as e:
                logger.error(f"Failed to retrieve agent state: {e}")
        
        return None
    
    def update_agent_state(
        self,
        agent_id: str,
        updates: Dict[str, Any],
        ttl: Optional[int] = None
    ) -> bool:
        """
        Atomically update agent state fields.
        
        Args:
            agent_id: Agent identifier
            updates: Fields to update
            ttl: Optional TTL in seconds
            
        Returns:
            bool: Success status
        """
        with self._lock:
            # Get current state
            current_state = self.get_agent_state(agent_id)
            if current_state and "state" in current_state:
                current_state["state"].update(updates)
            else:
                current_state = {"state": updates}
            
            # Store updated state
            return self.store_agent_state(agent_id, current_state["state"], ttl)
    
    # Real-time Pub/Sub
    
    def publish_real_time_update(
        self,
        channel: str,
        data: Dict[str, Any]
    ) -> bool:
        """
        Publish real-time update to channel.
        
        Args:
            channel: Channel name (will be prefixed with 'psyche:')
            data: Data to publish
            
        Returns:
            bool: Success status
        """
        full_channel = f"psyche:{channel}"
        message = {
            "timestamp": datetime.now().isoformat(),
            "channel": channel,
            "data": data
        }
        
        with self._redis_operation("publish") as client:
            if client:
                try:
                    # Handle sets and other non-JSON serializable objects
                    def json_serializer(obj):
                        if isinstance(obj, set):
                            return list(obj)
                        return str(obj)
                    
                    subscribers = client.publish(
                        full_channel,
                        json.dumps(message, default=json_serializer)
                    )
                    logger.debug(f"Published to {full_channel}: {subscribers} subscribers")
                    return True
                except Exception as e:
                    logger.error(f"Failed to publish update: {e}")
        
        return False
    
    def subscribe_to_channel(
        self,
        channel: str,
        callback: Callable[[Dict[str, Any]], None]
    ) -> bool:
        """
        Subscribe to a channel with a callback function.
        
        Args:
            channel: Channel name (will be prefixed with 'psyche:')
            callback: Function to call with message data
            
        Returns:
            bool: Success status
        """
        full_channel = f"psyche:{channel}"
        
        with self._pubsub_lock:
            if full_channel not in self._subscribers:
                self._subscribers[full_channel] = []
            
            self._subscribers[full_channel].append(callback)
            
            # Start pub/sub thread if not running
            if not self._running:
                self._start_pubsub_thread()
            
            return True
    
    def unsubscribe_from_channel(
        self,
        channel: str,
        callback: Optional[Callable] = None
    ) -> bool:
        """
        Unsubscribe from a channel.
        
        Args:
            channel: Channel name
            callback: Specific callback to remove (None removes all)
            
        Returns:
            bool: Success status
        """
        full_channel = f"psyche:{channel}"
        
        with self._pubsub_lock:
            if full_channel in self._subscribers:
                if callback:
                    self._subscribers[full_channel].remove(callback)
                    if not self._subscribers[full_channel]:
                        del self._subscribers[full_channel]
                else:
                    del self._subscribers[full_channel]
                
                # Stop pub/sub thread if no subscribers
                if not self._subscribers and self._running:
                    self._stop_pubsub_thread()
                
                return True
        
        return False
    
    def _start_pubsub_thread(self):
        """Start the pub/sub listener thread."""
        if self._running:
            return
        
        with self._redis_operation("start_pubsub") as client:
            if not client:
                return
            
            try:
                self._pubsub = client.pubsub()
                
                # Subscribe to all channels
                for channel in self._subscribers:
                    self._pubsub.subscribe(channel)
                
                self._running = True
                self._pubsub_thread = threading.Thread(
                    target=self._pubsub_listener,
                    daemon=True
                )
                self._pubsub_thread.start()
                logger.info("Started pub/sub listener thread")
            except Exception as e:
                logger.error(f"Failed to start pub/sub thread: {e}")
    
    def _stop_pubsub_thread(self):
        """Stop the pub/sub listener thread."""
        self._running = False
        
        if self._pubsub:
            try:
                self._pubsub.close()
            except Exception as e:
                logger.error(f"Error closing pub/sub: {e}")
        
        if self._pubsub_thread:
            self._pubsub_thread.join(timeout=1.0)
        
        logger.info("Stopped pub/sub listener thread")
    
    def _pubsub_listener(self):
        """Background thread for listening to pub/sub messages."""
        while self._running:
            try:
                if self._pubsub:
                    message = self._pubsub.get_message(timeout=1.0)
                    if message and message['type'] == 'message':
                        channel = message['channel']
                        data = json.loads(message['data'])
                        
                        # Call all callbacks for this channel
                        with self._pubsub_lock:
                            if channel in self._subscribers:
                                for callback in self._subscribers[channel]:
                                    try:
                                        callback(data)
                                    except Exception as e:
                                        logger.error(f"Error in pub/sub callback: {e}")
            except Exception as e:
                logger.error(f"Error in pub/sub listener: {e}")
                time.sleep(1.0)  # Prevent tight loop on error
    
    # Connection Management
    
    def is_connected(self) -> bool:
        """Check if Redis is connected."""
        if not self._client:
            return False
        
        try:
            self._client.ping()
            return True
        except Exception:
            return False
    
    def reconnect(self) -> bool:
        """Attempt to reconnect to Redis."""
        self.close()
        return self._connect()
    
    def close(self):
        """Close Redis connections and cleanup."""
        # Stop pub/sub thread
        self._stop_pubsub_thread()
        
        # Close Redis client
        if self._client:
            try:
                self._client.close()
            except Exception as e:
                logger.error(f"Error closing Redis client: {e}")
            self._client = None
        
        # Close connection pool
        if self.pool:
            try:
                self.pool.disconnect()
            except Exception as e:
                logger.error(f"Error closing connection pool: {e}")
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()


# Integration with existing Redis Manager
def integrate_with_existing_manager():
    """
    Example of how to integrate with the existing data/redis_manager.py
    """
    from data.redis_manager import get_redis_manager
    
    # Get the existing manager
    existing_manager = get_redis_manager()
    
    # Create a new state manager with the same connection
    if existing_manager.is_available:
        state_manager = RedisStateManager(
            redis_url=existing_manager.redis_url,
            db=existing_manager.db
        )
        return state_manager
    
    return None


# Example usage
if __name__ == "__main__":
    # Create Redis state manager
    manager = RedisStateManager()
    
    # Example: Store a conversation
    manager.store_conversation(
        agent_id="ego",
        conversation={
            "message": "I need to understand my purpose",
            "response": "Your purpose emerges from integration",
            "sentiment": 0.7
        }
    )
    
    # Example: Update agent state
    manager.update_agent_state(
        agent_id="shadow",
        updates={
            "integration_level": 0.8,
            "activity_status": "active"
        }
    )
    
    # Example: Subscribe to updates
    def handle_update(data):
        print(f"Received update: {data}")
    
    manager.subscribe_to_channel("agent_state_updated", handle_update)
    
    # Clean up
    manager.close()