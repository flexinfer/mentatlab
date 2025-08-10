#!/usr/bin/env python3
"""
Streaming UI for Psyche Simulation - Single-page realtime interface
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, List, Optional, Any, Callable
from nicegui import ui
from nicegui.context import context

from simulation.core import PsycheSimulation
from analysis.sentiment import get_emotional_tone
from data.redis_state_manager import RedisStateManager
from auth.user_manager import UserManager, UserProfile
from auth.session_handler import SessionManager, SessionType
from ui.auth_components import AuthState, create_login_page, create_registration_page
from ui.components import UIManager
from utils.websocket_broadcaster import WebSocketBroadcaster, RealtimeUIUpdater
from utils.websocket_events import EventType

logger = logging.getLogger(__name__)


def create_ui():
    """Create the streaming UI interface with authentication"""
    
    # Initialize Redis and authentication components
    redis_manager = RedisStateManager()
    user_manager = UserManager(redis_manager)
    session_manager = SessionManager(redis_manager, user_manager)
    
    # Global auth state
    auth_state = AuthState()
    
    # Initialize WebSocket broadcaster
    broadcaster = WebSocketBroadcaster()
    ui_updater = RealtimeUIUpdater(broadcaster)
    
    # Enable dark mode
    ui.dark_mode().enable()
    
    # Add streaming CSS
    ui.add_head_html('''
    <style>
    :root {
        --bg-primary: #0f0f0f;
        --bg-surface: #1a1a1a;
        --color-primary: #3b82f6;
        --color-success: #10b981;
        --color-error: #ef4444;
        --text-primary: #f3f4f6;
    }
    
    body {
        background-color: var(--bg-primary);
        color: var(--text-primary);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    .main-header {
        background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
        border-bottom: 1px solid #374151;
        padding: 1rem 1.5rem;
    }
    
    .control-panel {
        background: var(--bg-surface);
        border: 1px solid #374151;
        border-radius: 12px;
        padding: 24px;
        margin-bottom: 24px;
    }
    
    .status-bar {
        background: linear-gradient(90deg, #1f2937 0%, #111827 100%);
        border: 1px solid #374151;
        border-radius: 12px;
        padding: 16px 24px;
        margin-bottom: 24px;
    }
    
    .conversation-message {
        background: rgba(59, 130, 246, 0.1);
        border: 1px solid rgba(59, 130, 246, 0.2);
        border-radius: 8px;
        padding: 16px;
        margin-bottom: 12px;
        animation: fadeInUp 0.5s ease-out;
    }
    
    .agent-message-card {
        animation: fadeInUp 0.5s ease-out;
    }
    
    @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }
    
    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }
    
    .animate-pulse {
        animation: pulse 2s ease-in-out infinite;
    }
    
    /* Sentiment colors */
    .text-green-400 { color: #4ade80 !important; }
    .text-yellow-400 { color: #facc15 !important; }
    .text-red-400 { color: #f87171 !important; }
    
    /* Agent colors */
    .text-gray-600 { color: #4b5563; }
    .text-blue-600 { color: #2563eb; }
    .text-purple-600 { color: #9333ea; }
    .text-orange-600 { color: #ea580c; }
    .text-green-600 { color: #16a34a; }
    
    /* Thinking animation */
    @keyframes thinking {
        0%, 20% { opacity: 0.4; }
        50% { opacity: 1; }
        80%, 100% { opacity: 0.4; }
    }
    
    .thinking-animation {
        animation: thinking 1.5s ease-in-out infinite;
    }
    
    .thinking-section {
        background-color: #f3f4f6;
        border-left: 3px solid #9333ea;
        padding: 8px 12px;
        margin-top: 8px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    
    .thinking-section:hover {
        background-color: #e5e7eb;
    }
    
    .thinking-content {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.3s ease;
        margin-top: 8px;
        padding: 0;
    }
    
    .thinking-content.expanded {
        max-height: 500px;
        padding-top: 8px;
    }
    
    .thinking-icon {
        display: inline-block;
        transition: transform 0.2s ease;
    }
    
    .thinking-icon.expanded {
        transform: rotate(90deg);
    }
    
    .status-indicator-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: 8px;
        animation: pulse 2s ease-in-out infinite;
    }
    
    .status-indicator-dot.active {
        background-color: #10b981;
    }
    
    .status-indicator-dot.inactive {
        background-color: #ef4444;
    }
    
    .btn-primary { background: var(--color-primary); color: white; border-radius: 6px; padding: 8px 16px; }
    .btn-success { background: var(--color-success); color: white; border-radius: 6px; padding: 8px 16px; }
    .btn-error { background: var(--color-error); color: white; border-radius: 6px; padding: 8px 16px; }
    </style>
    
    <script>
    // Global WebSocket event handler
    window.websocketEventHandler = function(eventData) {
        console.log('WebSocket Event:', eventData);
        
        // Trigger visual updates based on event type
        switch(eventData.type) {
            case 'agent_message':
                console.log('Agent message:', eventData.data);
                break;
            case 'network_update':
                console.log('Network update:', eventData.data);
                break;
            case 'system_status':
                console.log('System status:', eventData.data);
                updateSystemStatus(eventData.data);
                break;
        }
    };
    
    // Update system status
    function updateSystemStatus(data) {
        const statusDot = document.querySelector('.status-indicator-dot');
        if (statusDot) {
            statusDot.classList.toggle('active', data.is_running);
            statusDot.classList.toggle('inactive', !data.is_running);
        }
    }
    
    // Listen for custom events
    window.addEventListener('psyche-websocket-event', function(e) {
        window.websocketEventHandler(e.detail);
    });
    </script>
    ''')
    
    # Create header (initially hidden)
    header_element = ui.header().classes('main-header')
    header_element.style('display: none')
    
    # Create main container
    main_container = ui.column().classes('w-full')
    
    def create_authenticated_ui(user_profile: UserProfile, session_id: str, jwt_token: str):
        """Create the main simulation UI for authenticated users"""
        
        # Initialize simulation with session context
        simulation = PsycheSimulation(session_id=session_id, redis_manager=redis_manager)
        ui_manager = UIManager(simulation, session_manager, session_id, user_profile)
        
        # Store auth info in UI manager
        ui_manager.user_profile = user_profile
        ui_manager.session_id = session_id
        ui_manager.jwt_token = jwt_token
        
        # Connect WebSocket components
        ui_manager.broadcaster = broadcaster
        ui_manager.ui_updater = ui_updater
        
        return ui_manager
    
    def show_main_interface():
        """Show the main streaming interface after authentication"""
        logger.info("=== show_main_interface: Called ===")
        
        if not auth_state.is_authenticated():
            logger.info("Not authenticated, showing login interface")
            show_login_interface()
            return
            
        logger.info("Authenticated, creating streaming UI")
        ui_manager = create_authenticated_ui(
            auth_state.user_profile,
            auth_state.session_id,
            auth_state.jwt_token
        )
        
        # Clear the main container
        main_container.clear()
        
        # Show the header
        header_element.style('display: block')
        header_element.clear()
        
        # Populate header
        with header_element:
            with ui.row().classes('w-full items-center justify-between'):
                ui.label('🧠 Psyche Simulation').classes('text-2xl font-bold')
                
                with ui.row().classes('items-center gap-4'):
                    ui.label(f'👤 {ui_manager.user_profile.display_name}').classes('text-blue-400')
                    ui.label(f'({ui_manager.user_profile.role.value})').classes('text-sm text-gray-400')
                    
                    # System status with animated dot
                    with ui.row().classes('items-center'):
                        ui.html('<span class="status-indicator-dot inactive"></span>')
                        ui_manager.status_label = ui.label('Ready').classes('text-green-400')
                    
                    ui.button('🚪 Logout', on_click=logout).classes('bg-red-600 text-white')
        
        # Create streaming interface content
        with main_container:
            create_streaming_content(ui_manager, auth_state, session_manager)
    
    def show_login_interface():
        """Show the login interface"""
        logger.info("=== show_login_interface: Called ===")
        
        # Clear the main container
        main_container.clear()
        
        def on_login_success(user_profile: UserProfile, session_id: str, jwt_token: str):
            logger.info("=== on_login_success callback triggered ===")
            auth_state.login(user_profile, session_id, jwt_token)
            # Use a timer to escape the current UI context
            ui.timer(0.1, show_main_interface, once=True)
        
        def on_show_register():
            show_register_interface()
        
        # Create login page inside the main container
        with main_container:
            create_login_page(
                user_manager=user_manager,
                session_manager=session_manager,
                on_success=on_login_success,
                on_show_register=on_show_register
            )
    
    def show_register_interface():
        """Show the registration interface"""
        # Clear the main container
        main_container.clear()
        
        def on_register_success():
            ui.notify("Registration successful! Please log in.", type='positive')
            show_login_interface()
        
        def on_show_login():
            show_login_interface()
        
        # Create registration page inside the main container
        with main_container:
            create_registration_page(
                user_manager=user_manager,
                on_success=on_register_success,
                on_show_login=on_show_login
            )
    
    def logout():
        """Handle user logout"""
        if auth_state.session_id:
            session_manager.terminate_session(auth_state.session_id, auth_state.user_profile.user_id)
        auth_state.logout()
        
        # Hide header
        header_element.style('display: none')
        header_element.clear()
        
        # Clear main container and show login
        main_container.clear()
        show_login_interface()
    
    # Start with login interface
    logger.info("=== create_ui: Starting with login interface ===")
    show_login_interface()


def create_streaming_content(ui_manager: UIManager, auth_state, session_manager):
    """Create the streaming interface content"""
    logger.info("=== create_streaming_content: Starting ===")
    
    with ui.column().classes('w-full max-w-6xl mx-auto p-6'):
        
        # Control Panel
        with ui.card().classes('control-panel'):
            ui.label('Control Panel').classes('text-xl font-bold mb-4')
            
            with ui.row().classes('w-full gap-4 mb-4'):
                situation_input = ui.input(
                    'Situation', 
                    value=ui_manager.simulation.current_situation
                ).classes('flex-grow')
                
                iterations_input = ui.number(
                    'Iterations', 
                    value=5, 
                    min=1, 
                    max=20
                ).classes('w-32')
            
            with ui.row().classes('gap-4'):
                async def start_simulation():
                    ui_manager.simulation.current_situation = situation_input.value
                    await ui_manager.run_autonomous_loop(int(iterations_input.value))
                
                ui.button('▶️ Start', on_click=start_simulation).classes('btn-success')
                ui.button('⏹️ Stop', on_click=ui_manager.simulation.stop_simulation).classes('btn-error')
                ui.button('🔄 Reset', on_click=ui_manager.simulation.reset_conversation_dynamics).classes('btn-primary')
                ui.button('⚡ Inject Stimulus', on_click=lambda: ui_manager.simulation.inject_stimulus()).classes('bg-orange-600 text-white')
        
        # Status Bar
        with ui.row().classes('status-bar'):
            # Status indicator
            with ui.row().classes('items-center'):
                ui.icon('circle').classes('text-xs')
                status_label = ui.label('System: IDLE').classes('font-semibold')
                if ui_manager.ui_updater:
                    ui_manager.ui_updater.register_element('main_status', status_label)
            
            # Message counter
            message_counter = ui.label('Messages: 0').classes('text-blue-400 font-semibold')
            if ui_manager.ui_updater:
                ui_manager.ui_updater.register_element('message_counter', message_counter)
            
            # Network status
            with ui.row().classes('items-center gap-2'):
                ui.icon('network_check').classes('text-green-400')
                network_status = ui.label('Network: Active').classes('text-green-400')
                if ui_manager.ui_updater:
                    ui_manager.ui_updater.register_element('network_status', network_status)
            
            # Processing indicator
            with ui.row().classes('items-center gap-2').style('display: none') as processing_indicator:
                ui.spinner(size='sm')
                ui.label('Processing...').classes('text-yellow-400')
            if ui_manager.ui_updater:
                ui_manager.ui_updater.register_element('processing_indicator', processing_indicator)
        
        # Main content area with expansions
        # Conversation Feed
        with ui.expansion('💬 Conversation Feed', value=True, icon='chat').classes('w-full mb-4'):
            ui.label('Live conversation feed').classes('text-gray-400 mb-4')
            
            with ui.scroll_area().classes('w-full h-96 p-4 conversation-container'):
                ui_manager.conversation_container = ui.column().classes('w-full')
                
                # Add initial welcome message
                with ui_manager.conversation_container:
                    with ui.card().classes('conversation-message'):
                        ui.label('System').classes('font-bold text-gray-400 mb-2')
                        ui.label('Welcome to the streaming UI. Click "Start" to begin the autonomous conversation.').classes('text-sm')
                
                # Register conversation container for real-time updates
                if ui_manager.ui_updater:
                    ui_manager.ui_updater.register_element('conversation_display', ui_manager.conversation_container)
        
        # Health Monitor
        with ui.expansion('🏥 Health Monitor', icon='favorite').classes('w-full mb-4'):
            ui.label('Health Metrics').classes('text-lg font-bold mb-4')
            
            with ui.grid(columns=3).classes('w-full gap-4'):
                health_metrics = ['stagnation', 'engagement', 'diversity', 'repetition', 'conflict', 'emotional_intensity']
                
                for metric in health_metrics:
                    with ui.card().classes('p-4 text-center'):
                        ui.label(metric.replace('_', ' ').title()).classes('font-semibold mb-2')
                        progress = ui.linear_progress(value=0, show_value=False).classes('mb-2')
                        label = ui.label('0.000').classes('text-sm')
                        
                        ui_manager.health_indicators[metric] = {
                            'progress': progress,
                            'label': label
                        }
            
            # Agent states
            ui.separator().classes('my-4')
            ui.label('🤖 Agent States').classes('text-lg font-bold mb-4')
            
            with ui.grid(columns=2).classes('w-full gap-4'):
                for agent_name in ['Self', 'Shadow', 'Persona', 'Anima/Animus', 'Ego']:
                    with ui.card().classes('p-4'):
                        ui.label(agent_name).classes('font-bold text-lg mb-2')
                        
                        sentiment_label = ui.label('Sentiment: Unknown').classes('text-sm mb-1')
                        interactions_label = ui.label('Interactions: 0').classes('text-sm mb-1')
                        adapted_label = ui.label('✓ Normal').classes('text-sm text-green-400')
                        
                        ui_manager.agent_state_panels[agent_name] = {
                            'sentiment': sentiment_label,
                            'interactions': interactions_label,
                            'adapted': adapted_label
                        }
            
            # Emergency status
            ui.separator().classes('my-4')
            with ui.card().classes('w-full p-4 bg-gray-800'):
                ui.label('🚨 Emergency Communication Status').classes('text-lg font-bold mb-4')
                
                emergency_status_label = ui.label('Status: Normal Communication').classes('text-green-400 mb-2')
                emergency_duration_label = ui.label('Duration: -').classes('text-sm mb-2')
                stagnation_trend_label = ui.label('Stagnation Trend: -').classes('text-sm')
                
                ui_manager.emergency_indicators = {
                    'status': emergency_status_label,
                    'duration': emergency_duration_label,
                    'trend': stagnation_trend_label
                }
                
                if ui_manager.ui_updater:
                    ui_manager.ui_updater.register_element('emergency_status', emergency_status_label)
        
        # Visualizations
        with ui.expansion('📊 Visualizations', icon='analytics').classes('w-full mb-4'):
            with ui.row().classes('w-full gap-4'):
                # Network visualization
                with ui.card().classes('flex-1 p-4'):
                    with ui.row().classes('items-center justify-between mb-2'):
                        ui.label('🌐 Agent Network').classes('text-lg font-bold')
                        with ui.row().classes('items-center gap-2'):
                            ui.html('<span class="status-indicator-dot active"></span>')
                            ui.label('LIVE').classes('text-xs text-green-400 font-semibold')
                    
                    ui_manager.network_chart = ui.plotly({}).classes('w-full')
                    
                    # Network statistics
                    with ui.row().classes('mt-4 gap-4 text-sm'):
                        connections_label = ui.label('Connections: 0')
                        avg_strength_label = ui.label('Avg Strength: 0.00')
                        if ui_manager.ui_updater:
                            ui_manager.ui_updater.register_element('connections_count', connections_label)
                            ui_manager.ui_updater.register_element('avg_strength', avg_strength_label)
                    
                    if ui_manager.ui_updater:
                        ui_manager.ui_updater.register_element('network_chart', ui_manager.network_chart)

                # Sentiment visualization
                with ui.card().classes('flex-1 p-4'):
                    with ui.row().classes('items-center justify-between mb-2'):
                        ui.label('📊 Sentiment Analysis').classes('text-lg font-bold')
                        with ui.row().classes('items-center gap-2'):
                            ui.html('<span class="status-indicator-dot active"></span>')
                            ui.label('LIVE').classes('text-xs text-green-400 font-semibold')
                    
                    ui_manager.sentiment_chart = ui.plotly({}).classes('w-full')
                    
                    # Sentiment summary
                    with ui.row().classes('mt-4 gap-4 text-sm'):
                        overall_sentiment = ui.label('Overall: Neutral')
                        sentiment_trend = ui.label('Trend: ➡️ Stable')
                        if ui_manager.ui_updater:
                            ui_manager.ui_updater.register_element('overall_sentiment', overall_sentiment)
                            ui_manager.ui_updater.register_element('sentiment_trend', sentiment_trend)
                    
                    if ui_manager.ui_updater:
                        ui_manager.ui_updater.register_element('sentiment_display', ui_manager.sentiment_chart)
            
            # Real-time metrics
            ui.separator().classes('my-4')
            with ui.card().classes('w-full p-4 bg-gray-800'):
                ui.label('📈 Real-time Metrics').classes('text-lg font-bold mb-4')
                
                with ui.grid(columns=4).classes('w-full gap-4'):
                    # Message rate
                    with ui.card().classes('p-3 text-center'):
                        ui.icon('speed').classes('text-2xl text-blue-400')
                        ui.label('Message Rate').classes('text-sm text-gray-400')
                        msg_rate = ui.label('0 msg/min').classes('font-bold')
                        if ui_manager.ui_updater:
                            ui_manager.ui_updater.register_element('message_rate', msg_rate)
                    
                    # Active agents
                    with ui.card().classes('p-3 text-center'):
                        ui.icon('group').classes('text-2xl text-green-400')
                        ui.label('Active Agents').classes('text-sm text-gray-400')
                        active_agents = ui.label('0 / 5').classes('font-bold')
                        if ui_manager.ui_updater:
                            ui_manager.ui_updater.register_element('active_agents', active_agents)
                    
                    # Conversation health
                    with ui.card().classes('p-3 text-center'):
                        ui.icon('favorite').classes('text-2xl text-red-400')
                        ui.label('Health Score').classes('text-sm text-gray-400')
                        health_score = ui.label('100%').classes('font-bold')
                        if ui_manager.ui_updater:
                            ui_manager.ui_updater.register_element('health_score', health_score)
                    
                    # System uptime
                    with ui.card().classes('p-3 text-center'):
                        ui.icon('timer').classes('text-2xl text-purple-400')
                        ui.label('Uptime').classes('text-sm text-gray-400')
                        uptime = ui.label('00:00:00').classes('font-bold')
                        if ui_manager.ui_updater:
                            ui_manager.ui_updater.register_element('uptime', uptime)
        
        # Settings & Export
        with ui.expansion('⚙️ Settings & Export', icon='settings').classes('w-full'):
            with ui.row().classes('w-full gap-4'):
                # Export options
                with ui.card().classes('flex-1 p-4'):
                    ui.label('Export Session').classes('text-lg font-bold mb-4')
                    
                    export_format = ui.select(
                        options=['json', 'html', 'markdown'],
                        value='json',
                        label='Format'
                    ).classes('mb-4')
                    
                    def export_session():
                        data = ui_manager.simulation.export_session(export_format.value)
                        ui.notify(f'Session exported as {export_format.value}', type='positive')
                        logger.info(f"Exported data preview: {data[:200]}...")
                    
                    ui.button('💾 Export', on_click=export_session).classes('bg-purple-600 text-white')

                # Stimulus injection
                with ui.card().classes('flex-1 p-4'):
                    ui.label('⚡ Stimulus Injection').classes('text-lg font-bold mb-4')
                    
                    stimulus_options = ['random', 'memory', 'conflict', 'revelation', 
                                       'challenge', 'integration', 'shadow', 'creative']
                    
                    stimulus_select = ui.select(
                        options=stimulus_options,
                        value='random',
                        label='Stimulus Type'
                    ).classes('mb-4')
                    
                    ui.button(
                        'Inject Stimulus', 
                        on_click=lambda: ui_manager.simulation.inject_stimulus(stimulus_select.value)
                    ).classes('bg-orange-600 text-white')
    
    logger.info("Streaming content created successfully")