"""
Custom LLM wrapper for LM Studio integration compatible with LangChain 0.1.0
"""

import json
import requests
import time
import threading
import random
import re
from typing import Optional, List, Dict, Any, Callable
from datetime import datetime, timedelta
from langchain.llms.base import LLM
from langchain.callbacks.manager import CallbackManagerForLLMRun
from config.config import LLM_CONFIG
import logging

# Try to import OpenAI client, fall back to requests if not available
try:
    from openai import OpenAI
    HAS_OPENAI = True
except ImportError:
    HAS_OPENAI = False

logger = logging.getLogger(__name__)

def clean_mistral_output(text: str) -> str:
    """Clean garbled output from Mistral models by decoding hex tokens and fixing corruption"""
    if not text:
        return text
    
    # Pattern to match hex tokens like <0x0A>, <0x20>, etc.
    hex_pattern = r'<0x([0-9A-Fa-f]{2})>'
    
    def hex_replacer(match):
        hex_value = match.group(1)
        try:
            # Convert hex to integer, then to character
            char_code = int(hex_value, 16)
            # Handle common characters
            if char_code == 0x0A:  # newline
                return '\n'
            elif char_code == 0x20:  # space
                return ' '
            elif char_code == 0x09:  # tab
                return '\t'
            elif char_code == 0x0D:  # carriage return
                return '\r'
            elif 32 <= char_code <= 126:  # printable ASCII
                return chr(char_code)
            else:
                # For non-printable characters, return empty string
                return ''
        except ValueError:
            # If conversion fails, return original match
            return match.group(0)
    
    # Replace hex tokens with actual characters
    cleaned = re.sub(hex_pattern, hex_replacer, text)
    
    # Clean up common tokenization corruption patterns
    # Remove fragmented words with apostrophes (e.g., "i'tize" -> "it")
    cleaned = re.sub(r"\b\w*'\w*(?='|\s|$)", '', cleaned)
    
    # Fix broken contractions and fragmented text
    cleaned = re.sub(r"['''](?=[a-z])", '', cleaned)
    
    # Remove excessive punctuation and malformed text
    cleaned = re.sub(r'[,\.]{3,}', '.', cleaned)
    cleaned = re.sub(r'\b[,\.;:!?]{2,}\b', '.', cleaned)
    
    # Remove fragmented single letters and malformed tokens
    cleaned = re.sub(r'\b[a-zA-Z]\b(?=\s[a-zA-Z]\b)', '', cleaned)
    
    # Clean up excessive whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned)
    
    # Remove lines that are mostly garbled (more than 50% non-letter characters)
    lines = cleaned.split('\n')
    clean_lines = []
    for line in lines:
        if line.strip():
            # Count actual letters vs other characters
            letters = sum(1 for c in line if c.isalpha())
            total_chars = len(line.strip())
            if total_chars > 0 and letters / total_chars >= 0.3:  # At least 30% letters
                clean_lines.append(line.strip())
    
    result = '\n'.join(clean_lines).strip()
    
    # If the result is still mostly garbled, return a fallback message
    if result and len(result.split()) > 3:
        letters = sum(1 for c in result if c.isalpha())
        total_chars = len(result)
        if letters / total_chars < 0.4:  # Less than 40% letters
            agent_name = "Agent"  # Default fallback
            return f"[{agent_name} is processing complex psychological dynamics and requires more context to respond coherently]"
    
    return result if result else "[Response processing incomplete]"

# Module-level rate limiting data (thread-safe)
_module_lock = threading.Lock()
_request_times = []  # Store timestamps of recent requests
_max_requests_per_minute = 10  # Rate limit: 10 requests per minute

class CustomLLM(LLM):
    """Custom LLM wrapper for LM Studio API with enhanced rate limiting and retry logic
    
    This class implements the LangChain LLM interface for LM Studio API integration.
    It supports both OpenAI client and requests-based fallback for maximum compatibility.
    """
    
    def __init__(self, **kwargs):
        # Initialize parent class first
        super().__init__(**kwargs)
        
        # Load config values
        config = LLM_CONFIG.get('default', {})
        
        # Store configuration as internal attributes (bypassing Pydantic validation)
        object.__setattr__(self, '_api_url', kwargs.get('api_url', config.get('api_url', "http://localhost:1234/v1/completions")))
        object.__setattr__(self, '_api_key', kwargs.get('api_key', config.get('api_key', None)))
        object.__setattr__(self, '_model_name', kwargs.get('model', config.get('model', "mistral-7b-instruct")))
        object.__setattr__(self, '_max_tokens', kwargs.get('max_tokens', config.get('max_tokens', 500)))
        object.__setattr__(self, '_temperature', kwargs.get('temperature', config.get('temperature', 0.7)))
        object.__setattr__(self, '_timeout', kwargs.get('timeout', config.get('timeout', 120)))
        object.__setattr__(self, '_request_delay', kwargs.get('request_delay', config.get('request_delay', 3.0)))
        object.__setattr__(self, '_max_retries', kwargs.get('retry_attempts', config.get('retry_attempts', 3)))
        object.__setattr__(self, '_retry_delay', kwargs.get('retry_delay', config.get('retry_delay', 2.0)))
        object.__setattr__(self, '_max_retry_delay', kwargs.get('max_retry_delay', config.get('max_retry_delay', 60.0)))
        object.__setattr__(self, '_use_openai_client', kwargs.get('use_openai_client', config.get('use_openai_client', False)))
        object.__setattr__(self, '_stream_callback', kwargs.get('stream_callback', None))
        
        # Initialize OpenAI client as regular instance variable
        object.__setattr__(self, '_client', None)
        if self._use_openai_client and HAS_OPENAI:
            try:
                # Clean up the base URL for OpenAI client
                base_url = self._api_url
                if base_url.endswith('/chat/completions'):
                    base_url = base_url.replace('/chat/completions', '')
                elif base_url.endswith('/completions'):
                    base_url = base_url.replace('/completions', '')
                
                client = OpenAI(
                    api_key=self._api_key,
                    base_url=base_url,
                    timeout=self._timeout
                )
                object.__setattr__(self, '_client', client)
                logger.info(f"CustomLLM initialized with OpenAI client")
            except Exception as e:
                logger.warning(f"Failed to initialize OpenAI client, falling back to requests: {e}")
                object.__setattr__(self, '_use_openai_client', False)
                object.__setattr__(self, '_client', None)
        
        logger.info(f"CustomLLM initialized with timeout={self._timeout}s, request_delay={self._request_delay}s, max_retries={self._max_retries}")
    
    @property
    def _llm_type(self) -> str:
        """Return identifier of llm type"""
        return "custom_lm_studio"
    
    @property
    def _identifying_params(self) -> Dict[str, Any]:
        """Get the identifying parameters"""
        params = {
            "api_url": self._api_url,
            "model": self._model_name,
            "temperature": self._temperature,
            "max_tokens": self._max_tokens
        }
        if self._api_key:
            params["api_key"] = "***" + self._api_key[-4:] if len(self._api_key) > 4 else "***"
        return params
    
    @staticmethod
    def _enforce_rate_limit():
        """Enforce rate limiting across all instances of CustomLLM using module-level lock"""
        global _module_lock, _request_times, _max_requests_per_minute
        
        with _module_lock:
            current_time = datetime.now()
            
            # Remove timestamps older than 1 minute
            _request_times = [
                timestamp for timestamp in _request_times
                if current_time - timestamp < timedelta(minutes=1)
            ]
            
            # Check if we've exceeded the rate limit
            if len(_request_times) >= _max_requests_per_minute:
                # Calculate wait time until oldest request falls outside the window
                oldest_request = min(_request_times)
                wait_time = 60 - (current_time - oldest_request).total_seconds()
                if wait_time > 0:
                    logger.warning(f"Rate limit reached. Waiting {wait_time:.2f} seconds...")
                    time.sleep(wait_time)
            
            # Record this request
            _request_times.append(current_time)
    
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
    
    def _make_request(self, messages: List[Dict[str, str]], max_tokens: int = 1000, temperature: float = 0.7) -> str:
        """Make API request with retry logic."""
        if self._use_openai_client and HAS_OPENAI and self._client is not None:
            try:
                # Use OpenAI client directly
                logger.info(f"Making OpenAI client request with model: {self._model_name} to base_url: {self._client.base_url}")
                response = self._client.chat.completions.create(
                    model=self._model_name,
                    messages=messages,
                    max_tokens=max_tokens,
                    temperature=temperature
                )
                raw_content = response.choices[0].message.content
                logger.info(f"OpenAI client request successful, response length: {len(raw_content)}")
                return clean_mistral_output(raw_content)
            except Exception as e:
                logger.warning(f"OpenAI client failed, falling back to requests: {e}")
                # Fall back to requests-based implementation
                return self._make_api_request_fallback(messages, max_tokens, temperature)
        else:
            # Use requests-based implementation directly
            return self._make_api_request_fallback(messages, max_tokens, temperature)
    
    def _make_api_request_fallback(self, messages: List[Dict[str, str]], max_tokens: int = 1000, temperature: float = 0.7) -> str:
        """Fallback API request method using requests library"""
        headers = {
            "Content-Type": "application/json",
        }
        
        # Add authorization header if API key is provided
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        
        # Use chat completions format
        data = {
            "messages": messages,
            "model": self._model_name,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False
        }
        
        logger.info(f"Making fallback API request to: {self._api_url} with model: {self._model_name}")
        logger.debug(f"Request payload: {json.dumps(data, indent=2)}")
        
        response = requests.post(
            self._api_url,
            headers=headers,
            json=data,
            timeout=self._timeout
        )
        
        logger.info(f"API response status code: {response.status_code}")
        if response.status_code != 200:
            logger.error(f"API error response: {response.text}")
            
        response.raise_for_status()
        
        result = response.json()
        # Handle both chat completions and completions response formats
        if "choices" in result and len(result["choices"]) > 0:
            choice = result["choices"][0]
            if "message" in choice and "content" in choice["message"]:
                raw_content = choice["message"]["content"].strip()
                return clean_mistral_output(raw_content)
            elif "text" in choice:
                raw_content = choice["text"].strip()
                return clean_mistral_output(raw_content)
        
        raise ValueError("Invalid API response format")
    
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
                last_exception = e
                logger.warning(f"API request failed (attempt {attempt + 1}/{self._max_retries}): {type(e).__name__}: {str(e)}")
                
                # Log more details for specific error types
                if hasattr(e, 'response') and hasattr(e.response, 'text'):
                    logger.error(f"Error response body: {e.response.text}")
                if hasattr(e, 'response') and hasattr(e.response, 'status_code'):
                    logger.error(f"Error response status: {e.response.status_code}")
                
                if attempt < self._max_retries - 1:  # Don't wait after the last attempt
                    # Calculate exponential backoff with jitter
                    base_delay = self._retry_delay * (2 ** attempt)
                    max_delay = min(base_delay, self._max_retry_delay)
                    # Add jitter to prevent thundering herd
                    jitter = random.uniform(0.1, 0.3) * max_delay
                    total_delay = max_delay + jitter
                    
                    logger.info(f"Retrying in {total_delay:.2f} seconds...")
                    time.sleep(total_delay)
        
        # If all retries failed, raise the last exception
        logger.error(f"All {self._max_retries} attempts failed. Last error: {str(last_exception)}")
        raise last_exception
    
    def _call(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> str:
        """Call the LM Studio API with enhanced error handling and retry logic
        
        This is the main method that LangChain calls to generate text.
        """
        try:
            return self._call_with_retry(prompt, stop)
        except requests.exceptions.RequestException as e:
            error_msg = f"Error calling LLM API after {self._max_retries} attempts: {str(e)}"
            logger.error(error_msg)
            return error_msg
        except (KeyError, IndexError) as e:
            error_msg = f"Error parsing LLM response: {str(e)}"
            logger.error(error_msg)
            return error_msg
        except Exception as e:
            error_msg = f"Unexpected error in LLM call: {str(e)}"
            logger.error(error_msg)
            return error_msg
    
    @property
    def model(self) -> str:
        """Backward compatibility property for model name"""
        return self._model_name
    
    @model.setter
    def model(self, value: str):
        """Setter for backward compatibility"""
        object.__setattr__(self, '_model_name', value)
    
    def generate_with_streaming(self, prompt: str, stream_callback: Optional[Callable[[str], None]] = None) -> str:
        """Generate response with optional streaming callback.
        
        Args:
            prompt: The prompt to generate a response for
            stream_callback: Optional callback function for streaming chunks
            
        Returns:
            The complete generated response
        """
        return self._call_with_retry(prompt, stream_callback=stream_callback)