"""
Redis Integration Layer for Psyche Simulation
Connects RedisStateManager with AgentNetwork for automatic persistence
"""

import logging
from typing import Dict, Any, Optional
from datetime import datetime
import threading

from data.redis_state_manager import RedisStateManager
from simulation.network import AgentNetwork

logger = logging.getLogger(__name__)


class PsycheRedisIntegration:
    """
    Integration layer that connects AgentNetwork with RedisStateManager
    for automatic persistence of agent communications and state.
    """
    
    def __init__(
        self,
        agent_network: AgentNetwork,
        redis_manager: Optional[RedisStateManager] = None,
        auto_persist: bool = True,
        conversation_ttl: int = 3600,
        state_ttl: Optional[int] = None
    ):
        """
        Initialize Redis integration for AgentNetwork.
        
        Args:
            agent_network: The AgentNetwork instance to integrate
            redis_manager: Optional RedisStateManager instance (creates new if None)
            auto_persist: Whether to automatically persist messages and state
            conversation_ttl: TTL for conversation data in seconds
            state_ttl: TTL for agent state data in seconds (None = no expiration)
        """
        self.network = agent_network
        self.redis_manager = redis_manager or RedisStateManager()
        self.auto_persist = auto_persist
        self.conversation_ttl = conversation_ttl
        self.state_ttl = state_ttl
        self._lock = threading.RLock()
        
        # Subscribe to Redis updates if connected
        if self.redis_manager.is_connected():
            self._setup_subscriptions()
        
        # Hook into network message sending if auto-persist enabled
        if auto_persist:
            self._hook_network_events()
    
    def _setup_subscriptions(self):
        """Setup Redis pub/sub subscriptions for real-time updates."""
        try:
            # Subscribe to conversation updates
            self.redis_manager.subscribe_to_channel(
                "conversation_stored",
                self._handle_conversation_update
            )
            
            # Subscribe to agent state updates
            self.redis_manager.subscribe_to_channel(
                "agent_state_updated", 
                self._handle_state_update
            )
            
            logger.info("Redis subscriptions established")
        except Exception as e:
            logger.error(f"Failed to setup Redis subscriptions: {e}")
    
    def _hook_network_events(self):
        """Hook into AgentNetwork to automatically persist messages."""
        # Store original send_message method
        original_send_message = self.network.send_message
        
        def enhanced_send_message(from_agent: str, to_agent: str, message: str, 
                                context: Optional[Dict[str, Any]] = None) -> bool:
            # Call original method
            success = original_send_message(from_agent, to_agent, message, context)
            
            if success and self.auto_persist:
                # Persist the conversation asynchronously
                threading.Thread(
                    target=self._persist_message,
                    args=(from_agent, to_agent, message, context),
                    daemon=True
                ).start()
            
            return success
        
        # Replace the method
        self.network.send_message = enhanced_send_message
        logger.info("AgentNetwork integration hooks installed")
    
    def _persist_message(
        self, 
        from_agent: str, 
        to_agent: str, 
        message: str, 
        context: Optional[Dict[str, Any]] = None
    ):
        """Persist a message to Redis."""
        try:
            # Get recent messages for context
            recent_messages = self.network.get_messages(from_agent, to_agent, last_n=5)
            
            conversation_data = {
                "from_agent": from_agent,
                "to_agent": to_agent,
                "message": message,
                "context": context or {},
                "recent_messages": recent_messages,
                "network_stats": self.network.get_stats(),
                "emergency_mode": self.network.is_emergency_mode()
            }
            
            # Store conversation for both sender and receiver
            self.redis_manager.store_conversation(
                agent_id=from_agent,
                conversation=conversation_data,
                ttl=self.conversation_ttl
            )
            
            self.redis_manager.store_conversation(
                agent_id=to_agent,
                conversation=conversation_data,
                ttl=self.conversation_ttl
            )
            
        except Exception as e:
            logger.error(f"Failed to persist message: {e}")
    
    def _handle_conversation_update(self, data: Dict[str, Any]):
        """Handle conversation update from Redis pub/sub."""
        logger.debug(f"Conversation update received: {data}")
        # Could trigger UI updates or other reactions here
    
    def _handle_state_update(self, data: Dict[str, Any]):
        """Handle agent state update from Redis pub/sub."""
        logger.debug(f"Agent state update received: {data}")
        # Could trigger network reconfigurations or UI updates here
    
    def persist_agent_state(self, agent_id: str, state: Dict[str, Any]) -> bool:
        """
        Manually persist agent state to Redis.
        
        Args:
            agent_id: Agent identifier
            state: State data to persist
            
        Returns:
            bool: Success status
        """
        try:
            return self.redis_manager.store_agent_state(
                agent_id=agent_id,
                state=state,
                ttl=self.state_ttl
            )
        except Exception as e:
            logger.error(f"Failed to persist agent state: {e}")
            return False
    
    def get_agent_conversation_history(
        self, 
        agent_id: str, 
        limit: int = 100
    ) -> list:
        """
        Retrieve conversation history for an agent from Redis.
        
        Args:
            agent_id: Agent identifier
            limit: Maximum number of conversations to retrieve
            
        Returns:
            List of conversation data
        """
        try:
            return self.redis_manager.get_conversation_history(
                agent_id=agent_id,
                limit=limit
            )
        except Exception as e:
            logger.error(f"Failed to retrieve conversation history: {e}")
            return []
    
    def get_agent_state(self, agent_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve agent state from Redis.
        
        Args:
            agent_id: Agent identifier
            
        Returns:
            Agent state dictionary or None
        """
        try:
            return self.redis_manager.get_agent_state(agent_id)
        except Exception as e:
            logger.error(f"Failed to retrieve agent state: {e}")
            return None
    
    def sync_network_state(self):
        """
        Synchronize current network state to Redis.
        This method can be called periodically to ensure state consistency.
        """
        try:
            with self._lock:
                # Get current network statistics
                stats = self.network.get_stats()
                connections = self.network.get_connections()
                emergency_status = self.network.get_emergency_status()
                
                # Persist network state
                network_state = {
                    "stats": stats,
                    "connections": connections,
                    "emergency_status": emergency_status,
                    "timestamp": datetime.now().isoformat()
                }
                
                self.redis_manager.store_agent_state(
                    agent_id="network",
                    state=network_state,
                    ttl=self.state_ttl
                )
                
                # Broadcast network state update
                self.redis_manager.publish_real_time_update(
                    "network_state_synced",
                    network_state
                )
                
                logger.debug("Network state synchronized to Redis")
                
        except Exception as e:
            logger.error(f"Failed to sync network state: {e}")
    
    def restore_network_state(self) -> bool:
        """
        Attempt to restore network state from Redis on startup.
        
        Returns:
            bool: Success status
        """
        try:
            network_state = self.redis_manager.get_agent_state("network")
            if network_state and "state" in network_state:
                state_data = network_state["state"]
                
                # Could restore message queues, stats, etc. here
                # For now, just log the restored state
                logger.info(f"Network state restored from Redis: {len(state_data)} entries")
                return True
            
            return False
        except Exception as e:
            logger.error(f"Failed to restore network state: {e}")
            return False
    
    def cleanup(self):
        """Clean up Redis connections and subscriptions."""
        try:
            if self.redis_manager:
                self.redis_manager.close()
            logger.info("Redis integration cleanup completed")
        except Exception as e:
            logger.error(f"Error during Redis integration cleanup: {e}")
    
    def __enter__(self):
        """Context manager entry."""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.cleanup()


# Helper function to create integrated AgentNetwork with Redis persistence
def create_redis_integrated_network(
    max_queue_size: int = 100,
    redis_url: str = "redis://localhost:6379",
    auto_persist: bool = True,
    conversation_ttl: int = 3600
) -> tuple[AgentNetwork, PsycheRedisIntegration]:
    """
    Create an AgentNetwork with Redis integration.
    
    Args:
        max_queue_size: Maximum queue size for agent network
        redis_url: Redis connection URL
        auto_persist: Whether to automatically persist messages
        conversation_ttl: TTL for conversation data
        
    Returns:
        Tuple of (AgentNetwork, PsycheRedisIntegration)
    """
    # Create components
    network = AgentNetwork(max_queue_size=max_queue_size)
    redis_manager = RedisStateManager(redis_url=redis_url)
    
    # Create integration
    integration = PsycheRedisIntegration(
        agent_network=network,
        redis_manager=redis_manager,
        auto_persist=auto_persist,
        conversation_ttl=conversation_ttl
    )
    
    return network, integration


# Example usage
if __name__ == "__main__":
    # Create integrated network
    network, integration = create_redis_integrated_network()
    
    # Example: Send a message (automatically persisted to Redis)
    network.send_message(
        from_agent="ego",
        to_agent="shadow",
        message="I need to understand my darker aspects",
        context={"session_id": "demo", "iteration": 1}
    )
    
    # Example: Manually persist agent state
    integration.persist_agent_state(
        agent_id="ego",
        state={
            "integration_level": 0.7,
            "activity_status": "active",
            "last_message_time": datetime.now().isoformat()
        }
    )
    
    # Example: Sync network state
    integration.sync_network_state()
    
    # Example: Retrieve conversation history
    history = integration.get_agent_conversation_history("ego", limit=10)
    print(f"Retrieved {len(history)} conversations for ego")
    
    # Clean up
    integration.cleanup()