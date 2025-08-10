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

class UIManager:
    def __init__(self, simulation: PsycheSimulation, session_manager: Optional[SessionManager] = None,
                 session_id: Optional[str] = None, user_profile: Optional[UserProfile] = None):
        self.simulation = simulation
        self.session_manager = session_manager
        self.session_id = session_id
        self.user_profile = user_profile
        self.jwt_token = None
        self.status_label = None
        self.iteration_label = None
        self.conversation_container = None
        self.network_chart = None
        self.sentiment_chart = None
        self.health_indicators = {}
        self.agent_state_panels = {}
        self.intervention_display = None
        self.emergency_indicators = {}
        
        # WebSocket components for real-time updates
        self.broadcaster = None
        self.ui_updater = None

    async def run_autonomous_loop(self, iterations: int):
        """Run the autonomous thinking loop with UI updates"""
        self.simulation.is_running = True
        
        # Broadcast system start event
        if self.broadcaster:
            await self.broadcaster.broadcast_system_event('system_status', {
                'is_running': True,
                'status': 'RUNNING',
                'performance_data': {
                    'cpu_percent': 0,
                    'memory_percent': 0,
                    'thread_count': 1
                }
            })
        
        for i in range(iterations):
            if not self.simulation.is_running:
                break
                
            self.simulation.session_data['iterations'] = i + 1
            
            if self.status_label:
                self.status_label.text = f"Running iteration {i+1}/{iterations}"
            if self.iteration_label:
                self.iteration_label.text = f"Iteration: {i+1}"
            
            # Show processing indicator
            if self.ui_updater and 'processing_indicator' in self.ui_updater.ui_elements:
                self.ui_updater.ui_elements['processing_indicator'].style('display: flex')
            
            outputs = await self.simulation.run_iteration(self.simulation.current_situation)
            
            # Hide processing indicator
            if self.ui_updater and 'processing_indicator' in self.ui_updater.ui_elements:
                self.ui_updater.ui_elements['processing_indicator'].style('display: none')
            
            self.simulation.conversation_history.append({
                'iteration': i + 1,
                'timestamp': datetime.now(),
                'situation': self.simulation.current_situation,
                'outputs': outputs
            })
            
            # Broadcast agent messages
            if self.broadcaster:
                for agent_name, response in outputs.items():
                    sentiment = get_emotional_tone(response)
                    await self.broadcaster.broadcast_agent_message(
                        agent_id=agent_name,
                        message=response,
                        metadata={
                            'agent_type': agent_name,
                            'iteration': i + 1,
                            'sentiment': {
                                'label': sentiment['category'],
                                'score': sentiment['polarity']
                            }
                        }
                    )
            
            await self._update_conversation_display(outputs)
            await self._update_visualizations()
            
            state = self.simulation.prompt_manager.analyze_conversation_state(outputs)
            self.simulation.current_conversation_state = state
            
            self.simulation.network.update_conversation_state(state)
            
            # Broadcast network update
            if self.broadcaster:
                connections = []
                matrix = self.simulation.network.get_communication_matrix()
                for from_agent, targets in matrix.items():
                    for to_agent, strength in targets.items():
                        if strength > 0:
                            connections.append({
                                'from': from_agent,
                                'to': to_agent,
                                'strength': strength
                            })
                
                await self.broadcaster.broadcast_network_update(
                    connections=connections,
                    metrics={
                        'health': 1.0 - state.get('stagnation', 0),
                        'diversity': state.get('diversity', 1.0),
                        'engagement': state.get('engagement', 1.0)
                    }
                )
            
            # Broadcast health updates
            if self.ui_updater:
                self.ui_updater.handle_health_update(
                    type('Event', (), {'data': state})()
                )
            
            await self._update_health_indicators(state)
            await self._update_agent_state_panels(outputs, state)
            await self._update_emergency_indicators()
            
            # Check for emergency status
            if self.broadcaster and state.get('stagnation', 0) > 0.7:
                await self.ui_updater.handle_emergency_status(
                    type('Event', (), {'data': {'emergency_mode': True}})()
                )
            
            intervention = self.simulation.prompt_manager.suggest_intervention(state)
            if intervention:
                await self._display_intervention(intervention, state)
                ui.notify(f"Suggestion: {intervention}", type='info')
            
            self.simulation.current_situation = self.simulation._evolve_situation(outputs, state)
            
            await asyncio.sleep(5)
        
        self.simulation.is_running = False
        if self.status_label:
            self.status_label.text = "Simulation complete"
        
        # Broadcast system stop event
        if self.broadcaster:
            await self.broadcaster.broadcast_system_event('system_status', {
                'is_running': False,
                'status': 'STOPPED'
            })
        
        ui.notify("Autonomous loop completed", type='positive')

    async def _update_conversation_display(self, outputs: Dict[str, str]):
        """Update the conversation display with new outputs"""
        if not self.conversation_container:
            return
            
        # Register the container with the UI updater if available
        if self.ui_updater and 'conversation_display' not in self.ui_updater.ui_elements:
            self.ui_updater.register_element('conversation_display', self.conversation_container)
        
        # Keep manual update as fallback for non-WebSocket scenarios
        with self.conversation_container:
            with ui.card().classes('w-full mb-4'):
                ui.label(f"Iteration {self.simulation.session_data['iterations']}").classes('text-lg font-bold')
                ui.label(f"Situation: {self.simulation.current_situation}").classes('text-sm text-gray-600 mb-2')
                
                for agent_name, response in outputs.items():
                    sentiment = get_emotional_tone(response)
                    
                    agent_colors = {
                        'Shadow': 'bg-gray-800 text-white',
                        'Persona': 'bg-blue-600 text-white',
                        'Anima/Animus': 'bg-purple-600 text-white',
                        'Self': 'bg-orange-600 text-white',
                        'Ego': 'bg-green-600 text-white'
                    }
                    
                    with ui.card().classes(f'w-full mb-2 {agent_colors.get(agent_name, "")}'):
                        with ui.row().classes('items-center justify-between'):
                            ui.label(agent_name).classes('font-bold')
                            ui.label(f"Sentiment: {sentiment['category']}").classes('text-sm')
                        ui.label(response).classes('mt-2')

    async def _update_visualizations(self):
        """Update network and sentiment visualizations"""
        if self.network_chart:
            await self._update_network_chart()
        
        if self.sentiment_chart:
            await self._update_sentiment_chart()

    async def _update_network_chart(self):
        """Update the network visualization chart"""
        matrix = self.simulation.network.get_communication_matrix()
        
        fig = go.Figure()
        
        node_x = [0, -1, 1, -1, 1]
        node_y = [0, -1, -1, 1, 1]
        node_names = list(self.simulation.agents.keys())
        
        for i, from_agent in enumerate(node_names):
            for j, to_agent in enumerate(node_names):
                if i != j and matrix[from_agent][to_agent] > 0:
                    strength = matrix[from_agent][to_agent]
                    fig.add_trace(go.Scatter(
                        x=[node_x[i], node_x[j]],
                        y=[node_y[i], node_y[j]],
                        mode='lines',
                        line=dict(width=strength*3, color='rgba(125,125,125,0.5)'),
                        showlegend=False
                    ))
        
        fig.add_trace(go.Scatter(
            x=node_x,
            y=node_y,
            mode='markers+text',
            text=node_names,
            textposition="top center",
            marker=dict(size=30, color=['gray', 'blue', 'purple', 'orange', 'green']),
            showlegend=False
        ))
        
        fig.update_layout(
            showlegend=False,
            hovermode='closest',
            margin=dict(b=0,l=0,r=0,t=0),
            xaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
            yaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
            height=400
        )
        
        self.network_chart.figure = fig
        self.network_chart.update()

    async def _update_sentiment_chart(self):
        """Update the sentiment visualization chart"""
        sentiment_data = []
        
        for entry in list(self.simulation.conversation_history)[-10:]:
            iteration = entry['iteration']
            for agent_name, output in entry['outputs'].items():
                sentiment = get_emotional_tone(output)
                sentiment_data.append({
                    'iteration': iteration,
                    'agent': agent_name,
                    'polarity': sentiment['polarity'],
                    'subjectivity': sentiment['subjectivity']
                })
        
        if not sentiment_data:
            return
        
        df = pd.DataFrame(sentiment_data)
        
        fig = go.Figure()
        
        for agent in self.simulation.agents.keys():
            agent_data = df[df['agent'] == agent]
            if not agent_data.empty:
                fig.add_trace(go.Scatter(
                    x=agent_data['iteration'],
                    y=agent_data['polarity'],
                    mode='lines+markers',
                    name=agent,
                    line=dict(width=2)
                ))
        
        fig.update_layout(
            title="Sentiment Over Time",
            xaxis_title="Iteration",
            yaxis_title="Sentiment Polarity",
            yaxis=dict(range=[-1, 1]),
            height=400
        )
        
        self.sentiment_chart.figure = fig
        self.sentiment_chart.update()

    async def _update_health_indicators(self, state: Dict[str, float]):
        """Update real-time health indicators"""
        if not self.health_indicators:
            return
            
        for metric, value in state.items():
            if metric in self.health_indicators:
                if metric in ['stagnation', 'repetition']:
                    color = 'red' if value > 0.7 else 'yellow' if value > 0.4 else 'green'
                elif metric in ['engagement', 'diversity']:
                    color = 'red' if value < 0.3 else 'yellow' if value < 0.6 else 'green'
                else:
                    color = 'red' if value > 0.8 or value < 0.2 else 'yellow' if value > 0.6 or value < 0.4 else 'green'
                
                indicator = self.health_indicators[metric]
                indicator['progress'].set_value(value)
                indicator['label'].set_text(f'{value:.3f}')
                indicator['progress'].classes(f'bg-{color}-500', remove='bg-red-500 bg-yellow-500 bg-green-500')

    async def _update_agent_state_panels(self, outputs: Dict[str, str], state: Dict[str, float]):
        """Update detailed agent state information"""
        for agent_name, agent in self.simulation.agents.items():
            if agent_name in self.agent_state_panels:
                panel = self.agent_state_panels[agent_name]
                
                if agent_name in outputs:
                    sentiment = get_emotional_tone(outputs[agent_name])
                    panel['sentiment'].set_text(f"Sentiment: {sentiment['category']} ({sentiment['polarity']:.2f})")
                
                if hasattr(agent, 'interaction_count'):
                    panel['interactions'].set_text(f"Interactions: {agent.interaction_count}")
                
                adaptation_history = self.simulation.prompt_manager.get_adaptation_history(agent_name)
                if adaptation_history:
                    panel['adapted'].set_text("🔄 Prompt Adapted")
                    panel['adapted'].classes('text-orange-400')
                else:
                    panel['adapted'].set_text("✓ Normal")
                    panel['adapted'].classes('text-green-400')

    async def _display_intervention(self, intervention: str, state: Dict[str, float]):
        """Display intervention notification with context"""
        if self.intervention_display:
            self.intervention_display.clear()
            with self.intervention_display:
                with ui.card().classes('w-full bg-orange-800 text-white p-4'):
                    ui.label('🚨 Intervention Suggested').classes('text-lg font-bold')
                    ui.label(intervention).classes('mt-2')
                    
                    problems = []
                    if state.get('stagnation', 0) > 0.7:
                        problems.append(f"High Stagnation: {state['stagnation']:.2f}")
                    if state.get('repetition', 0) > 0.6:
                        problems.append(f"High Repetition: {state['repetition']:.2f}")
                    if state.get('engagement', 1) < 0.3:
                        problems.append(f"Low Engagement: {state['engagement']:.2f}")
                    
                    if problems:
                        ui.label('Issues detected:').classes('mt-2 font-semibold')
                        for problem in problems:
                            ui.label(f"• {problem}").classes('text-sm')

    async def _update_emergency_indicators(self):
        """Update emergency communication status indicators"""
        if not self.emergency_indicators:
            return
        
        emergency_status = self.simulation.network.get_emergency_status()
        
        if emergency_status['emergency_mode']:
            self.emergency_indicators['status'].set_text('Status: 🚨 Emergency Communication Active')
            self.emergency_indicators['status'].classes('text-red-400', remove='text-green-400 text-yellow-400')
            
            if emergency_status['activated_at']:
                duration = time.time() - emergency_status['activated_at']
                minutes = int(duration // 60)
                seconds = int(duration % 60)
                self.emergency_indicators['duration'].set_text(f'Duration: {minutes}m {seconds}s')
        else:
            self.emergency_indicators['status'].set_text('Status: ✅ Normal Communication')
            self.emergency_indicators['status'].classes('text-green-400', remove='text-red-400 text-yellow-400')
            self.emergency_indicators['duration'].set_text('Duration: -')
        
        stagnation_history = emergency_status['stagnation_history']
        if len(stagnation_history) >= 2:
            current = stagnation_history[-1]
            previous = stagnation_history[-2]
            
            if current > previous:
                trend = f'Stagnation Trend: ⬆️ Rising ({current:.2f})'
                color = 'text-red-400'
            elif current < previous:
                trend = f'Stagnation Trend: ⬇️ Falling ({current:.2f})'
                color = 'text-green-400'
            else:
                trend = f'Stagnation Trend: ➡️ Stable ({current:.2f})'
                color = 'text-yellow-400'
            
            self.emergency_indicators['trend'].set_text(trend)
            self.emergency_indicators['trend'].classes(color, remove='text-red-400 text-green-400 text-yellow-400')