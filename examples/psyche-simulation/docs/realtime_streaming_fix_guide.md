# Real-Time Streaming Fix Implementation Guide

## Overview
This guide provides the necessary changes to implement real-time streaming updates in the Psyche Simulation UI.

## Files to Modify

### 1. utils/websocket_events.py

# Add to EventType enum in utils/websocket_events.py (after line 29):
    AGENT_PROCESSING_STARTED = "agent_processing_started"
    AGENT_PROCESSING_UPDATE = "agent_processing_update"
    AGENT_PROCESSING_COMPLETE = "agent_processing_complete"

# Add new broadcast functions after line 763:
def broadcast_agent_processing_started(
    agent_id: str,
    agent_type: str,
    situation: str,
    metadata: Optional[Dict[str, Any]] = None
) -> None:
    """Broadcast that an agent has started processing"""
    manager = get_event_manager()
    
    event_data = {
        "type": "agent_processing_started",
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
    """Broadcast partial update during agent processing"""
    manager = get_event_manager()
    
    event_data = {
        "type": "agent_processing_update",
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
    """Broadcast that agent processing is complete"""
    manager = get_event_manager()
    
    event_data = {
        "type": "agent_processing_complete",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent_id": agent_id,
        "final_content": final_content,
        "sentiment": sentiment_data or {"score": 0.0, "label": "neutral"},
        "metadata": metadata or {}
    }
    
    event = WebSocketEvent(type=EventType.AGENT_PROCESSING_COMPLETE, data=event_data)
    manager.emit_event(event)


### 2. llm/wrapper.py

# Add streaming support to CustomLLM class in llm/wrapper.py:

# Add after line 130 (in __init__):
        object.__setattr__(self, '_stream_callback', kwargs.get('stream_callback', None))
        
# Add new streaming method after line 272:
    def _stream_with_callback(self, messages: List[Dict[str, str]], 
                             callback: Optional[Callable[[str], None]] = None,
                             max_tokens: int = 1000, temperature: float = 0.7) -> str:
        """Make streaming API request with callback for partial results."""
        
        if not callback:
            # No callback, fall back to regular request
            return self._make_request(messages, max_tokens, temperature)
        
        if self._use_openai_client and HAS_OPENAI and self._client is not None:
            try:
                # Use OpenAI client streaming
                logger.info(f"Making streaming request with model: {self._model_name}")
                stream = self._client.chat.completions.create(
                    model=self._model_name,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    stream=True  # Enable streaming
                )
                
                full_content = ""
                for chunk in stream:
                    if chunk.choices[0].delta.content is not None:
                        partial = chunk.choices[0].delta.content
                        full_content += partial
                        callback(partial)  # Send partial content
                
                return clean_mistral_output(full_content)
                
            except Exception as e:
                logger.warning(f"Streaming failed, falling back to regular request: {e}")
                return self._make_request(messages, max_tokens, temperature)
        else:
            # Fallback for requests-based implementation
            return self._make_request_with_simulated_streaming(messages, callback, max_tokens, temperature)
    
    def _make_request_with_simulated_streaming(self, messages: List[Dict[str, str]], 
                                               callback: Callable[[str], None],
                                               max_tokens: int = 1000, 
                                               temperature: float = 0.7) -> str:
        """Simulate streaming for non-streaming APIs by chunking response."""
        # Get full response
        full_response = self._make_api_request_fallback(messages, max_tokens, temperature)
        
        # Simulate streaming by sending chunks
        words = full_response.split()
        chunk_size = max(1, len(words) // 10)  # Send in ~10 chunks
        
        for i in range(0, len(words), chunk_size):
            chunk = ' '.join(words[i:i+chunk_size])
            if i + chunk_size < len(words):
                chunk += ' '
            callback(chunk)
            time.sleep(0.1)  # Small delay to simulate streaming
        
        return full_response
        
# Update _call_with_retry to support streaming (replace method):
    def _call_with_retry(self, prompt: str, stop: Optional[List[str]] = None,
                        stream_callback: Optional[Callable[[str], None]] = None) -> str:
        """Make API call with exponential backoff retry logic and optional streaming"""
        last_exception = None
        messages = [{"role": "user", "content": prompt}]
        
        for attempt in range(self._max_retries):
            try:
                # Enforce rate limiting before each attempt
                self._enforce_rate_limit()
                
                # Add instance-level delay
                if self._request_delay > 0:
                    time.sleep(self._request_delay)
                
                logger.debug(f"Making API request (attempt {attempt + 1}/{self._max_retries})")
                
                # Use streaming if callback provided
                if stream_callback:
                    return self._stream_with_callback(messages, stream_callback, 
                                                     self._max_tokens, self._temperature)
                else:
                    return self._make_request(messages, self._max_tokens, self._temperature)
                
            except Exception as e:
                # ... rest of error handling unchanged ...


### 3. agents/base.py

# Update the respond method in agents/base.py (starting at line 100):

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
            
            # Check if LLM supports streaming
            if hasattr(self.llm, '_stream_callback'):
                # Set stream callback temporarily
                original_callback = getattr(self.llm, '_stream_callback', None)
                self.llm._stream_callback = stream_callback
            
            # Generate response using invoke with session ID for memory
            response = self.chain.invoke(
                {"situation": situation, "other_agents": other_agents_text},
                config={"configurable": {"session_id": "conversation"}}
            )
            
            # Restore original callback
            if hasattr(self.llm, '_stream_callback'):
                self.llm._stream_callback = original_callback
            
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
            
            return self.last_output
            
        except Exception as e:
            self.logger.error(f"Error generating response: {e}")
            return f"[{self.name} is experiencing technical difficulties]"


### 4. utils/websocket_broadcaster.py

# Add to RealtimeUIUpdater in utils/websocket_broadcaster.py (after line 232):
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
        
# Add new handler methods after line 421:
    async def handle_agent_processing_started(self, event: WebSocketEvent):
        """Handle agent processing started events."""
        data = event.data
        
        # Show loading indicator
        if 'conversation_display' in self.ui_elements:
            conv_display = self.ui_elements['conversation_display']
            
            with conv_display:
                # Add processing indicator card
                with ui.card().classes('w-full mb-4 agent-processing-card bg-blue-50') as card:
                    card.set_id(f"processing-{data['agent_id']}")
                    
                    with ui.row().classes('items-center gap-2'):
                        # Animated spinner
                        ui.icon('refresh').classes('animate-spin text-blue-500')
                        ui.label(f"{data['agent_id']} is thinking...").classes('font-semibold')
                    
                    # Container for streaming text
                    ui.markdown('').classes('streaming-content text-sm mt-2').set_id(
                        f"streaming-{data['agent_id']}"
                    )
        
        # Update status
        if 'agent_status' in self.ui_elements:
            self.ui_elements['agent_status'].set_text(f"{data['agent_id']}: Processing...")
    
    async def handle_agent_processing_update(self, event: WebSocketEvent):
        """Handle streaming updates during agent processing."""
        data = event.data
        
        # Update streaming content
        await ui.run_javascript(f"""
            const streamingEl = document.getElementById('streaming-{data["agent_id"]}');
            if (streamingEl) {{
                streamingEl.textContent += '{data["partial_content"]}';
                
                // Auto-scroll
                const container = document.querySelector('.conversation-container');
                if (container) {{
                    container.scrollTop = container.scrollHeight;
                }}
            }}
            
            // Update progress if available
            const progress = {data.get("progress", 0)} * 100;
            const card = document.getElementById('processing-{data["agent_id"]}');
            if (card && progress > 0) {{
                card.style.background = `linear-gradient(to right, #dbeafe ${progress}%, #eff6ff ${progress}%)`;
            }}
        """)
    
    async def handle_agent_processing_complete(self, event: WebSocketEvent):
        """Handle agent processing complete events."""
        data = event.data
        
        # Remove processing card and add final message
        if 'conversation_display' in self.ui_elements:
            # Remove processing indicator
            await ui.run_javascript(f"""
                const processingCard = document.getElementById('processing-{data["agent_id"]}');
                if (processingCard) {{
                    processingCard.remove();
                }}
            """)
            
            # Add final message using existing handler
            # Convert to agent_message format
            message_event = WebSocketEvent(
                type=EventType.AGENT_MESSAGE,
                data={
                    'agent_id': data['agent_id'],
                    'content': data['final_content'],
                    'sentiment': data.get('sentiment', {'score': 0.0, 'label': 'neutral'}),
                    'metadata': data.get('metadata', {})
                }
            )
            await self.handle_agent_message(message_event)


## Testing the Fix

1. Start the application
2. Send a message to trigger agent responses
3. You should see:
   - Immediate "Agent is thinking..." indicator
   - Text streaming in as it's generated
   - Progress bar showing completion
   - Final message replacing the processing indicator

## Expected Behavior

### Before Fix:
- UI sits idle for 10+ seconds
- Message appears all at once after processing
- No feedback during processing

### After Fix:
- Immediate visual feedback when processing starts
- Real-time streaming of response text
- Progress indication
- Smooth transition to final message

## Additional Considerations

1. **LiteLLM Configuration**: Ensure streaming is enabled in LiteLLM config
2. **Ollama Support**: Verify Ollama supports streaming responses
3. **Network Latency**: Streaming may add slight overhead but improves UX
4. **Error Handling**: Streaming failures should gracefully fall back to regular mode
