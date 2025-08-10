"""
WebSocket Event System Demo

This demo showcases the WebSocket event system with a NiceGUI interface.
It demonstrates real-time agent messages, network updates, and system monitoring.
"""

import asyncio
import random
import time
from datetime import datetime
from typing import Dict, List, Optional

from nicegui import ui
from nicegui.events import ValueChangeEventArguments

from utils.websocket_events import (
    broadcast_agent_message,
    broadcast_network_update, 
    broadcast_system_status,
    SystemHealthStatus,
    WebSocketEventManager
)
from utils.websocket_broadcaster import WebSocketBroadcaster
from utils.performance_monitor import PerformanceMonitor


class WebSocketDemo:
    """Demo application for WebSocket event system"""
    
    def __init__(self):
        self.agents = {
            'agent_1': {'name': 'Cognitive Psychologist', 'color': '#4CAF50'},
            'agent_2': {'name': 'Neuroscientist', 'color': '#2196F3'},
            'agent_3': {'name': 'Consciousness Philosopher', 'color': '#FF9800'},
            'agent_4': {'name': 'AI Researcher', 'color': '#9C27B0'},
            'agent_5': {'name': 'Moderator', 'color': '#F44336'}
        }
        
        self.running = False
        self.message_count = 0
        self.error_count = 0
        self.performance_monitor = PerformanceMonitor()
        
        # UI elements
        self.message_container = None
        self.network_chart = None
        self.status_cards = None
        self.control_panel = None
        
    def create_ui(self):
        """Create the demo UI"""
        ui.dark_mode().enable()
        
        with ui.header(elevated=True).classes('items-center justify-between'):
            ui.label('WebSocket Event System Demo').classes('text-h4')
            ui.badge('Real-time', color='green').props('floating')
        
        with ui.tabs().classes('w-full') as tabs:
            self.tab_messages = ui.tab('Messages')
            self.tab_network = ui.tab('Network')
            self.tab_status = ui.tab('System Status')
            self.tab_controls = ui.tab('Controls')
        
        with ui.tab_panels(tabs, value=self.tab_messages).classes('w-full'):
            # Messages Tab
            with ui.tab_panel(self.tab_messages):
                ui.label('Agent Messages').classes('text-h5 mb-4')
                with ui.scroll_area().classes('h-96 w-full border rounded'):
                    self.message_container = ui.column().classes('p-4')
            
            # Network Tab
            with ui.tab_panel(self.tab_network):
                ui.label('Network Visualization').classes('text-h5 mb-4')
                with ui.card().classes('w-full h-96'):
                    self.network_chart = ui.element('div').classes('w-full h-full')
                    self._create_network_visualization()
            
            # System Status Tab
            with ui.tab_panel(self.tab_status):
                ui.label('System Metrics').classes('text-h5 mb-4')
                self.status_cards = ui.row().classes('w-full gap-4')
                self._create_status_cards()
            
            # Controls Tab
            with ui.tab_panel(self.tab_controls):
                ui.label('Demo Controls').classes('text-h5 mb-4')
                self._create_control_panel()
    
    def _create_network_visualization(self):
        """Create network visualization using ECharts"""
        self.network_chart.classes('w-full h-full')
        
        nodes = [
            {'id': agent_id, 'name': info['name'], 'symbolSize': 50, 
             'itemStyle': {'color': info['color']}}
            for agent_id, info in self.agents.items()
        ]
        
        links = [
            {'source': 'agent_1', 'target': 'agent_2'},
            {'source': 'agent_2', 'target': 'agent_3'},
            {'source': 'agent_3', 'target': 'agent_4'},
            {'source': 'agent_4', 'target': 'agent_5'},
            {'source': 'agent_5', 'target': 'agent_1'},
            {'source': 'agent_1', 'target': 'agent_3'},
            {'source': 'agent_2', 'target': 'agent_4'},
        ]
        
        chart_option = {
            'series': [{
                'type': 'graph',
                'layout': 'force',
                'data': nodes,
                'links': links,
                'roam': True,
                'label': {
                    'show': True,
                    'position': 'bottom',
                    'formatter': '{b}'
                },
                'force': {
                    'repulsion': 1000,
                    'edgeLength': 150
                },
                'lineStyle': {
                    'width': 2,
                    'curveness': 0.1
                }
            }]
        }
        
        ui.echart(chart_option).classes('w-full h-full').bind_to(self.network_chart)
    
    def _create_status_cards(self):
        """Create status metric cards"""
        with self.status_cards:
            # Health Status Card
            with ui.card().classes('flex-1'):
                ui.label('Health Status').classes('text-h6')
                self.health_badge = ui.badge('Healthy', color='green').classes('mt-2')
            
            # Performance Card
            with ui.card().classes('flex-1'):
                ui.label('Performance').classes('text-h6')
                self.cpu_label = ui.label('CPU: 0%')
                self.memory_label = ui.label('Memory: 0%')
            
            # Activity Card
            with ui.card().classes('flex-1'):
                ui.label('Activity').classes('text-h6')
                self.agent_count_label = ui.label('Active Agents: 0')
                self.message_count_label = ui.label('Messages: 0')
                self.error_count_label = ui.label('Errors: 0')
    
    def _create_control_panel(self):
        """Create demo control panel"""
        with ui.column().classes('gap-4'):
            # Simulation Controls
            with ui.row().classes('gap-4'):
                self.start_button = ui.button('Start Simulation', 
                    on_click=self.start_simulation).props('color=green')
                self.stop_button = ui.button('Stop Simulation', 
                    on_click=self.stop_simulation).props('color=red disabled')
            
            # Message Controls
            ui.label('Message Generation').classes('text-h6 mt-4')
            with ui.row().classes('gap-4'):
                ui.button('Send Test Message', on_click=self.send_test_message)
                ui.button('Trigger Network Update', on_click=self.trigger_network_update)
                ui.button('Update System Status', on_click=self.update_system_status)
            
            # Error Simulation
            ui.label('Error Simulation').classes('text-h6 mt-4')
            with ui.row().classes('gap-4'):
                ui.button('Simulate Warning', 
                    on_click=lambda: self.simulate_health_status('warning'))
                ui.button('Simulate Error', 
                    on_click=lambda: self.simulate_health_status('error'))
                ui.button('Clear Errors', 
                    on_click=lambda: self.simulate_health_status('healthy'))
            
            # Configuration
            ui.label('Configuration').classes('text-h6 mt-4')
            self.message_rate_slider = ui.slider(
                min=0.1, max=5.0, value=1.0, step=0.1
            ).props('label').classes('w-64')
            ui.label('Message Rate (seconds)')
    
    async def start_simulation(self):
        """Start the simulation"""
        self.running = True
        self.start_button.props('disabled')
        self.stop_button.props('disabled=false')
        
        ui.notify('Simulation started', type='positive')
        
        # Start background tasks
        asyncio.create_task(self.generate_messages())
        asyncio.create_task(self.monitor_system())
    
    def stop_simulation(self):
        """Stop the simulation"""
        self.running = False
        self.start_button.props('disabled=false')
        self.stop_button.props('disabled')
        
        ui.notify('Simulation stopped', type='info')
    
    async def generate_messages(self):
        """Generate random agent messages"""
        messages = [
            "I believe consciousness emerges from complex neural patterns.",
            "What about the binding problem? How do separate processes unite?",
            "Consider the global workspace theory as a framework.",
            "The hard problem remains unsolved in my view.",
            "Perhaps we need new mathematical tools to understand this.",
            "Integrated information theory offers interesting insights.",
            "The phenomenological approach has merit here.",
            "We should consider quantum effects in microtubules.",
            "That seems speculative without more evidence.",
            "Let's focus on empirically testable hypotheses."
        ]
        
        while self.running:
            # Random agent sends a message
            agent_id = random.choice(list(self.agents.keys()))
            agent_info = self.agents[agent_id]
            message = random.choice(messages)
            
            # Simulate sentiment
            sentiment_score = random.uniform(-1, 1)
            if sentiment_score > 0.3:
                sentiment_label = 'positive'
            elif sentiment_score < -0.3:
                sentiment_label = 'negative'
            else:
                sentiment_label = 'neutral'
            
            # Broadcast the message
            broadcast_agent_message(
                agent_id=agent_id,
                agent_type=agent_info['name'],
                message=message,
                sentiment_data={
                    'score': sentiment_score,
                    'label': sentiment_label
                },
                metadata={
                    'interaction_count': self.message_count,
                    'timestamp': time.time()
                }
            )
            
            # Update UI
            self.message_count += 1
            self.add_message_to_ui(agent_id, agent_info, message, sentiment_label)
            
            # Wait based on rate slider
            await asyncio.sleep(self.message_rate_slider.value)
    
    async def monitor_system(self):
        """Monitor system performance"""
        while self.running:
            metrics = self.performance_monitor.get_current_metrics()
            
            # Determine health status
            cpu = metrics['cpu_percent']
            memory = metrics['memory_percent']
            
            if cpu > 80 or memory > 80:
                health_status = SystemHealthStatus.ERROR
            elif cpu > 60 or memory > 60:
                health_status = SystemHealthStatus.WARNING
            else:
                health_status = SystemHealthStatus.HEALTHY
            
            # Broadcast system status
            broadcast_system_status(
                health_status=health_status,
                performance_metrics=metrics,
                active_agents=len(self.agents),
                error_count=self.error_count
            )
            
            # Update UI
            self.update_status_ui(health_status, metrics)
            
            # Wait 5 seconds between updates
            await asyncio.sleep(5)
    
    def add_message_to_ui(self, agent_id, agent_info, message, sentiment):
        """Add a message to the UI"""
        with self.message_container:
            with ui.card().classes('mb-2 p-3'):
                with ui.row().classes('items-center gap-2'):
                    ui.badge(agent_info['name'][0], 
                        color='white', 
                        text_color=agent_info['color']).props('rounded')
                    ui.label(agent_info['name']).classes('font-bold')
                    ui.label(f'({sentiment})').classes('text-sm text-gray-500')
                ui.label(message).classes('mt-2')
                ui.label(datetime.now().strftime('%H:%M:%S')).classes('text-xs text-gray-400')
    
    def update_status_ui(self, health_status, metrics):
        """Update status UI elements"""
        # Update health badge
        if health_status == SystemHealthStatus.HEALTHY:
            self.health_badge.set_text('Healthy')
            self.health_badge.props('color=green')
        elif health_status == SystemHealthStatus.WARNING:
            self.health_badge.set_text('Warning')
            self.health_badge.props('color=orange')
        else:
            self.health_badge.set_text('Error')
            self.health_badge.props('color=red')
        
        # Update metrics
        self.cpu_label.set_text(f"CPU: {metrics['cpu_percent']:.1f}%")
        self.memory_label.set_text(f"Memory: {metrics['memory_percent']:.1f}%")
        self.agent_count_label.set_text(f"Active Agents: {len(self.agents)}")
        self.message_count_label.set_text(f"Messages: {self.message_count}")
        self.error_count_label.set_text(f"Errors: {self.error_count}")
    
    def send_test_message(self):
        """Send a test message"""
        agent_id = 'agent_1'
        agent_info = self.agents[agent_id]
        message = "This is a test message from the demo interface."
        
        broadcast_agent_message(
            agent_id=agent_id,
            agent_type=agent_info['name'],
            message=message,
            sentiment_data={'score': 0.5, 'label': 'neutral'},
            metadata={'test': True}
        )
        
        self.add_message_to_ui(agent_id, agent_info, message, 'neutral')
        ui.notify('Test message sent', type='positive')
    
    def trigger_network_update(self):
        """Trigger a network update event"""
        connections = [
            {
                'from': 'agent_1',
                'to': 'agent_2',
                'strength': random.random(),
                'is_active': True,
                'type': 'normal'
            }
            for _ in range(3)
        ]
        
        broadcast_network_update(
            connections=connections,
            communication_stats={
                agent_id: {
                    'sent': random.randint(0, 100),
                    'received': random.randint(0, 100)
                }
                for agent_id in self.agents.keys()
            },
            event_type='demo_update'
        )
        
        ui.notify('Network update triggered', type='info')
    
    def update_system_status(self):
        """Update system status"""
        metrics = self.performance_monitor.get_current_metrics()
        
        broadcast_system_status(
            health_status=SystemHealthStatus.HEALTHY,
            performance_metrics=metrics,
            active_agents=len(self.agents),
            error_count=self.error_count
        )
        
        ui.notify('System status updated', type='info')
    
    def simulate_health_status(self, status):
        """Simulate different health statuses"""
        if status == 'warning':
            health = SystemHealthStatus.WARNING
            self.error_count = 5
        elif status == 'error':
            health = SystemHealthStatus.ERROR
            self.error_count = 10
        else:
            health = SystemHealthStatus.HEALTHY
            self.error_count = 0
        
        metrics = self.performance_monitor.get_current_metrics()
        
        broadcast_system_status(
            health_status=health,
            performance_metrics=metrics,
            active_agents=len(self.agents),
            error_count=self.error_count
        )
        
        self.update_status_ui(health, metrics)
        ui.notify(f'Health status set to {status}', type='info')


# Main application
def main():
    """Run the demo application"""
    demo = WebSocketDemo()
    
    @ui.page('/')
    async def index():
        demo.create_ui()
    
    # Initialize WebSocket broadcaster
    broadcaster = WebSocketBroadcaster(ui.app)
    
    ui.run(
        title='WebSocket Event System Demo',
        favicon='🌐',
        dark=True,
        reload=False
    )


if __name__ == '__main__':
    main()