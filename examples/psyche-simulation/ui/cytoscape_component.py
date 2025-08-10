"""
NiceGUI Cytoscape.js Integration Component
Provides seamless integration of Cytoscape.js network visualization with NiceGUI
"""

import json
import logging
from typing import Dict, Any, Optional, Callable
from nicegui import ui, app
from nicegui.element import Element

logger = logging.getLogger(__name__)


class CytoscapeNetworkComponent(Element):
    """NiceGUI component for Cytoscape.js network visualization"""
    
    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        height: str = "500px",
        width: str = "100%",
        on_node_click: Optional[Callable] = None,
        on_edge_click: Optional[Callable] = None,
        on_selection_change: Optional[Callable] = None
    ):
        """
        Initialize Cytoscape network component
        
        Args:
            config: Cytoscape.js configuration dictionary
            height: Component height (CSS format)
            width: Component width (CSS format)
            on_node_click: Callback for node click events
            on_edge_click: Callback for edge click events
            on_selection_change: Callback for selection change events
        """
        super().__init__('div')
        
        self.config = config or {}
        self.height = height
        self.width = width
        self.on_node_click = on_node_click
        self.on_edge_click = on_edge_click
        self.on_selection_change = on_selection_change
        
        # Generate unique ID for this component
        self.network_id = f"cytoscape-{id(self)}"
        
        # Set up the container
        self._props['id'] = self.network_id
        self.style(f'height: {height}; width: {width}; border: 1px solid #ccc;')
        
        # Initialize Cytoscape when component is ready
        self.on('vue:mounted', self._initialize_cytoscape)

    def _initialize_cytoscape(self, *args):
        """Initialize Cytoscape.js visualization"""
        try:
            # Prepare configuration
            config = dict(self.config)
            config['container'] = f'#{self.network_id}'
            
            # JavaScript code to initialize Cytoscape
            js_code = f"""
            // Load Cytoscape.js library if not already loaded
            if (typeof cytoscape === 'undefined') {{
                const script = document.createElement('script');
                script.src = 'https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js';
                script.onload = function() {{
                    initializeCytoscape_{self.network_id.replace('-', '_')}();
                }};
                document.head.appendChild(script);
            }} else {{
                initializeCytoscape_{self.network_id.replace('-', '_')}();
            }}
            
            function initializeCytoscape_{self.network_id.replace('-', '_')}() {{
                const config = {json.dumps(config)};
                
                // Initialize Cytoscape
                window.cy_{self.network_id.replace('-', '_')} = cytoscape(config);
                
                const cy = window.cy_{self.network_id.replace('-', '_')};
                
                // Fit the graph to the container
                cy.fit();
                
                console.log('Cytoscape network initialized:', '{self.network_id}');
            }}
            """
            
            ui.run_javascript(js_code)
            
        except Exception as e:
            logger.error(f"Error initializing Cytoscape component: {e}")

    def update_network(self, config: Dict[str, Any]):
        """Update the network with new configuration"""
        try:
            self.config = config
            
            js_code = f"""
            if (window.cy_{self.network_id.replace('-', '_')}) {{
                const cy = window.cy_{self.network_id.replace('-', '_')};
                const newElements = {json.dumps(config.get('elements', []))};
                
                // Update elements
                cy.elements().remove();
                cy.add(newElements);
                
                // Apply layout if specified
                const layout = {json.dumps(config.get('layout', {'name': 'cose'}))};
                cy.layout(layout).run();
                
                // Fit to container
                cy.fit();
                
                console.log('Network updated with', newElements.length, 'elements');
            }}
            """
            
            ui.run_javascript(js_code)
            
        except Exception as e:
            logger.error(f"Error updating network: {e}")

    def apply_layout(self, layout_config: Dict[str, Any]):
        """Apply a new layout to the network"""
        try:
            js_code = f"""
            if (window.cy_{self.network_id.replace('-', '_')}) {{
                const cy = window.cy_{self.network_id.replace('-', '_')};
                const layout = {json.dumps(layout_config)};
                cy.layout(layout).run();
                console.log('Applied layout:', layout.name);
            }}
            """
            
            ui.run_javascript(js_code)
            
        except Exception as e:
            logger.error(f"Error applying layout: {e}")

    def fit_to_container(self):
        """Fit the network to the container"""
        try:
            js_code = f"""
            if (window.cy_{self.network_id.replace('-', '_')}) {{
                window.cy_{self.network_id.replace('-', '_')}.fit();
            }}
            """
            
            ui.run_javascript(js_code)
            
        except Exception as e:
            logger.error(f"Error fitting to container: {e}")


class NetworkDashboard:
    """Complete network dashboard with controls and visualization"""
    
    def __init__(self, visualizer):
        """
        Initialize network dashboard
        
        Args:
            visualizer: AgentNetworkVisualizer instance
        """
        self.visualizer = visualizer
        self.network_component = None
        self.layout_selector = None
        self.node_info_panel = None
        self.edge_info_panel = None
        
    def create_dashboard(self) -> ui.column:
        """Create the complete network dashboard"""
        with ui.column().classes('w-full h-full') as dashboard:
            # Control panel
            with ui.row().classes('w-full items-center gap-4 p-4 bg-gray-100'):
                ui.label('Network Visualization').classes('text-xl font-bold')
                
                # Layout selector
                self.layout_selector = ui.select(
                    options={
                        'cose': 'COSE (Compound Spring Embedder)',
                        'circle': 'Circle',
                        'grid': 'Grid',
                        'breadthfirst': 'Breadth First',
                        'concentric': 'Concentric',
                        'random': 'Random'
                    },
                    value='cose',
                    label='Layout'
                ).on('change', self._on_layout_change)
                
                # Control buttons
                ui.button('Fit to Screen', on_click=self._fit_to_screen).props('outline')
                ui.button('Reset View', on_click=self._reset_view).props('outline')
            
            # Main content area
            with ui.row().classes('w-full flex-1'):
                # Network visualization (main area)
                with ui.column().classes('flex-1'):
                    config = json.loads(self.visualizer.get_cytoscape_config())
                    self.network_component = CytoscapeNetworkComponent(
                        config=config,
                        height="600px"
                    )
                
                # Info panel (sidebar)
                with ui.column().classes('w-80 p-4 bg-gray-50'):
                    ui.label('Network Information').classes('text-lg font-semibold mb-4')
                    
                    # Network statistics
                    with ui.expansion('Network Statistics', icon='analytics').classes('w-full'):
                        self._create_stats_panel()
        
        return dashboard
    
    def _create_stats_panel(self):
        """Create network statistics panel"""
        summary = self.visualizer.get_network_summary()
        stats = summary['statistics']
        
        with ui.column().classes('gap-2'):
            ui.label(f"Nodes: {stats['active_nodes']}/{stats['total_nodes']}").classes('font-mono')
            ui.label(f"Edges: {stats['active_edges']}/{stats['total_edges']}").classes('font-mono')
            ui.label(f"Density: {stats['density']:.3f}").classes('font-mono')
            
            if stats['most_connected']:
                node, degree = stats['most_connected']
                ui.label(f"Most Connected: {node} ({degree})").classes('font-mono')
    
    def _on_layout_change(self, e):
        """Handle layout selector change"""
        layout_name = e.value
        layout_configs = {
            'cose': {
                'name': 'cose',
                'animate': True,
                'animationDuration': 1000,
                'nodeRepulsion': 400000,
                'idealEdgeLength': 100
            },
            'circle': {
                'name': 'circle',
                'animate': True,
                'animationDuration': 1000
            },
            'grid': {
                'name': 'grid',
                'animate': True,
                'animationDuration': 1000
            },
            'breadthfirst': {
                'name': 'breadthfirst',
                'animate': True,
                'animationDuration': 1000,
                'directed': True
            },
            'concentric': {
                'name': 'concentric',
                'animate': True,
                'animationDuration': 1000
            },
            'random': {
                'name': 'random',
                'animate': True,
                'animationDuration': 1000
            }
        }
        
        if self.network_component:
            self.network_component.apply_layout(layout_configs.get(layout_name, {'name': layout_name}))
    
    def _fit_to_screen(self):
        """Fit network to screen"""
        if self.network_component:
            self.network_component.fit_to_container()
    
    def _reset_view(self):
        """Reset network view"""
        if self.network_component:
            config = json.loads(self.visualizer.get_cytoscape_config())
            self.network_component.update_network(config)
    
    def update_network_data(self, communication_matrix: Dict[str, Dict[str, float]]):
        """Update network with new communication data"""
        if self.visualizer and self.network_component:
            self.visualizer.update_from_communication_matrix(communication_matrix)
            config = json.loads(self.visualizer.get_cytoscape_config())
            self.network_component.update_network(config)
            
            # Update statistics panel
            self._update_stats_panel()
    
    def _update_stats_panel(self):
        """Update the statistics panel with current data"""
        # This would update the stats in real-time
        # Implementation would depend on the specific UI framework capabilities
        pass


# Example usage
if __name__ == "__main__":
    from visualization.cytoscape_network import AgentNetworkVisualizer
    
    # Create visualizer
    visualizer = AgentNetworkVisualizer()
    
    # Initialize with sample agents
    sample_agents = {
        "ego": {},
        "shadow": {},
        "persona": {},
        "anima_animus": {},
        "self": {}
    }
    
    visualizer.initialize_agent_network(sample_agents)
    
    # Create dashboard
    dashboard = NetworkDashboard(visualizer)
    
    print("Cytoscape NiceGUI integration component created successfully!")