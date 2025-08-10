"""
Base agent class for Jungian archetypes
"""

import time
import logging
from typing import Dict, List, Optional, Any
from langchain.prompts import PromptTemplate
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.chat_history import BaseChatMessageHistory, InMemoryChatMessageHistory
from langchain_core.messages import BaseMessage
from langchain_core.output_parsers import StrOutputParser

from llm.wrapper import CustomLLM
from analysis.sentiment import get_emotional_tone
from config import AGENT_CONFIGS, LLM_CONFIG
from utils.websocket_events import broadcast_agent_message

class BaseAgent:
    """Base class for all Jungian archetype agents"""
    
    def __init__(self, name: str, llm_config: Optional[Dict] = None):
        self.name = name
        self.config = AGENT_CONFIGS.get(name, {})
        self.color = self.config.get('color', '#000000')
        
        # Setup logging
        self.logger = logging.getLogger(f"Agent.{name}")
        
        # Initialize LLM
        llm_settings = llm_config or LLM_CONFIG['default']
        self.llm = CustomLLM(
            api_url=llm_settings['api_url'],
            api_key=llm_settings.get('api_key'),
            model=llm_settings['model'],
            max_tokens=llm_settings['max_tokens'],
            temperature=self.config.get('temperature', llm_settings['temperature']),
            timeout=llm_settings['timeout'],
            use_openai_client=llm_settings.get('use_openai_client', False)
        )
        
        # Initialize prompt template
        self.prompt_template = self._create_prompt_template()
        
        # Create the core LCEL chain
        lc_chain = self.prompt_template | self.llm | StrOutputParser()
        
        # Initialize in-memory chat history storage
        self.store = {}
        
        def get_session_history(session_id: str) -> BaseChatMessageHistory:
            if session_id not in self.store:
                self.store[session_id] = InMemoryChatMessageHistory()
            return self.store[session_id]
        
        # Initialize chain with message history
        self.chain = RunnableWithMessageHistory(
            lc_chain,
            get_session_history,
            input_messages_key="situation",
            history_messages_key="chat_history"
        )
        
        # Track internal state
        self.last_output = ""
        self.sentiment_history = []
        self.interaction_count = 0
        
    def _create_prompt_template(self) -> PromptTemplate:
        """Create the prompt template for this agent"""
        
        system_prompt = self.config.get('system_prompt', '')
        
        template = f"""
{system_prompt}

Current Situation: {{situation}}

Chat History:
{{chat_history}}

Other Agents' Perspectives:
{{other_agents}}

As {self.name}, respond to the current situation considering:
1. Your archetypal nature and role in the psyche
2. The perspectives shared by other agents
3. The ongoing conversation history
4. The current emotional and psychological dynamics

Your response should be authentic to your archetype while contributing to the overall psychological integration process.

Response:"""
        
        return PromptTemplate(
            input_variables=["situation", "chat_history", "other_agents"],
            template=template
        )
    
    def respond(self, situation: str, other_agents_output: Dict[str, str]) -> str:
        """Generate a response to the current situation with real-time streaming"""
        
        try:
            # Import streaming broadcast functions
            from utils.websocket_events import (
                broadcast_agent_processing_started,
                broadcast_agent_processing_update,
                broadcast_agent_processing_complete
            )
            
            # Broadcast that processing has started
            broadcast_agent_processing_started(
                agent_id=self.name,
                agent_type=self.__class__.__name__,
                situation=situation,
                metadata={
                    'interaction_count': self.interaction_count,
                    'has_memory': len(self.store) > 0
                }
            )
            
            # Format other agents' output
            other_agents_text = self._format_other_agents(other_agents_output)
            
            # Track streamed content
            streamed_content = []
            total_length = 0
            
            def stream_callback(chunk: str):
                """Callback to handle streaming chunks"""
                nonlocal total_length
                streamed_content.append(chunk)
                total_length += len(chunk)
                
                # Calculate approximate progress (0.0 to 1.0)
                # Assume average response is ~500 chars
                progress = min(1.0, total_length / 500)
                
                # Broadcast partial update
                broadcast_agent_processing_update(
                    agent_id=self.name,
                    partial_content=chunk,
                    progress=progress,
                    metadata={'chunk_size': len(chunk)}
                )
            
            # Create a prompt for streaming
            prompt = self.prompt_template.format(
                situation=situation,
                chat_history="",  # Will be handled by chain's memory
                other_agents=other_agents_text
            )
            
            # Check if LLM supports streaming
            if hasattr(self.llm, 'generate_with_streaming'):
                # Use streaming with callback
                response = self.llm.generate_with_streaming(prompt, stream_callback)
            else:
                # Fallback to regular generation
                response = self.chain.invoke(
                    {"situation": situation, "other_agents": other_agents_text},
                    config={"configurable": {"session_id": "conversation"}}
                )
            
            # Extract the text from the response if it's a dict
            if isinstance(response, dict):
                response = response.get('text', str(response))
            
            # Update internal state
            self.last_output = response.strip()
            self.interaction_count += 1
            
            # Analyze sentiment
            sentiment = get_emotional_tone(self.last_output)
            self.sentiment_history.append(sentiment)
            
            self.logger.info(f"{self.name} responded with sentiment: {sentiment['category']}")
            
            # Broadcast final complete message
            broadcast_agent_processing_complete(
                agent_id=self.name,
                final_content=self.last_output,
                sentiment_data={
                    'score': sentiment.get('polarity', 0.0),
                    'label': sentiment.get('category', 'neutral')
                },
                metadata={
                    'situation': situation,
                    'interaction_count': self.interaction_count,
                    'has_memory': len(self.store) > 0,
                    'agent_type': self.__class__.__name__
                }
            )
            
            # Also broadcast regular agent message for backward compatibility
            broadcast_agent_message(
                agent_id=self.name,
                agent_type=self.__class__.__name__,
                message=self.last_output,
                sentiment_data={
                    'score': sentiment.get('polarity', 0.0),
                    'label': sentiment.get('category', 'neutral')
                },
                metadata={
                    'situation': situation,
                    'interaction_count': self.interaction_count,
                    'has_memory': len(self.store) > 0
                }
            )
            
            return self.last_output
            
        except Exception as e:
            self.logger.error(f"Error generating response: {e}")
            return f"[{self.name} is experiencing technical difficulties]"
    
    def _format_other_agents(self, other_agents_output: Dict[str, str]) -> str:
        """Format other agents' output for inclusion in prompt"""
        
        if not other_agents_output:
            return "No other agents have spoken yet."
        
        formatted = []
        for agent_name, output in other_agents_output.items():
            if agent_name != self.name and output:
                formatted.append(f"{agent_name}: {output}")
        
        return "\n".join(formatted) if formatted else "Other agents are still processing..."
    
    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the agent"""
        
        recent_sentiment = self.sentiment_history[-1] if self.sentiment_history else None
        
        return {
            'name': self.name,
            'last_output': self.last_output,
            'interaction_count': self.interaction_count,
            'current_sentiment': recent_sentiment,
            'sentiment_history': self.sentiment_history[-10:],  # Last 10 sentiments
            'memory_buffer': str(self.store.get("conversation", "No conversation history"))
        }
    
    def clear_memory(self):
        """Clear the agent's conversation memory"""
        self.store.clear()
        self.sentiment_history = []
        self.interaction_count = 0
        self.last_output = ""
        self.logger.info(f"{self.name} memory cleared")
    
    def update_prompt(self, new_template: PromptTemplate):
        """Update the agent's prompt template (for dynamic prompt evolution)"""
        self.prompt_template = new_template
        
        # Recreate the chain with the new prompt template
        lc_chain = self.prompt_template | self.llm | StrOutputParser()
        
        def get_session_history(session_id: str) -> BaseChatMessageHistory:
            if session_id not in self.store:
                self.store[session_id] = InMemoryChatMessageHistory()
            return self.store[session_id]
        
        self.chain = RunnableWithMessageHistory(
            lc_chain,
            get_session_history,
            input_messages_key="situation",
            history_messages_key="chat_history"
        )
        
        self.logger.info(f"{self.name} prompt updated")