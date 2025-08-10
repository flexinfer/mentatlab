import asyncio
import logging
import time
from datetime import datetime
from typing import Dict, List, Optional, Any

import pandas as pd
import plotly.graph_objects as go
from nicegui import ui, app, Client

from simulation.core import PsycheSimulation
from analysis.sentiment import get_emotional_tone
from data.redis_state_manager import RedisStateManager
from auth.user_manager import UserManager, UserProfile
from auth.session_handler import SessionManager, SessionHandler
from ui.auth_components import AuthState, create_login_page, create_registration_page
from utils.websocket_broadcaster import WebSocketBroadcaster, RealtimeUIUpdater
from utils.websocket_events import EventType

logger = logging.getLogger(__name__)

from ui.components import UIManager

def create_ui():
    """Create the main UI interface with authentication"""
    
    # Initialize Redis and authentication components
    redis_manager = RedisStateManager()
    user_manager = UserManager(redis_manager)
    session_manager = SessionManager(redis_manager, user_manager)
    
    # Global auth state
    auth_state = AuthState()
    
    # Initialize WebSocket broadcaster
    broadcaster = WebSocketBroadcaster()
    ui_updater = RealtimeUIUpdater(broadcaster)
    
    ui.dark_mode().enable()
    
    # Add debug logging
    logger.info("=== create_ui: Starting UI creation ===")
    
    # Create header at page level (initially hidden)
    header_element = ui.header().classes('bg-gray-900')
    header_element.style('display: none')
    
    # Create a main container that can be cleared between UI states
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
        """Show the main simulation interface after authentication"""
        logger.info("=== show_main_interface: Called ===")
        logger.info(f"Current UI context: {ui.context}")
        logger.info(f"UI context client: {getattr(ui.context, 'client', 'No client')}")
        logger.info(f"UI context stack depth: {len(getattr(ui.context, 'stack', []))}")
        
        if not auth_state.is_authenticated:
            logger.info("Not authenticated, showing login interface")
            show_login_interface()
            return
            
        logger.info("Authenticated, creating UI manager")
        ui_manager = create_authenticated_ui(
            auth_state.user_profile,
            auth_state.session_id,
            auth_state.jwt_token
        )
        
        # Clear the main container before creating the simulation interface
        logger.info("Clearing main container")
        main_container.clear()
        
        # Show the header
        logger.info("Showing header")
        header_element.style('display: block')
        
        # Create the simulation interface content (without header)
        logger.info("About to create simulation content")
        with main_container:
            create_simulation_content(ui_manager, auth_state, session_manager)
        
        # Populate the header (outside container context)
        logger.info("Populating header")
        populate_header(header_element, ui_manager, logout)
    
    def show_login_interface():
        """Show the login interface"""
        logger.info("=== show_login_interface: Called ===")
        logger.info(f"Current UI context before login UI: {ui.context}")
        
        # Clear the main container first
        main_container.clear()
        
        def on_login_success(user_profile: UserProfile, session_id: str, jwt_token: str):
            logger.info("=== on_login_success callback triggered ===")
            logger.info(f"UI context in callback: {ui.context}")
            logger.info(f"UI context stack in callback: {getattr(ui.context, 'stack', [])}")
            auth_state.login(user_profile, session_id, jwt_token)
            logger.info("About to call show_main_interface from login callback")
            
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
        # Clear the main container first
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


def populate_header(header_element, ui_manager: UIManager, logout_func):
    """Populate the header with navigation and user info"""
    logger.info("=== populate_header: Starting ===")
    
    # Clear existing header content
    header_element.clear()
    
    # Add header content
    with header_element:
        ui.label('🧠 Psyche Simulation').classes('text-2xl font-bold')
        with ui.row().classes('gap-4 ml-auto'):
            # User info display
            if hasattr(ui_manager, 'user_profile'):
                ui.label(f'👤 {ui_manager.user_profile.display_name}').classes('text-blue-400')
                ui.label(f'({ui_manager.user_profile.role.value})').classes('text-sm text-gray-400')
            ui_manager.status_label = ui.label('Ready').classes('text-green-400')
            ui_manager.iteration_label = ui.label('Iteration: 0')
            # Logout button
            ui.button('🚪 Logout', on_click=logout_func).classes('bg-red-600 text-white')
    
    logger.info("Header populated successfully")


def create_simulation_content(ui_manager: UIManager, auth_state, session_manager):
    """Create the main simulation interface content (without header)"""
    logger.info("=== create_simulation_content: Starting ===")
    
    # Add CSS for animations and JavaScript for handling WebSocket events
    ui.add_head_html('''
    <style>
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    
    @keyframes pulse {
        0%, 100% {
            opacity: 1;
        }
        50% {
            opacity: 0.5;
        }
    }
    
    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }
    
    .agent-message-card {
        animation: fadeInUp 0.5s ease-out;
    }
    
    .animate-pulse {
        animation: pulse 2s ease-in-out infinite;
    }
    
    .animate-spin {
        animation: spin 1s linear infinite;
    }
    
    .notification-flash {
        position: fixed;
        top: 70px;
        right: 20px;
        z-index: 1000;
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
    
    .conversation-container {
        scroll-behavior: smooth;
    }
    </style>
    
    <script>
    // Global WebSocket event handler
    window.websocketEventHandler = function(eventData) {
        console.log('WebSocket Event:', eventData);
        
        // Trigger visual updates based on event type
        switch(eventData.type) {
            case 'agent_message':
                console.log('Agent message:', eventData.data);
                // Show message notification
                showMessageNotification(eventData.data);
                break;
            case 'network_update':
                console.log('Network update:', eventData.data);
                // Pulse network indicator
                pulseNetworkIndicator();
                break;
            case 'system_status':
                console.log('System status:', eventData.data);
                // Update system status
                updateSystemStatus(eventData.data);
                break;
        }
    };
    
    // Show message notification
    function showMessageNotification(data) {
        const notification = document.createElement('div');
        notification.className = 'notification-flash bg-blue-600 text-white p-3 rounded-lg shadow-lg';
        notification.innerHTML = `<div class="flex items-center"><i class="material-icons mr-2">message</i>New message from ${data.agent_id}</div>`;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    // Pulse network indicator
    function pulseNetworkIndicator() {
        const indicators = document.querySelectorAll('.network-activity-indicator');
        indicators.forEach(ind => {
            ind.classList.add('animate-pulse');
            setTimeout(() => ind.classList.remove('animate-pulse'), 1000);
        });
    }
    
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
        const eventData = e.detail;
        window.websocketEventHandler(eventData);
    });
    </script>
    ''')
    
    with ui.tabs().classes('w-full') as tabs:
        conversation_tab = ui.tab('💬 Conversation')
        health_tab = ui.tab('🏥 Health Monitor')
        visualization_tab = ui.tab('📊 Visualizations')
        analysis_tab = ui.tab('🔍 Analysis')
        settings_tab = ui.tab('⚙️ Settings')
    
    with ui.tab_panels(tabs, value=conversation_tab).classes('w-full'):
        with ui.tab_panel(conversation_tab):
            with ui.row().classes('w-full gap-4 mb-4'):
                situation_input = ui.input(
                    'Situation',
                    value=ui_manager.simulation.current_situation
                ).classes('flex-grow').props('outlined')
                
                iterations_input = ui.number(
                    'Iterations',
                    value=5,
                    min=1,
                    max=20
                ).classes('w-32')
                
                async def start_simulation():
                    ui_manager.simulation.current_situation = situation_input.value
                    await ui_manager.run_autonomous_loop(int(iterations_input.value))
                
                # Add loading spinner for start button
                start_btn = ui.button('▶️ Start', on_click=start_simulation).classes('bg-green-600')
                stop_btn = ui.button('⏹️ Stop', on_click=ui_manager.simulation.stop_simulation).classes('bg-red-600')
                ui.button('🔄 Reset', on_click=ui_manager.simulation.reset_conversation_dynamics).classes('bg-purple-600')
                ui.button('⚡ Inject Stimulus', on_click=lambda: ui_manager.simulation.inject_stimulus()).classes('bg-orange-600')
            
            # Add real-time status bar
            with ui.row().classes('w-full gap-4 mb-4 items-center'):
                # Status indicator with animated dot
                with ui.row().classes('items-center'):
                    ui.html('<span class="status-indicator-dot inactive"></span>')
                    status_label = ui.label('System: IDLE').classes('font-semibold')
                    if ui_manager.ui_updater:
                        ui_manager.ui_updater.register_element('main_status', status_label)
                
                # Message counter with animation
                message_counter = ui.label('Messages: 0').classes('text-blue-400 font-semibold')
                if ui_manager.ui_updater:
                    ui_manager.ui_updater.register_element('message_counter', message_counter)
                
                # Network activity indicator
                with ui.row().classes('items-center gap-2'):
                    ui.icon('network_check').classes('text-green-400 network-activity-indicator')
                    network_status = ui.label('Network: Active').classes('text-green-400')
                    if ui_manager.ui_updater:
                        ui_manager.ui_updater.register_element('network_status', network_status)
                
                # Processing indicator (initially hidden)
                with ui.row().classes('items-center gap-2').style('display: none') as processing_indicator:
                    ui.spinner(size='sm')
                    ui.label('Processing...').classes('text-yellow-400')
                if ui_manager.ui_updater:
                    ui_manager.ui_updater.register_element('processing_indicator', processing_indicator)
            
            # Notification area for flash messages
            notification_area = ui.column().classes('fixed top-20 right-4 z-50')
            if ui_manager.ui_updater:
                ui_manager.ui_updater.register_element('notification_area', notification_area)
            
            ui_manager.intervention_display = ui.column().classes('w-full mb-4')
            
            # Enhanced conversation display with better styling
            with ui.card().classes('w-full bg-gray-800'):
                ui.label('💬 Live Conversation Feed').classes('text-lg font-bold mb-4')
                with ui.scroll_area().classes('w-full h-96 p-4 conversation-container'):
                    ui_manager.conversation_container = ui.column().classes('w-full')
                    
                    # Add initial welcome message
                    with ui.card().classes('w-full mb-4 bg-gray-700 text-gray-300'):
                        ui.label('🤖 System').classes('font-bold mb-2')
                        ui.label('Welcome to Psyche Simulation. Click "Start" to begin the autonomous conversation.').classes('text-sm')
                    
                    # Register conversation container for real-time updates
                    if ui_manager.ui_updater:
                        ui_manager.ui_updater.register_element('conversation_display', ui_manager.conversation_container)
        
        with ui.tab_panel(health_tab):
            with ui.card().classes('w-full p-4 mb-4'):
                ui.label('🏥 Conversation Health Indicators').classes('text-xl font-bold mb-4')
                
                with ui.grid(columns=3).classes('w-full gap-4'):
                    health_metrics = ['stagnation', 'engagement', 'diversity', 'repetition', 'conflict', 'emotional_intensity']
                    
                    for metric in health_metrics:
                        with ui.card().classes('p-4'):
                            ui.label(metric.replace('_', ' ').title()).classes('font-semibold mb-2')
                            progress = ui.linear_progress(value=0, show_value=False).classes('mb-2')
                            label = ui.label('0.000').classes('text-sm text-center')
                            
                            ui_manager.health_indicators[metric] = {
                                'progress': progress,
                                'label': label
                            }
            
            with ui.card().classes('w-full p-4'):
                ui.label('🤖 Agent States').classes('text-xl font-bold mb-4')
                
                with ui.grid(columns=2).classes('w-full gap-4'):
                    for agent_name in ui_manager.simulation.agents.keys():
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
            
            with ui.card().classes('w-full p-4 mt-4'):
                ui.label('🚨 Emergency Communication Status').classes('text-lg font-bold mb-4')
                
                emergency_status_label = ui.label('Status: Normal Communication').classes('text-green-400 mb-2')
                emergency_duration_label = ui.label('Duration: -').classes('text-sm mb-2')
                stagnation_trend_label = ui.label('Stagnation Trend: -').classes('text-sm')
                
                ui_manager.emergency_indicators = {
                    'status': emergency_status_label,
                    'duration': emergency_duration_label,
                    'trend': stagnation_trend_label
                }
                
                # Register emergency indicators for real-time updates
                if ui_manager.ui_updater:
                    ui_manager.ui_updater.register_element('emergency_status', emergency_status_label)
            
            with ui.card().classes('w-full p-4 mt-4'):
                ui.label('⚡ Stimulus Injection').classes('text-lg font-bold mb-4')
                
                stimulus_options = ['random', 'memory', 'conflict', 'revelation', 'challenge', 'integration', 'shadow', 'creative']
                
                with ui.row().classes('gap-2'):
                    stimulus_select = ui.select(
                        options=stimulus_options,
                        value='random',
                        label='Stimulus Type'
                    ).classes('flex-grow')
                    
                    ui.button('Inject', on_click=lambda: ui_manager.simulation.inject_stimulus(stimulus_select.value)).classes('bg-orange-600')
        
        with ui.tab_panel(visualization_tab):
            with ui.row().classes('w-full gap-4'):
                with ui.card().classes('flex-1 relative'):
                    # Network visualization header with live indicator
                    with ui.row().classes('items-center justify-between mb-2'):
                        ui.label('🌐 Agent Network').classes('text-lg font-bold')
                        with ui.row().classes('items-center gap-2'):
                            ui.html('<span class="status-indicator-dot active"></span>')
                            ui.label('LIVE').classes('text-xs text-green-400 font-semibold')
                    
                    ui_manager.network_chart = ui.plotly({}).classes('w-full')
                    
                    # Add network statistics below the chart
                    with ui.row().classes('mt-4 gap-4 text-sm'):
                        connections_label = ui.label('Connections: 0')
                        avg_strength_label = ui.label('Avg Strength: 0.00')
                        if ui_manager.ui_updater:
                            ui_manager.ui_updater.register_element('connections_count', connections_label)
                            ui_manager.ui_updater.register_element('avg_strength', avg_strength_label)
                    
                    # Register network chart for real-time updates
                    if ui_manager.ui_updater:
                        ui_manager.ui_updater.register_element('network_chart', ui_manager.network_chart)
                
                with ui.card().classes('flex-1 relative'):
                    # Sentiment visualization header with live indicator
                    with ui.row().classes('items-center justify-between mb-2'):
                        ui.label('📊 Sentiment Analysis').classes('text-lg font-bold')
                        with ui.row().classes('items-center gap-2'):
                            ui.html('<span class="status-indicator-dot active"></span>')
                            ui.label('LIVE').classes('text-xs text-green-400 font-semibold')
                    
                    ui_manager.sentiment_chart = ui.plotly({}).classes('w-full')
                    
                    # Add sentiment summary below the chart
                    with ui.row().classes('mt-4 gap-4 text-sm'):
                        overall_sentiment = ui.label('Overall: Neutral')
                        sentiment_trend = ui.label('Trend: ➡️ Stable')
                        if ui_manager.ui_updater:
                            ui_manager.ui_updater.register_element('overall_sentiment', overall_sentiment)
                            ui_manager.ui_updater.register_element('sentiment_trend', sentiment_trend)
                    
                    # Register sentiment display for real-time updates
                    if ui_manager.ui_updater:
                        ui_manager.ui_updater.register_element('sentiment_display', ui_manager.sentiment_chart)
            
            # Add additional real-time metrics card
            with ui.card().classes('w-full mt-4 p-4'):
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
        
        with ui.tab_panel(analysis_tab):
            with ui.card().classes('w-full p-4'):
                ui.label('Psychological State Analysis').classes('text-xl font-bold mb-4')
                
                analysis_container = ui.column().classes('w-full')
                
                async def analyze_session():
                    if not ui_manager.simulation.conversation_history:
                        ui.notify('No conversation data to analyze', type='warning')
                        return
                    
                    outputs_history = [entry.get('outputs', {}) for entry in ui_manager.simulation.conversation_history if 'outputs' in entry]
                    
                    if outputs_history:
                        recent_outputs = outputs_history[-5:]
                        for outputs in recent_outputs:
                            ui_manager.simulation.prompt_manager.analyze_conversation_state(outputs)
                        
                        state = ui_manager.simulation.prompt_manager.analyze_conversation_state({})
                    else:
                        state = ui_manager.simulation.prompt_manager.analyze_conversation_state({})
                    
                    analysis_container.clear()
                    with analysis_container:
                        for metric, value in state.items():
                            with ui.row().classes('items-center mb-2'):
                                ui.label(f'{metric.replace("_", " ").title()}:').classes('font-semibold w-48')
                                ui.linear_progress(value=value, show_value=False).classes('flex-grow')
                                ui.label(f'{value:.2f}').classes('w-16 text-right')
                
                ui.button('🔍 Analyze Session', on_click=analyze_session).classes('bg-blue-600')
        
        with ui.tab_panel(settings_tab):
            with ui.card().classes('w-full p-4'):
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
                
                ui.button('💾 Export', on_click=export_session).classes('bg-purple-600')
                
                ui.separator().classes('my-4')
                
                ui.label('Agent Settings').classes('text-lg font-bold mb-4')
                
                for agent_name in ui_manager.simulation.agents.keys():
                    with ui.row().classes('items-center mb-2'):
                        ui.label(f'{agent_name} Temperature:').classes('w-48')
                        ui.slider(min=0, max=2, value=0.7, step=0.1).classes('flex-grow')
                
                # Add WebSocket status indicator
                ui.separator().classes('my-4')
                ui.label('Real-time Status').classes('text-lg font-bold mb-4')
                
                with ui.row().classes('items-center gap-4'):
                    # Enhanced status indicator with icon
                    with ui.row().classes('items-center gap-2'):
                        ui.icon('circle').classes('text-xs status-indicator animate-pulse text-gray-500')
                        status_indicator = ui.label('System: INITIALIZING').classes('text-gray-500')
                    
                    # Enhanced network metrics with icon
                    with ui.row().classes('items-center gap-2'):
                        ui.icon('analytics').classes('text-blue-400')
                        network_metrics = ui.label('Messages: 0 | Health: 1.00').classes('network-metrics')
                    
                    # Enhanced resource display with icon
                    with ui.row().classes('items-center gap-2'):
                        ui.icon('memory').classes('text-green-400')
                        resource_display = ui.label('CPU: 0.0% | Memory: 0.0% | Threads: 0')
                    
                    # Register status elements for real-time updates
                    if ui_manager.ui_updater:
                        ui_manager.ui_updater.register_element('status_indicator', status_indicator)
                        ui_manager.ui_updater.register_element('network_metrics', network_metrics)
                        ui_manager.ui_updater.register_element('resource_display', resource_display)