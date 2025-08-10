"""
Cytoscape.js Integration Demo
Demonstrates the enhanced network visualization capabilities
"""

import json
import asyncio
import logging
from typing import Dict, Any

from nicegui import ui, app
from visualization.cytoscape_network import AgentNetworkVisualizer, NodeType, EdgeType
from ui.cytoscape_component import NetworkDashboard

logger = logging.getLogger(__name__)


class CytoscapeDemo:
    """Demo application for Cytoscape.js integration"""
    
    def __init__(self):
        self.visualizer = AgentNetworkVisualizer()
        self.dashboard = None
        self.simulation_running = False
        
        # Sample agent data
        self.agents = {
            "ego": {"type": "ego", "active": True},
            "shadow": {"type": "shadow", "active": True},
            "persona": {"type": "persona", "active": True},
            "anima_animus": {"type": "anima_animus", "active": True},
            "self": {"type": "self", "active": True}
        }
        
        # Initialize the network
        self.visualizer.initialize_agent_network(self.agents)
        
    def create_demo_ui(self):
        """Create the demo user interface"""
        
        # Page setup
        ui.page_title("Cytoscape.js Network Visualization Demo")
        
        with ui.column().classes('w-full h-screen p-4'):
            # Header
            with ui.row().classes('w-full items-center justify-between mb-4'):
                ui.label('Psyche Simulation - Enhanced Network Visualization').classes('text-2xl font-bold')
                
                with ui.row().classes('gap-2'):
                    ui.button(
                        'Start Simulation', 
                        on_click=self._start_simulation,
                        color='positive'
                    ).props('outline')
                    
                    ui.button(
                        'Stop Simulation', 
                        on_click=self._stop_simulation,
                        color='negative'
                    ).props('outline')
                    
                    ui.button(
                        'Random Update', 
                        on_click=self._random_update
                    ).props('outline')
            
            # Network Dashboard
            self.dashboard = NetworkDashboard(self.visualizer)
            dashboard_ui = self.dashboard.create_dashboard()
            
            # Demo controls
            with ui.expansion('Demo Controls', icon='settings').classes('w-full mt-4'):
                self._create_demo_controls()
    
    def _create_demo_controls(self):
        """Create demo control panel"""
        with ui.column().classes('gap-4 p-4'):
            ui.label('Communication Matrix Controls').classes('text-lg font-semibold')
            
            # Communication strength sliders
            self.sliders = {}
            communication_pairs = [
                ('ego', 'shadow'),
                ('shadow', 'persona'),
                ('persona', 'anima_animus'),
                ('anima_animus', 'self'),
                ('self', 'ego')
            ]
            
            for from_agent, to_agent in communication_pairs:
                with ui.row().classes('items-center gap-4'):
                    ui.label(f'{from_agent.title()} → {to_agent.replace("_", " ").title()}:').classes('w-40')
                    self.sliders[f'{from_agent}_{to_agent}'] = ui.slider(
                        min=0, max=1, step=0.1, value=0.5
                    ).on('change', self._update_communications).classes('flex-1')
                    ui.label('0.5').classes('w-12 font-mono') # Default value display
            
            ui.separator()
            
            # Agent activity controls
            ui.label('Agent Activity Controls').classes('text-lg font-semibold')
            self.activity_switches = {}
            
            for agent_name in self.agents.keys():
                with ui.row().classes('items-center gap-4'):
                    ui.label(f'{agent_name.replace("_", " ").title()}:').classes('w-40')
                    self.activity_switches[agent_name] = ui.switch(
                        value=True,
                        on_change=self._update_agent_activity
                    )
            
            ui.separator()
            
            # Emergency communication controls
            ui.label('Emergency Communications').classes('text-lg font-semibold')
            
            with ui.row().classes('gap-4'):
                ui.button(
                    'Activate Emergency Protocols',
                    on_click=self._activate_emergency,
                    color='warning'
                ).props('outline')
                
                ui.button(
                    'Clear Emergency Paths',
                    on_click=self._clear_emergency
                ).props('outline')
    
    def _update_communications(self):
        """Update communication matrix from sliders"""
        matrix = {agent: {} for agent in self.agents.keys()}
        
        for slider_key, slider in self.sliders.items():
            from_agent, to_agent = slider_key.split('_', 1)
            if from_agent not in matrix:
                matrix[from_agent] = {}
            matrix[from_agent][to_agent] = slider.value
        
        # Update the visualization
        self.visualizer.update_from_communication_matrix(matrix)
        if self.dashboard and self.dashboard.network_component:
            config = json.loads(self.visualizer.get_cytoscape_config())
            self.dashboard.network_component.update_network(config)
    
    def _update_agent_activity(self):
        """Update agent activity status"""
        activities = {
            agent: switch.value 
            for agent, switch in self.activity_switches.items()
        }
        
        self.visualizer.set_agent_activity(activities)
        if self.dashboard and self.dashboard.network_component:
            config = json.loads(self.visualizer.get_cytoscape_config())
            self.dashboard.network_component.update_network(config)
    
    def _activate_emergency(self):
        """Activate emergency communication protocols"""
        emergency_paths = [
            ('shadow', 'self'),
            ('persona', 'anima_animus'),
            ('ego', 'anima_animus')
        ]
        
        self.visualizer.update_emergency_communications(emergency_paths)
        if self.dashboard and self.dashboard.network_component:
            config = json.loads(self.visualizer.get_cytoscape_config())
            self.dashboard.network_component.update_network(config)
        
        ui.notify('Emergency communication protocols activated!', type='warning')
    
    def _clear_emergency(self):
        """Clear emergency communication paths"""
        # Reset the visualizer (this would normally clear emergency paths)
        self.visualizer = AgentNetworkVisualizer()
        self.visualizer.initialize_agent_network(self.agents)
        self._update_communications()  # Restore normal communications
        
        ui.notify('Emergency paths cleared', type='info')
    
    async def _start_simulation(self):
        """Start simulated network activity"""
        if self.simulation_running:
            return
            
        self.simulation_running = True
        ui.notify('Simulation started - network will update automatically', type='positive')
        
        # Run simulation loop
        asyncio.create_task(self._simulation_loop())
    
    def _stop_simulation(self):
        """Stop simulated network activity"""
        self.simulation_running = False
        ui.notify('Simulation stopped', type='info')
    
    async def _simulation_loop(self):
        """Simulate dynamic network changes"""
        import random
        
        while self.simulation_running:
            try:
                # Randomly update communication strengths
                for slider_key, slider in self.sliders.items():
                    # Small random changes
                    current = slider.value
                    change = random.uniform(-0.1, 0.1)
                    new_value = max(0, min(1, current + change))
                    slider.value = new_value
                
                # Trigger update
                self._update_communications()
                
                # Occasionally toggle agent activity
                if random.random() < 0.1:  # 10% chance
                    agent = random.choice(list(self.agents.keys()))
                    current = self.activity_switches[agent].value
                    self.activity_switches[agent].value = not current
                    self._update_agent_activity()
                
                await asyncio.sleep(2)  # Update every 2 seconds
                
            except Exception as e:
                logger.error(f"Error in simulation loop: {e}")
                break
    
    def _random_update(self):
        """Apply random changes to the network"""
        import random
        
        # Random communication matrix
        matrix = {}
        for from_agent in self.agents.keys():
            matrix[from_agent] = {}
            for to_agent in self.agents.keys():
                if from_agent != to_agent:
                    matrix[from_agent][to_agent] = random.uniform(0, 1)
        
        # Update sliders to match
        for slider_key, slider in self.sliders.items():
            from_agent, to_agent = slider_key.split('_', 1)
            if from_agent in matrix and to_agent in matrix[from_agent]:
                slider.value = matrix[from_agent][to_agent]
        
        # Apply updates
        self.visualizer.update_from_communication_matrix(matrix)
        if self.dashboard and self.dashboard.network_component:
            config = json.loads(self.visualizer.get_cytoscape_config())
            self.dashboard.network_component.update_network(config)
        
        ui.notify('Network updated with random data', type='info')


def create_demo_page():
    """Create the demo page"""
    demo = CytoscapeDemo()
    demo.create_demo_ui()


# Run the demo
if __name__ == "__main__":
    # Set up logging
    logging.basicConfig(level=logging.INFO)
    
    # Create the demo page
    create_demo_page()
    
    # Run the application
    ui.run(
        title='Cytoscape.js Network Visualization Demo',
        favicon='🧠',
        dark=True,
        port=8080,
        reload=True
    )