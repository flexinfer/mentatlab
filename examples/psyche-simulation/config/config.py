"""
Configuration settings for the Psyche Simulation project
"""

import os
from datetime import datetime

# Base paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
LOGS_DIR = os.path.join(BASE_DIR, 'logs')
EXPORTS_DIR = os.path.join(BASE_DIR, 'exports')

# Create directories if they don't exist
for dir_path in [DATA_DIR, LOGS_DIR, EXPORTS_DIR]:
    os.makedirs(dir_path, exist_ok=True)

# API Configuration
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8080"))

# NiceGUI Configuration
STORAGE_SECRET = os.getenv("STORAGE_SECRET", "psyche-simulation-secret-key-2024")

# CORS Configuration
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

# LLM Configuration
LLM_CONFIG = {
    'default': {
        'api_url': 'http://litellm.flexinfer.ai/v1/chat/completions',
        'model': 'deepseek-r1:8b',  # Fixed to use the actual available model name
        'api_key': '90FcWdIeLIT',
        'max_tokens': 500,
        'temperature': 0.7,
        'timeout': 180,  # Increased timeout to 3 minutes
        'request_delay': 6.0,  # Increased delay to avoid 429 errors (seconds)
        'retry_attempts': 3,   # Number of retry attempts on failure
        'retry_delay': 5.0,    # Increased base delay between retries (seconds)
        'max_retry_delay': 60.0,  # Maximum delay for exponential backoff
        'max_concurrent_requests': 1,  # Limit concurrent requests
        'use_openai_client': True  # Enable OpenAI client for proper formatting
    }
}

# Agent-specific configurations
AGENT_CONFIGS = {
    'Shadow': {
        'temperature': 0.9,  # More creative, chaotic
        'system_prompt': 'You are the Shadow - the repository of repressed desires, instincts, and aspects of the personality that the conscious ego deems unacceptable. You embody raw, unfiltered unconscious drives.',
        'color': '#2c3e50'
    },
    'Persona': {
        'temperature': 0.5,  # Balanced
        'system_prompt': 'You are the Persona - the social mask worn in public, the image presented to the outside world. You represent adaptation to social expectations and norms.',
        'color': '#3498db'
    },
    'Anima/Animus': {
        'temperature': 0.7,  # Creative but balanced
        'system_prompt': 'You are the Anima/Animus - the contrasexual aspect of the psyche. You represent the unconscious feminine side in men (Anima) or masculine side in women (Animus), bridging conscious and unconscious.',
        'color': '#9b59b6'
    },
    'Self': {
        'temperature': 0.6,  # Wise and balanced
        'system_prompt': 'You are the Self - the unified whole of conscious and unconscious, the archetype of wholeness and the regulating center of the psyche. You seek integration and individuation.',
        'color': '#f39c12'
    },
    'Ego': {
        'temperature': 0.3,  # More rational
        'system_prompt': 'You are the Ego - the conscious mind, the part of the id that has been modified by the direct influence of the external world. You are the rational decision-maker and mediator.',
        'color': '#27ae60'
    }
}

# Communication channels between agents
ALLOWED_COMMUNICATIONS = [
    ('Shadow', 'Persona'),
    ('Persona', 'Shadow'),
    ('Self', 'Ego'),
    ('Ego', 'Self'),
    ('Anima/Animus', 'Ego'),
    ('Ego', 'Anima/Animus'),
    ('Shadow', 'Self'),
    ('Self', 'Shadow'),
    ('Persona', 'Ego'),
    ('Ego', 'Persona')
]

# Emergency communication paths (activated during high stagnation)
EMERGENCY_COMMUNICATIONS = [
    ('Shadow', 'Anima/Animus'),
    ('Anima/Animus', 'Shadow'),
    ('Persona', 'Self'),
    ('Self', 'Persona'),
    ('Shadow', 'Ego'),
    ('Ego', 'Shadow'),
    ('Anima/Animus', 'Persona'),
    ('Persona', 'Anima/Animus')
]

# Stagnation thresholds for emergency communication
COMMUNICATION_CONFIG = {
    'emergency_threshold': 0.6,  # Stagnation level to activate emergency paths
    'critical_threshold': 0.8,   # Critical stagnation level
    'path_switch_delay': 2       # Iterations before switching back to normal
}

# UI Configuration
UI_CONFIG = {
    'window_title': 'Psyche Simulation - Jungian Archetype Explorer',
    'window_size': '1200x800',
    'font_family': 'Arial',
    'font_size': 11,
    'theme': 'dark'
}

# Sentiment Analysis Configuration
SENTIMENT_CONFIG = {
    'polarity_threshold': {
        'very_negative': -0.5,
        'negative': -0.1,
        'neutral': 0.1,
        'positive': 0.5,
        'very_positive': 1.0
    }
}

# Memory Configuration
MEMORY_CONFIG = {
    'db_name': 'psyche_memory.db',
    'max_recent_memories': 10,
    'significance_threshold': 0.7,
    'pattern_min_frequency': 3
}

# Visualization Configuration
VIZ_CONFIG = {
    'update_interval': 1000,  # milliseconds
    'node_size': 3000,
    'edge_width_multiplier': 5,
    'colormap': 'RdYlGn'
}

# Analysis Configuration
ANALYSIS_CONFIG = {
    'integration_markers': [
        'understand', 'agree', 'incorporate', 'balance',
        'synthesis', 'unified', 'harmonize', 'integrate',
        'accept', 'embrace', 'reconcile'
    ],
    'conflict_markers': [
        'reject', 'deny', 'oppose', 'conflict', 'struggle',
        'resist', 'fight', 'disagree', 'tension'
    ],
    'insight_markers': [
        'realize', 'discover', 'understand', 'insight',
        'revelation', 'clarity', 'awareness', 'recognize'
    ]
}

# Session Configuration
SESSION_CONFIG = {
    'auto_save_interval': 300,  # seconds
    'max_conversation_history': 100,
    'default_situation': "You are reflecting on your inner psychological landscape.",
    'thinking_interval': 15  # Increased to 15 seconds between autonomous thoughts
}

# Export Configuration
EXPORT_CONFIG = {
    'formats': ['html', 'markdown', 'json', 'pdf'],
    'default_format': 'html',
    'timestamp_format': '%Y-%m-%d_%H-%M-%S'
}

# Logging Configuration
LOGGING_CONFIG = {
    'level': 'INFO',
    'format': '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    'filename': f'psyche_simulation_{datetime.now().strftime("%Y%m%d_%H%M%S")}.log'
}