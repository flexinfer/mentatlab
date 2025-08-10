"""
Cytoscape.js Network Visualization Integration
Enhanced network visualization capabilities for agent interactions
"""

import json
import logging
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from enum import Enum

logger = logging.getLogger(__name__)


class NodeType(Enum):
    """Types of nodes in the network"""
    EGO = "ego"
    SHADOW = "shadow"
    PERSONA = "persona"
    ANIMA_ANIMUS = "anima_animus"
    SELF = "self"


class EdgeType(Enum):
    """Types of edges in the network"""
    COMMUNICATION = "communication"
    EMERGENCY = "emergency"
    INFLUENCE = "influence"


@dataclass
class NodeData:
    """Data structure for network nodes"""
    id: str
    label: str
    type: NodeType
    size: float = 50.0
    color: str = "#666"
    active: bool = True
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


@dataclass
class EdgeData:
    """Data structure for network edges"""
    id: str
    source: str
    target: str
    type: EdgeType
    weight: float = 1.0
    color: str = "rgba(125,125,125,0.5)"
    width: float = 2.0
    active: bool = True
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


class CytoscapeNetworkGenerator:
    """Generates Cytoscape.js compatible network data"""
    
    # Agent colors based on psychological archetypes
    AGENT_COLORS = {
        NodeType.EGO: "#4A90E2",        # Blue - conscious self
        NodeType.SHADOW: "#8B5A2B",     # Dark brown - hidden aspects
        NodeType.PERSONA: "#50E3C2",    # Teal - social mask
        NodeType.ANIMA_ANIMUS: "#F5A623", # Gold - inner opposite
        NodeType.SELF: "#7ED321"        # Green - integrated whole
    }
    
    # Edge colors by type
    EDGE_COLORS = {
        EdgeType.COMMUNICATION: "rgba(125,125,125,0.5)",
        EdgeType.EMERGENCY: "rgba(255,87,51,0.8)",
        EdgeType.INFLUENCE: "rgba(155,89,182,0.6)"
    }
    
    def __init__(self):
        self.nodes: Dict[str, NodeData] = {}
        self.edges: Dict[str, EdgeData] = {}
        
    def add_agent_node(
        self, 
        agent_id: str, 
        agent_type: NodeType, 
        active: bool = True,
        size_multiplier: float = 1.0,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Add an agent node to the network"""
        node = NodeData(
            id=agent_id,
            label=agent_id.replace('_', ' ').title(),
            type=agent_type,
            size=50.0 * size_multiplier,
            color=self.AGENT_COLORS.get(agent_type, "#666"),
            active=active,
            metadata=metadata or {}
        )
        self.nodes[agent_id] = node
        
    def add_communication_edge(
        self,
        from_agent: str,
        to_agent: str,
        weight: float = 1.0,
        edge_type: EdgeType = EdgeType.COMMUNICATION,
        metadata: Optional[Dict[str, Any]] = None
    ):
        """Add a communication edge between agents"""
        edge_id = f"{from_agent}_{to_agent}"
        
        # Adjust width based on weight
        width = max(1.0, min(8.0, weight * 3.0))
        
        edge = EdgeData(
            id=edge_id,
            source=from_agent,
            target=to_agent,
            type=edge_type,
            weight=weight,
            color=self.EDGE_COLORS.get(edge_type, "rgba(125,125,125,0.5)"),
            width=width,
            active=weight > 0,
            metadata=metadata or {}
        )
        self.edges[edge_id] = edge
        
    def update_node_activity(self, agent_id: str, active: bool, size_multiplier: float = 1.0):
        """Update node activity status"""
        if agent_id in self.nodes:
            self.nodes[agent_id].active = active
            self.nodes[agent_id].size = 50.0 * size_multiplier
            
    def update_edge_weight(self, from_agent: str, to_agent: str, weight: float):
        """Update edge weight and appearance"""
        edge_id = f"{from_agent}_{to_agent}"
        if edge_id in self.edges:
            self.edges[edge_id].weight = weight
            self.edges[edge_id].width = max(1.0, min(8.0, weight * 3.0))
            self.edges[edge_id].active = weight > 0
            
    def generate_cytoscape_elements(self) -> List[Dict[str, Any]]:
        """Generate Cytoscape.js elements array"""
        elements = []
        
        # Add nodes
        for node in self.nodes.values():
            element = {
                "data": {
                    "id": node.id,
                    "label": node.label,
                    "type": node.type.value,
                    "active": node.active,
                    **node.metadata
                },
                "style": {
                    "background-color": node.color,
                    "width": node.size,
                    "height": node.size,
                    "opacity": 1.0 if node.active else 0.5
                }
            }
            elements.append(element)
            
        # Add edges
        for edge in self.edges.values():
            if edge.active:
                element = {
                    "data": {
                        "id": edge.id,
                        "source": edge.source,
                        "target": edge.target,
                        "type": edge.type.value,
                        "weight": edge.weight,
                        **edge.metadata
                    },
                    "style": {
                        "line-color": edge.color,
                        "width": edge.width,
                        "opacity": 0.8,
                        "curve-style": "bezier"
                    }
                }
                elements.append(element)
                
        return elements
        
    def generate_cytoscape_config(self, container_id: str = "network-graph") -> Dict[str, Any]:
        """Generate complete Cytoscape.js configuration"""
        return {
            "container": f"#{container_id}",
            "elements": self.generate_cytoscape_elements(),
            "style": self._get_default_styles(),
            "layout": self._get_default_layout(),
            "interaction": {
                "dragSelection": True,
                "boxSelectionEnabled": True,
                "selectionType": "single"
            }
        }
        
    def _get_default_styles(self) -> List[Dict[str, Any]]:
        """Get default Cytoscape.js styles"""
        return [
            {
                "selector": "node",
                "style": {
                    "label": "data(label)",
                    "text-valign": "center",
                    "text-halign": "center",
                    "font-size": "12px",
                    "font-weight": "bold",
                    "color": "#ffffff",
                    "text-outline-color": "#000000",
                    "text-outline-width": "1px",
                    "border-width": "2px",
                    "border-color": "#ffffff",
                    "border-opacity": 0.8
                }
            },
            {
                "selector": "node[type='ego']",
                "style": {
                    "background-color": self.AGENT_COLORS[NodeType.EGO],
                    "border-color": "#2171b5"
                }
            },
            {
                "selector": "node[type='shadow']",
                "style": {
                    "background-color": self.AGENT_COLORS[NodeType.SHADOW], 
                    "border-color": "#654321"
                }
            },
            {
                "selector": "node[type='persona']",
                "style": {
                    "background-color": self.AGENT_COLORS[NodeType.PERSONA],
                    "border-color": "#33a02c"
                }
            },
            {
                "selector": "node[type='anima_animus']",
                "style": {
                    "background-color": self.AGENT_COLORS[NodeType.ANIMA_ANIMUS],
                    "border-color": "#ff7f00"
                }
            },
            {
                "selector": "node[type='self']",
                "style": {
                    "background-color": self.AGENT_COLORS[NodeType.SELF],
                    "border-color": "#6a3d9a"
                }
            },
            {
                "selector": "edge",
                "style": {
                    "curve-style": "bezier",
                    "target-arrow-shape": "triangle",
                    "target-arrow-color": "data(color)",
                    "line-color": "data(color)",
                    "opacity": 0.8
                }
            },
            {
                "selector": "edge[type='emergency']",
                "style": {
                    "line-style": "dashed",
                    "line-color": self.EDGE_COLORS[EdgeType.EMERGENCY],
                    "target-arrow-color": self.EDGE_COLORS[EdgeType.EMERGENCY]
                }
            },
            {
                "selector": "edge[type='influence']",
                "style": {
                    "line-style": "dotted",
                    "line-color": self.EDGE_COLORS[EdgeType.INFLUENCE],
                    "target-arrow-color": self.EDGE_COLORS[EdgeType.INFLUENCE]
                }
            },
            {
                "selector": ":selected",
                "style": {
                    "border-width": "4px",
                    "border-color": "#ffcc00",
                    "z-index": 999
                }
            },
            {
                "selector": "node:active",
                "style": {
                    "overlay-color": "#ffcc00",
                    "overlay-padding": "10px",
                    "overlay-opacity": 0.3
                }
            }
        ]
        
    def _get_default_layout(self) -> Dict[str, Any]:
        """Get default layout configuration"""
        return {
            "name": "cose",
            "animate": True,
            "animationDuration": 1000,
            "nodeRepulsion": 400000,
            "nodeOverlap": 20,
            "idealEdgeLength": 100,
            "edgeElasticity": 200,
            "nestingFactor": 5,
            "gravity": 80,
            "numIter": 1000,
            "initialTemp": 200,
            "coolingFactor": 0.95,
            "minTemp": 1.0
        }
        
    def get_network_stats(self) -> Dict[str, Any]:
        """Get network statistics"""
        active_nodes = sum(1 for node in self.nodes.values() if node.active)
        active_edges = sum(1 for edge in self.edges.values() if edge.active)
        
        # Calculate degree centrality
        node_degrees = {node_id: 0 for node_id in self.nodes.keys()}
        for edge in self.edges.values():
            if edge.active:
                node_degrees[edge.source] += 1
                node_degrees[edge.target] += 1
                
        return {
            "total_nodes": len(self.nodes),
            "active_nodes": active_nodes,
            "total_edges": len(self.edges),
            "active_edges": active_edges,
            "density": active_edges / (active_nodes * (active_nodes - 1)) if active_nodes > 1 else 0,
            "node_degrees": node_degrees,
            "most_connected": max(node_degrees.items(), key=lambda x: x[1]) if node_degrees else None
        }


class AgentNetworkVisualizer:
    """High-level interface for agent network visualization"""
    
    def __init__(self):
        self.generator = CytoscapeNetworkGenerator()
        self._initialized = False
        
    def initialize_agent_network(self, agents: Dict[str, Any]):
        """Initialize the network with agent information"""
        # Map agent names to node types
        agent_type_mapping = {
            "ego": NodeType.EGO,
            "shadow": NodeType.SHADOW,
            "persona": NodeType.PERSONA,
            "anima_animus": NodeType.ANIMA_ANIMUS,
            "anima/animus": NodeType.ANIMA_ANIMUS,
            "self": NodeType.SELF
        }
        
        for agent_name in agents.keys():
            agent_type = agent_type_mapping.get(
                agent_name.lower().replace('_agent', ''), 
                NodeType.EGO
            )
            self.generator.add_agent_node(agent_name, agent_type)
            
        self._initialized = True
        
    def update_from_communication_matrix(self, matrix: Dict[str, Dict[str, float]]):
        """Update network visualization from communication matrix"""
        if not self._initialized:
            return
            
        # Update edges based on communication strength
        for from_agent, targets in matrix.items():
            for to_agent, strength in targets.items():
                if from_agent != to_agent and strength > 0:
                    self.generator.add_communication_edge(
                        from_agent, 
                        to_agent, 
                        weight=strength
                    )
                    
    def update_emergency_communications(self, emergency_paths: List[Tuple[str, str]]):
        """Add emergency communication paths"""
        for from_agent, to_agent in emergency_paths:
            self.generator.add_communication_edge(
                from_agent,
                to_agent,
                weight=1.0,
                edge_type=EdgeType.EMERGENCY,
                metadata={"emergency": True}
            )
            
    def set_agent_activity(self, agent_activities: Dict[str, bool]):
        """Update agent activity status"""
        for agent_name, active in agent_activities.items():
            size_multiplier = 1.5 if active else 0.8
            self.generator.update_node_activity(agent_name, active, size_multiplier)
            
    def get_cytoscape_config(self, container_id: str = "network-graph") -> str:
        """Get Cytoscape.js configuration as JSON string"""
        config = self.generator.generate_cytoscape_config(container_id)
        return json.dumps(config, indent=2)
        
    def get_network_summary(self) -> Dict[str, Any]:
        """Get comprehensive network summary"""
        stats = self.generator.get_network_stats()
        elements = self.generator.generate_cytoscape_elements()
        
        return {
            "statistics": stats,
            "elements_count": len(elements),
            "nodes": [e for e in elements if "source" not in e["data"]],
            "edges": [e for e in elements if "source" in e["data"]],
            "last_updated": json.dumps({"timestamp": "now"})  # Would use actual timestamp
        }


# Example usage and testing
if __name__ == "__main__":
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
    
    # Sample communication matrix
    sample_matrix = {
        "ego": {"shadow": 0.8, "persona": 0.3, "self": 0.5},
        "shadow": {"ego": 0.7, "anima_animus": 0.4},
        "persona": {"ego": 0.2, "shadow": 0.6},
        "anima_animus": {"self": 0.9, "shadow": 0.3},
        "self": {"ego": 0.4, "anima_animus": 0.7}
    }
    
    visualizer.update_from_communication_matrix(sample_matrix)
    
    # Add emergency communications
    emergency_paths = [("shadow", "self"), ("persona", "anima_animus")]
    visualizer.update_emergency_communications(emergency_paths)
    
    # Set activity status
    activities = {"ego": True, "shadow": True, "persona": False, "anima_animus": True, "self": True}
    visualizer.set_agent_activity(activities)
    
    # Generate configuration
    config = visualizer.get_cytoscape_config()
    print("Cytoscape.js Configuration:")
    print(config[:500] + "..." if len(config) > 500 else config)
    
    # Get summary
    summary = visualizer.get_network_summary()
    print(f"\nNetwork Summary: {json.dumps(summary['statistics'], indent=2)}")