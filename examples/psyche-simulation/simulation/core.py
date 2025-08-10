import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Dict, List, Optional, Any
from collections import deque

from agents import ShadowAgent, PersonaAgent, AnimaAnimusAgent, SelfAgent, EgoAgent
from .network import AgentNetwork
from .prompt_manager import DynamicPromptManager
from utils import get_emotional_tone
from data.redis_state_manager import RedisStateManager

logger = logging.getLogger(__name__)

class PsycheSimulation:
    """Main application class for the Psyche Simulation with multi-user session support"""

    def __init__(self, session_id: Optional[str] = None, redis_manager: Optional[RedisStateManager] = None):
        self.session_id = session_id or "default_session"
        self.redis_manager = redis_manager or RedisStateManager()
        
        self.agents = self._initialize_agents()
        self.network = AgentNetwork()
        self.prompt_manager = DynamicPromptManager()
        self.conversation_history = deque(maxlen=100)
        
        # Initialize session data with Redis persistence
        self.session_data = self._load_or_create_session_data()
        
        self.is_running = False
        self.current_situation = self.session_data.get('current_situation', "Initial exploration of the psyche")
        self.current_conversation_state = {}
        
        # Save initial state
        self._persist_session_state()
    
    def _load_or_create_session_data(self) -> Dict[str, Any]:
        """Load existing session data or create new session data."""
        try:
            # Try to load existing session state
            session_key = f"psyche:simulation_session:{self.session_id}"
            existing_data = self.redis_manager.get_agent_state(session_key)
            
            if existing_data and "state" in existing_data:
                logger.info(f"Loaded existing session data for {self.session_id}")
                session_data = existing_data["state"]
                
                # Convert ISO strings back to datetime for start_time
                if "start_time" in session_data and isinstance(session_data["start_time"], str):
                    session_data["start_time"] = datetime.fromisoformat(session_data["start_time"])
                
                return session_data
            else:
                logger.info(f"Creating new session data for {self.session_id}")
                return {
                    'session_id': self.session_id,
                    'start_time': datetime.now(),
                    'iterations': 0,
                    'agent_states': {},
                    'sentiment_history': [],
                    'network_activity': [],
                    'current_situation': "Initial exploration of the psyche"
                }
        except Exception as e:
            logger.error(f"Error loading session data: {e}")
            return {
                'session_id': self.session_id,
                'start_time': datetime.now(),
                'iterations': 0,
                'agent_states': {},
                'sentiment_history': [],
                'network_activity': [],
                'current_situation': "Initial exploration of the psyche"
            }
    
    def _persist_session_state(self):
        """Persist current session state to Redis."""
        try:
            session_key = f"psyche:simulation_session:{self.session_id}"
            
            # Prepare data for persistence (convert datetime to ISO string)
            session_data_to_store = self.session_data.copy()
            if "start_time" in session_data_to_store:
                session_data_to_store["start_time"] = session_data_to_store["start_time"].isoformat()
            
            session_data_to_store.update({
                'current_situation': self.current_situation,
                'is_running': self.is_running,
                'last_updated': datetime.now().isoformat()
            })
            
            self.redis_manager.store_agent_state(session_key, session_data_to_store, ttl=86400)  # 24 hour TTL
            
            # Also publish session update event
            self.redis_manager.publish_real_time_update("session_updated", {
                "session_id": self.session_id,
                "iterations": self.session_data.get('iterations', 0),
                "is_running": self.is_running
            })
            
        except Exception as e:
            logger.error(f"Error persisting session state: {e}")
    
    def _persist_agent_states(self):
        """Persist agent states to Redis."""
        try:
            for agent_name, agent_state in self.session_data.get('agent_states', {}).items():
                agent_key = f"psyche:agent_state:{self.session_id}:{agent_name}"
                self.redis_manager.store_agent_state(agent_key, agent_state, ttl=3600)  # 1 hour TTL
        except Exception as e:
            logger.error(f"Error persisting agent states: {e}")

    def _initialize_agents(self) -> Dict[str, Any]:
        """Initialize all Jungian agents"""
        return {
            'Shadow': ShadowAgent(),
            'Persona': PersonaAgent(),
            'Anima/Animus': AnimaAnimusAgent(),
            'Self': SelfAgent(),
            'Ego': EgoAgent()
        }

    async def run_iteration(self, situation: str) -> Dict[str, str]:
        """Run a single iteration of the simulation with improved pacing"""
        outputs = {}
        
        logger.info(f"Starting iteration for session {self.session_id} with sequential agent processing")
        
        for i, (agent_name, agent) in enumerate(self.agents.items()):
            try:
                if i > 0:
                    await asyncio.sleep(3.0)
                
                logger.info(f"Processing agent: {agent_name}")
                
                messages = self.network.get_all_messages_for_agent(agent_name, incoming=True)
                other_agents_output = {msg['from']: msg['content'] for msg in messages}
                
                response = await self._get_agent_response(agent_name, agent, situation, other_agents_output)
                outputs[agent_name] = response
                
                sentiment = get_emotional_tone(response)
                
                # Store agent state
                agent_state = {
                    'response': response,
                    'sentiment': sentiment,
                    'timestamp': datetime.now().isoformat()
                }
                self.session_data['agent_states'][agent_name] = agent_state
                
                for recipient in self.agents:
                    if recipient != agent_name:
                        self.network.send_message(agent_name, recipient, response, sentiment)
                        await asyncio.sleep(0.5)
                        
            except Exception as e:
                logger.error(f"Error in {agent_name}: {e}")
                outputs[agent_name] = f"[{agent_name} is experiencing difficulties]"
        
        # Update session iteration count and persist state
        self.session_data['iterations'] = self.session_data.get('iterations', 0) + 1
        self._persist_session_state()
        self._persist_agent_states()
        
        # Store conversation in Redis
        self.redis_manager.store_conversation(
            agent_id=f"session_{self.session_id}",
            conversation={
                'iteration': self.session_data['iterations'],
                'situation': situation,
                'outputs': outputs,
                'timestamp': datetime.now().isoformat()
            },
            ttl=86400  # 24 hours
        )
        
        logger.info(f"Completed iteration {self.session_data['iterations']} for session {self.session_id}")
        return outputs

    async def _get_agent_response(self, agent_name: str, agent: Any, 
                                  situation: str, other_agents_output: Dict[str, str]) -> str:
        """Get response from an agent asynchronously"""
        outputs_history = [entry.get('outputs', {}) for entry in self.conversation_history if 'outputs' in entry]
        conversation_state = self.prompt_manager.analyze_conversation_state(
            outputs_history[-1] if outputs_history else {}
        )
        
        if hasattr(agent, 'prompt_template'):
            agent.prompt_template = self.prompt_manager.adapt_prompt(
                agent.prompt_template, agent_name, conversation_state
            )
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, agent.respond, situation, other_agents_output
        )
        
        return response

    def _evolve_situation(self, outputs: Dict[str, str], state: Dict[str, float]) -> str:
        """Evolve the situation based on agent outputs and conversation state"""
        if state['conflict'] > 0.7:
            return "Exploring the tension between different aspects of the self"
        elif state['stagnation'] > 0.6:
            return "Seeking new perspectives and breaking patterns"
        elif state['emotional_intensity'] > 0.8:
            return "Processing intense emotions and their origins"
        else:
            all_text = " ".join(outputs.values())
            if "shadow" in all_text.lower():
                return "Confronting hidden aspects and repressed desires"
            elif "persona" in all_text.lower():
                return "Examining the masks we wear in social situations"
            elif "integration" in all_text.lower():
                return "Working towards psychological integration and wholeness"
            else:
                return "Continuing the journey of self-discovery"

    def stop_simulation(self):
        """Stop the running simulation"""
        self.is_running = False

    def export_session(self, format: str = 'json'):
        """Export the session data"""
        start_time = self.session_data['start_time']
        if isinstance(start_time, str):
            start_time = datetime.fromisoformat(start_time)
        
        export_data = {
            'session_info': {
                'session_id': self.session_id,
                'start_time': start_time.isoformat(),
                'total_iterations': self.session_data['iterations'],
                'duration': (datetime.now() - start_time).total_seconds()
            },
            'conversation_history': list(self.conversation_history),
            'agent_states': self.session_data.get('agent_states', {}),
            'network_statistics': self.network.get_stats(),
            'final_state': self.prompt_manager.analyze_conversation_state({})
        }
        
        if format == 'json':
            def convert_datetime(obj):
                if isinstance(obj, datetime):
                    return obj.isoformat()
                return obj
            
            json_data = json.dumps(export_data, default=convert_datetime, indent=2)
            return json_data
        
        return json.dumps(export_data, default=str, indent=2)

    def reset_conversation_dynamics(self):
        """Reset conversation dynamics and agent states"""
        self.conversation_history.clear()
        
        for agent in self.agents.values():
            if hasattr(agent, 'clear_memory'):
                agent.clear_memory()
        
        self.network.clear_messages()
        
        self.prompt_manager.conversation_history.clear()
        self.prompt_manager.adaptation_history.clear()
        
        self.current_conversation_state = {}
        self.session_data['iterations'] = 0
        self.session_data['agent_states'] = {}
        
        # Persist the reset state
        self._persist_session_state()
        self._persist_agent_states()

    def inject_stimulus(self, stimulus_type: str = 'random'):
        """Inject stimulus to break stagnation"""
        import random
        
        stimuli = {
            'memory': "A forgotten childhood memory suddenly surfaces...",
            'conflict': "An internal conflict demands attention...",
            'revelation': "A new understanding emerges from the depths...",
            'challenge': "A fundamental belief is being questioned...",
            'integration': "Different aspects of the self seek harmony...",
            'shadow': "Something hidden in the shadow seeks recognition...",
            'creative': "A burst of creative energy flows through consciousness..."
        }
        
        if stimulus_type == 'random':
            stimulus_type = random.choice(list(stimuli.keys()))
        
        stimulus_text = stimuli.get(stimulus_type, "Something stirs in the depths of consciousness...")
        
        self.current_situation = f"{stimulus_text} {self.current_situation}"
        
        # Persist the updated situation
        self._persist_session_state()