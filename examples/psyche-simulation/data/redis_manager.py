"""
Redis State Manager for Psyche Simulation
Implements the Redis integration architecture from REALTIME_VISUALIZATION_ARCHITECTURE.md
"""

import redis
import json
import time
import logging
from typing import Dict, List, Optional, Any, Union
from datetime import datetime, timedelta
from config.config import LLM_CONFIG
import threading

logger = logging.getLogger(__name__)


class RedisStateManager:
    """
    Redis-based state management for enhanced scalability and persistence
    
    Provides:
    - Conversation storage and retrieval
    - Agent state management
    - Real-time pub/sub for updates
    - Session management
    - Performance metrics storage
    """
    
    def __init__(self, redis_url: str = "redis://localhost:6379", db: int = 0):
        """Initialize Redis connection with error handling"""
        self.redis_url = redis_url
        self.db = db
        self._client = None
        self._pubsub = None
        self._lock = threading.Lock()
        
        try:
            self._client = redis.from_url(redis_url, db=db, decode_responses=True)
            # Test connection
            self._client.ping()
            logger.info(f"Redis connection established: {redis_url}")
        except redis.ConnectionError as e:
            logger.warning(f"Redis connection failed, falling back to memory: {e}")
            self._client = None
        except Exception as e:
            logger.error(f"Unexpected Redis error: {e}")
            self._client = None
    
    @property
    def is_available(self) -> bool:
        """Check if Redis is available"""
        return self._client is not None
    
    def _safe_execute(self, operation: callable, *args, **kwargs) -> Any:
        """Execute Redis operation with error handling"""
        if not self.is_available:
            return None
        
        try:
            return operation(*args, **kwargs)
        except redis.ConnectionError:
            logger.warning("Redis connection lost")
            self._client = None
            return None
        except Exception as e:
            logger.error(f"Redis operation failed: {e}")
            return None
    
    # Conversation Management
    def store_conversation(self, session_id: str, iteration: int, conversation_data: Dict[str, Any]) -> bool:
        """Store conversation data with TTL"""
        if not self.is_available:
            return False
        
        key = f"conversation:{session_id}:{iteration}"
        data = {
            'timestamp': datetime.now().isoformat(),
            'iteration': iteration,
            'session_id': session_id,
            **conversation_data
        }
        
        try:
            # Store with 24 hour TTL
            self._client.setex(key, 86400, json.dumps(data, default=str))
            
            # Add to session index
            session_key = f"session:{session_id}:conversations"
            self._client.zadd(session_key, {key: iteration})
            self._client.expire(session_key, 86400)
            
            return True
        except Exception as e:
            logger.error(f"Failed to store conversation: {e}")
            return False
    
    def get_conversation_history(self, session_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Retrieve conversation history for a session"""
        if not self.is_available:
            return []
        
        try:
            session_key = f"session:{session_id}:conversations"
            # Get most recent conversation keys
            conversation_keys = self._client.zrevrange(session_key, 0, limit-1)
            
            conversations = []
            for key in conversation_keys:
                data = self._client.get(key)
                if data:
                    conversations.append(json.loads(data))
            
            return conversations
        except Exception as e:
            logger.error(f"Failed to retrieve conversation history: {e}")
            return []
    
    # Agent State Management
    def store_agent_state(self, session_id: str, agent_id: str, state: Dict[str, Any]) -> bool:
        """Store agent state information"""
        if not self.is_available:
            return False
        
        key = f"agent_state:{session_id}:{agent_id}"
        data = {
            'timestamp': datetime.now().isoformat(),
            'agent_id': agent_id,
            'session_id': session_id,
            **state
        }
        
        return self._safe_execute(
            lambda: self._client.setex(key, 3600, json.dumps(data, default=str))
        ) is not None
    
    def get_agent_state(self, session_id: str, agent_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve agent state"""
        if not self.is_available:
            return None
        
        key = f"agent_state:{session_id}:{agent_id}"
        data = self._safe_execute(self._client.get, key)
        
        if data:
            try:
                return json.loads(data)
            except json.JSONDecodeError:
                logger.error(f"Failed to decode agent state for {agent_id}")
                return None
        return None
    
    def get_all_agent_states(self, session_id: str) -> Dict[str, Dict[str, Any]]:
        """Get all agent states for a session"""
        if not self.is_available:
            return {}
        
        try:
            pattern = f"agent_state:{session_id}:*"
            keys = self._client.keys(pattern)
            
            states = {}
            for key in keys:
                agent_id = key.split(':')[-1]
                data = self._client.get(key)
                if data:
                    states[agent_id] = json.loads(data)
            
            return states
        except Exception as e:
            logger.error(f"Failed to retrieve agent states: {e}")
            return {}
    
    # Real-time Pub/Sub
    def publish_real_time_update(self, channel: str, data: Dict[str, Any]) -> bool:
        """Publish real-time update to subscribers"""
        if not self.is_available:
            return False
        
        message = {
            'timestamp': datetime.now().isoformat(),
            'type': data.get('type', 'update'),
            'data': data
        }
        
        return self._safe_execute(
            self._client.publish, 
            f"psyche:{channel}", 
            json.dumps(message, default=str)
        ) is not None
    
    def subscribe_to_updates(self, channels: List[str]) -> Optional['redis.client.PubSub']:
        """Subscribe to real-time updates"""
        if not self.is_available:
            return None
        
        try:
            pubsub = self._client.pubsub()
            for channel in channels:
                pubsub.subscribe(f"psyche:{channel}")
            return pubsub
        except Exception as e:
            logger.error(f"Failed to subscribe to channels: {e}")
            return None
    
    # Session Management
    def create_session(self, session_id: str, user_data: Optional[Dict[str, Any]] = None) -> bool:
        """Create a new session"""
        if not self.is_available:
            return False
        
        key = f"session:{session_id}:metadata"
        data = {
            'session_id': session_id,
            'created_at': datetime.now().isoformat(),
            'last_activity': datetime.now().isoformat(),
            'user_data': user_data or {}
        }
        
        return self._safe_execute(
            lambda: self._client.setex(key, 86400, json.dumps(data, default=str))
        ) is not None
    
    def update_session_activity(self, session_id: str) -> bool:
        """Update session last activity timestamp"""
        if not self.is_available:
            return False
        
        key = f"session:{session_id}:metadata"
        data = self._safe_execute(self._client.get, key)
        
        if data:
            try:
                session_data = json.loads(data)
                session_data['last_activity'] = datetime.now().isoformat()
                return self._safe_execute(
                    lambda: self._client.setex(key, 86400, json.dumps(session_data, default=str))
                ) is not None
            except json.JSONDecodeError:
                logger.error(f"Failed to decode session data for {session_id}")
        
        return False
    
    def get_active_sessions(self, max_age_hours: int = 24) -> List[Dict[str, Any]]:
        """Get list of active sessions"""
        if not self.is_available:
            return []
        
        try:
            pattern = "session:*:metadata"
            keys = self._client.keys(pattern)
            
            active_sessions = []
            cutoff_time = datetime.now() - timedelta(hours=max_age_hours)
            
            for key in keys:
                data = self._client.get(key)
                if data:
                    session_data = json.loads(data)
                    last_activity = datetime.fromisoformat(session_data['last_activity'])
                    
                    if last_activity > cutoff_time:
                        active_sessions.append(session_data)
            
            return active_sessions
        except Exception as e:
            logger.error(f"Failed to retrieve active sessions: {e}")
            return []
    
    # Performance Metrics
    def store_performance_metrics(self, session_id: str, metrics: Dict[str, Any]) -> bool:
        """Store performance metrics"""
        if not self.is_available:
            return False
        
        timestamp = int(time.time())
        key = f"metrics:{session_id}:{timestamp}"
        
        data = {
            'timestamp': timestamp,
            'session_id': session_id,
            **metrics
        }
        
        # Store metrics with 7 day TTL
        success = self._safe_execute(
            lambda: self._client.setex(key, 604800, json.dumps(data, default=str))
        ) is not None
        
        if success:
            # Add to metrics index for time-series queries
            index_key = f"metrics_index:{session_id}"
            self._safe_execute(self._client.zadd, index_key, {key: timestamp})
            self._safe_execute(self._client.expire, index_key, 604800)
        
        return success
    
    def get_performance_metrics(self, session_id: str, 
                              start_time: Optional[datetime] = None,
                              end_time: Optional[datetime] = None,
                              limit: int = 1000) -> List[Dict[str, Any]]:
        """Retrieve performance metrics for time range"""
        if not self.is_available:
            return []
        
        try:
            index_key = f"metrics_index:{session_id}"
            
            # Convert datetime to timestamp
            min_score = int(start_time.timestamp()) if start_time else 0
            max_score = int(end_time.timestamp()) if end_time else int(time.time())
            
            # Get metric keys in time range
            metric_keys = self._client.zrangebyscore(
                index_key, min_score, max_score, start=0, num=limit
            )
            
            metrics = []
            for key in metric_keys:
                data = self._client.get(key)
                if data:
                    metrics.append(json.loads(data))
            
            return metrics
        except Exception as e:
            logger.error(f"Failed to retrieve performance metrics: {e}")
            return []
    
    # Network Communication Storage
    def store_network_message(self, session_id: str, message_data: Dict[str, Any]) -> bool:
        """Store network communication message"""
        if not self.is_available:
            return False
        
        timestamp = int(time.time() * 1000)  # milliseconds for better precision
        key = f"network:{session_id}:{timestamp}"
        
        data = {
            'timestamp': timestamp,
            'session_id': session_id,
            **message_data
        }
        
        # Store with 1 hour TTL for network messages
        return self._safe_execute(
            lambda: self._client.setex(key, 3600, json.dumps(data, default=str))
        ) is not None
    
    def get_network_activity(self, session_id: str, 
                            start_time: Optional[datetime] = None,
                            limit: int = 1000) -> List[Dict[str, Any]]:
        """Get network communication activity"""
        if not self.is_available:
            return []
        
        try:
            pattern = f"network:{session_id}:*"
            keys = self._client.keys(pattern)
            
            # Sort keys by timestamp (embedded in key)
            keys.sort(key=lambda k: int(k.split(':')[-1]))
            
            # Apply time filter if specified
            if start_time:
                start_ts = int(start_time.timestamp() * 1000)
                keys = [k for k in keys if int(k.split(':')[-1]) >= start_ts]
            
            # Apply limit
            keys = keys[-limit:]
            
            activities = []
            for key in keys:
                data = self._client.get(key)
                if data:
                    activities.append(json.loads(data))
            
            return activities
        except Exception as e:
            logger.error(f"Failed to retrieve network activity: {e}")
            return []
    
    # Cleanup and Maintenance
    def cleanup_expired_data(self) -> Dict[str, int]:
        """Clean up expired data and return counts"""
        if not self.is_available:
            return {'error': 'Redis not available'}
        
        cleanup_stats = {
            'expired_conversations': 0,
            'expired_sessions': 0,
            'expired_metrics': 0,
            'expired_network': 0
        }
        
        try:
            # Redis handles TTL expiration automatically, but we can check for orphaned data
            # This is mainly for monitoring purposes
            
            patterns = {
                'conversation:*': 'expired_conversations',
                'session:*:metadata': 'expired_sessions',
                'metrics:*': 'expired_metrics',
                'network:*': 'expired_network'
            }
            
            for pattern, stat_key in patterns.items():
                keys = self._client.keys(pattern)
                cleanup_stats[stat_key] = len(keys)
            
            return cleanup_stats
        except Exception as e:
            logger.error(f"Failed to perform cleanup: {e}")
            return {'error': str(e)}
    
    def get_redis_info(self) -> Dict[str, Any]:
        """Get Redis server information"""
        if not self.is_available:
            return {'status': 'unavailable'}
        
        try:
            info = self._client.info()
            return {
                'status': 'connected',
                'redis_version': info.get('redis_version'),
                'used_memory': info.get('used_memory_human'),
                'connected_clients': info.get('connected_clients'),
                'total_commands_processed': info.get('total_commands_processed'),
                'uptime': info.get('uptime_in_seconds')
            }
        except Exception as e:
            logger.error(f"Failed to get Redis info: {e}")
            return {'status': 'error', 'error': str(e)}


# Global Redis manager instance
_redis_manager = None
_manager_lock = threading.Lock()


def get_redis_manager() -> RedisStateManager:
    """Get global Redis manager instance (singleton pattern)"""
    global _redis_manager
    
    if _redis_manager is None:
        with _manager_lock:
            if _redis_manager is None:
                # Try to get Redis URL from environment or use default
                import os
                redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
                _redis_manager = RedisStateManager(redis_url)
    
    return _redis_manager


def reset_redis_manager():
    """Reset the global Redis manager (useful for testing)"""
    global _redis_manager
    with _manager_lock:
        _redis_manager = None