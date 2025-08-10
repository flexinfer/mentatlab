"""
Specialized UI Components for Psychology Modeling
Advanced psychological analysis and visualization components for the Psyche simulation
"""

import json
import logging
import time
from typing import Dict, List, Any, Optional, Callable, Tuple
from dataclasses import dataclass
from enum import Enum

from nicegui import ui, app
from nicegui.element import Element

logger = logging.getLogger(__name__)


class PsychologicalState(Enum):
    """Psychological states for visualization"""
    INTEGRATED = "integrated"
    CONFLICTED = "conflicted"
    SUPPRESSED = "suppressed"
    DOMINANT = "dominant"
    BALANCED = "balanced"
    EMERGING = "emerging"


class ArchetypeType(Enum):
    """Jungian archetype types"""
    EGO = "ego"
    SHADOW = "shadow"
    PERSONA = "persona"
    ANIMA_ANIMUS = "anima_animus"
    SELF = "self"


@dataclass
class PsychologicalProfile:
    """Comprehensive psychological profile data"""
    archetype: ArchetypeType
    state: PsychologicalState
    energy_level: float  # 0-1
    integration_level: float  # 0-1
    activity_level: float  # 0-1
    dominant_emotions: List[str]
    key_traits: List[str]
    conflict_areas: List[str]
    growth_indicators: List[str]
    timestamp: float = None

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = time.time()


class ArchetypeProfileCard(Element):
    """Sophisticated archetype profile visualization card"""
    
    ARCHETYPE_COLORS = {
        ArchetypeType.EGO: "#4A90E2",
        ArchetypeType.SHADOW: "#8B5A2B", 
        ArchetypeType.PERSONA: "#50E3C2",
        ArchetypeType.ANIMA_ANIMUS: "#F5A623",
        ArchetypeType.SELF: "#7ED321"
    }
    
    STATE_COLORS = {
        PsychologicalState.INTEGRATED: "#7ED321",
        PsychologicalState.CONFLICTED: "#D0021B",
        PsychologicalState.SUPPRESSED: "#9013FE",
        PsychologicalState.DOMINANT: "#FF6900",
        PsychologicalState.BALANCED: "#50E3C2",
        PsychologicalState.EMERGING: "#F5A623"
    }
    
    def __init__(self, profile: PsychologicalProfile, on_click: Optional[Callable] = None):
        super().__init__('div')
        self.profile = profile
        self.on_click = on_click
        
        # Generate unique ID
        self.card_id = f"archetype-card-{id(self)}"
        
        self._create_card()
    
    def _create_card(self):
        """Create the archetype profile card"""
        archetype_color = self.ARCHETYPE_COLORS[self.profile.archetype]
        state_color = self.STATE_COLORS[self.profile.state]
        
        # Main card container
        with self.classes('relative bg-white rounded-lg shadow-lg p-6 border-l-4 hover:shadow-xl transition-shadow cursor-pointer').style(f'border-left-color: {archetype_color}'):
            if self.on_click:
                self.on('click', self.on_click)
            
            # Header with archetype name and state
            with ui.row().classes('w-full items-center justify-between mb-4'):
                with ui.column():
                    ui.label(self.profile.archetype.value.replace('_', ' ').title()).classes('text-xl font-bold').style(f'color: {archetype_color}')
                    ui.badge(self.profile.state.value.title()).style(f'background-color: {state_color}')
                
                # Status indicator
                with ui.column().classes('items-end'):
                    self._create_energy_indicator()
            
            # Main metrics row
            with ui.row().classes('w-full gap-4 mb-4'):
                self._create_metric_gauge("Integration", self.profile.integration_level, "#7ED321")
                self._create_metric_gauge("Activity", self.profile.activity_level, "#4A90E2")
                self._create_metric_gauge("Energy", self.profile.energy_level, "#F5A623")
            
            # Psychological details
            with ui.expansion('Psychological Profile', icon='psychology').classes('w-full'):
                self._create_detailed_profile()
    
    def _create_energy_indicator(self):
        """Create energy level indicator"""
        energy_percentage = int(self.profile.energy_level * 100)
        
        # Energy level circle
        with ui.element('div').classes('relative w-16 h-16'):
            # Background circle
            ui.element('div').classes('absolute inset-0 rounded-full border-4 border-gray-200')
            
            # Energy level arc (simplified as a colored circle for demo)
            energy_color = self._get_energy_color(self.profile.energy_level)
            ui.element('div').classes('absolute inset-1 rounded-full').style(f'background-color: {energy_color}; opacity: {self.profile.energy_level}')
            
            # Percentage text
            ui.label(f'{energy_percentage}%').classes('absolute inset-0 flex items-center justify-center text-xs font-bold')
    
    def _create_metric_gauge(self, label: str, value: float, color: str):
        """Create a metric gauge"""
        percentage = int(value * 100)
        
        with ui.column().classes('items-center'):
            ui.label(label).classes('text-sm font-medium text-gray-600')
            
            # Gauge background
            with ui.element('div').classes('relative w-12 h-12 rounded-full border-4 border-gray-200'):
                # Gauge fill (simplified)
                ui.element('div').classes('absolute inset-1 rounded-full').style(f'background-color: {color}; opacity: {value}')
                ui.label(f'{percentage}').classes('absolute inset-0 flex items-center justify-center text-xs font-bold')
    
    def _create_detailed_profile(self):
        """Create detailed psychological profile section"""
        with ui.column().classes('gap-4 p-4'):
            # Dominant emotions
            if self.profile.dominant_emotions:
                ui.label('Dominant Emotions').classes('font-semibold text-gray-700')
                with ui.row().classes('gap-2 flex-wrap'):
                    for emotion in self.profile.dominant_emotions:
                        ui.chip(emotion, color='primary').props('outline')
            
            # Key traits
            if self.profile.key_traits:
                ui.label('Key Traits').classes('font-semibold text-gray-700 mt-2')
                with ui.row().classes('gap-2 flex-wrap'):
                    for trait in self.profile.key_traits:
                        ui.chip(trait, color='positive').props('outline')
            
            # Conflict areas
            if self.profile.conflict_areas:
                ui.label('Conflict Areas').classes('font-semibold text-gray-700 mt-2')
                with ui.row().classes('gap-2 flex-wrap'):
                    for conflict in self.profile.conflict_areas:
                        ui.chip(conflict, color='negative').props('outline')
            
            # Growth indicators
            if self.profile.growth_indicators:
                ui.label('Growth Indicators').classes('font-semibold text-gray-700 mt-2')
                with ui.row().classes('gap-2 flex-wrap'):
                    for indicator in self.profile.growth_indicators:
                        ui.chip(indicator, color='accent').props('outline')
    
    def _get_energy_color(self, energy_level: float) -> str:
        """Get color based on energy level"""
        if energy_level > 0.8:
            return "#7ED321"  # High energy - green
        elif energy_level > 0.6:
            return "#F5A623"  # Medium energy - orange
        elif energy_level > 0.4:
            return "#50E3C2"  # Low-medium energy - teal
        else:
            return "#D0021B"  # Low energy - red
    
    def update_profile(self, new_profile: PsychologicalProfile):
        """Update the profile card with new data"""
        self.profile = new_profile
        # Note: In a real implementation, this would update the UI elements
        # For NiceGUI, we might need to recreate the card or use reactive data binding


class PsychodynamicChart(Element):
    """Interactive psychodynamic relationship chart"""
    
    def __init__(self, width: str = "100%", height: str = "400px"):
        super().__init__('div')
        self.width = width
        self.height = height
        self.chart_id = f"psychodynamic-chart-{id(self)}"
        
        self.relationships = []
        self.archetypes = {}
        
        self._setup_chart()
    
    def _setup_chart(self):
        """Set up the psychodynamic chart"""
        self.style(f'width: {self.width}; height: {self.height}; position: relative; border: 1px solid #e0e0e0; border-radius: 8px;')
        
        # Create chart container
        with self:
            ui.label('Psychodynamic Relationships').classes('absolute top-2 left-2 text-lg font-bold z-10')
            
            # Chart area
            chart_container = ui.element('div').props(f'id="{self.chart_id}"').classes('w-full h-full')
            
            # Initialize with D3.js or similar (simplified here)
            self._initialize_chart()
    
    def _initialize_chart(self):
        """Initialize the interactive chart"""
        # This would normally use D3.js or similar for interactive psychodynamic visualization
        js_code = f"""
        // Initialize psychodynamic chart for {self.chart_id}
        const container = document.getElementById('{self.chart_id}');
        if (container) {{
            // Create SVG or Canvas for psychodynamic visualization
            console.log('Psychodynamic chart initialized for {self.chart_id}');
            
            // This would implement sophisticated psychological relationship visualization
            // showing connections, tensions, and dynamics between archetypes
        }}
        """
        ui.run_javascript(js_code)
    
    def add_relationship(self, from_archetype: ArchetypeType, to_archetype: ArchetypeType, 
                        relationship_type: str, strength: float, description: str = ""):
        """Add a psychodynamic relationship"""
        relationship = {
            'from': from_archetype.value,
            'to': to_archetype.value,
            'type': relationship_type,
            'strength': strength,
            'description': description,
            'timestamp': time.time()
        }
        self.relationships.append(relationship)
        self._update_chart()
    
    def _update_chart(self):
        """Update the chart with current relationships"""
        # This would update the D3.js visualization
        relationships_json = json.dumps(self.relationships)
        js_code = f"""
        // Update psychodynamic relationships
        const relationships = {relationships_json};
        console.log('Updating psychodynamic chart with', relationships.length, 'relationships');
        """
        ui.run_javascript(js_code)


class SentimentEvolutionTimeline(Element):
    """Timeline visualization for sentiment evolution"""
    
    def __init__(self, width: str = "100%", height: str = "300px"):
        super().__init__('div')
        self.width = width
        self.height = height
        self.timeline_id = f"sentiment-timeline-{id(self)}"
        
        self.sentiment_data = []
        self._setup_timeline()
    
    def _setup_timeline(self):
        """Set up the sentiment timeline"""
        self.style(f'width: {self.width}; height: {self.height}; border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px;')
        
        with self:
            # Header
            with ui.row().classes('w-full items-center justify-between mb-4'):
                ui.label('Sentiment Evolution Timeline').classes('text-lg font-bold')
                
                # Time range selector
                self.time_range = ui.select(
                    options={
                        '1h': 'Last Hour',
                        '6h': 'Last 6 Hours', 
                        '24h': 'Last 24 Hours',
                        '7d': 'Last Week'
                    },
                    value='1h',
                    label='Time Range'
                ).on('change', self._update_timeline)
            
            # Timeline container
            timeline_container = ui.element('div').props(f'id="{self.timeline_id}"').classes('w-full flex-1')
            
            self._initialize_timeline()
    
    def _initialize_timeline(self):
        """Initialize the timeline visualization"""
        js_code = f"""
        // Initialize sentiment timeline for {self.timeline_id}
        const container = document.getElementById('{self.timeline_id}');
        if (container) {{
            console.log('Sentiment timeline initialized for {self.timeline_id}');
            // This would implement Timeline.js or similar for sentiment visualization
        }}
        """
        ui.run_javascript(js_code)
    
    def add_sentiment_point(self, archetype: ArchetypeType, sentiment_score: float, 
                          emotion: str, context: str = "", timestamp: float = None):
        """Add a sentiment data point"""
        if timestamp is None:
            timestamp = time.time()
        
        sentiment_point = {
            'archetype': archetype.value,
            'sentiment_score': sentiment_score,
            'emotion': emotion,
            'context': context,
            'timestamp': timestamp,
            'color': self._get_sentiment_color(sentiment_score)
        }
        
        self.sentiment_data.append(sentiment_point)
        self._update_timeline()
    
    def _get_sentiment_color(self, sentiment_score: float) -> str:
        """Get color based on sentiment score"""
        if sentiment_score > 0.3:
            return "#7ED321"  # Positive - green
        elif sentiment_score > -0.3:
            return "#F5A623"  # Neutral - orange
        else:
            return "#D0021B"  # Negative - red
    
    def _update_timeline(self):
        """Update the timeline with current data"""
        # Filter data based on selected time range
        time_range = self.time_range.value if hasattr(self, 'time_range') else '1h'
        current_time = time.time()
        
        range_seconds = {
            '1h': 3600,
            '6h': 21600,
            '24h': 86400,
            '7d': 604800
        }.get(time_range, 3600)
        
        filtered_data = [
            point for point in self.sentiment_data
            if current_time - point['timestamp'] <= range_seconds
        ]
        
        data_json = json.dumps(filtered_data)
        js_code = f"""
        // Update sentiment timeline
        const timelineData = {data_json};
        console.log('Updating sentiment timeline with', timelineData.length, 'points');
        """
        ui.run_javascript(js_code)


class PsychologicalInsightsPanel(Element):
    """Panel displaying psychological insights and interpretations"""
    
    def __init__(self):
        super().__init__('div')
        self.insights = []
        self.current_analysis = {}
        
        self._create_panel()
    
    def _create_panel(self):
        """Create the insights panel"""
        self.classes('bg-white rounded-lg shadow-lg p-6')
        
        with self:
            # Header
            with ui.row().classes('w-full items-center justify-between mb-4'):
                ui.label('Psychological Insights').classes('text-xl font-bold')
                
                with ui.row().classes('gap-2'):
                    ui.button('Refresh', on_click=self._refresh_insights).props('outline size=sm')
                    
                    # Add export button for insights
                    try:
                        from ui.export_components import ExportButton, ExportFormat
                        ExportButton(
                            ui.context.slot,
                            label="Export",
                            icon="download",
                            default_format=ExportFormat.JSON,
                            default_data_types=["analytics"],
                            quick_export=False
                        )
                    except ImportError:
                        pass
            
            # Insights container
            self.insights_container = ui.column().classes('w-full gap-4')
            
            # Load initial insights
            self._load_insights()
    
    def _create_panel(self):
        """Create the insights panel"""
        self.classes('bg-white rounded-lg shadow-lg p-6')
        
        with self:
            # Header
            with ui.row().classes('w-full items-center justify-between mb-4'):
                ui.label('Psychological Insights').classes('text-xl font-bold')
                ui.button('Refresh', on_click=self._refresh_insights).props('outline size=sm')
            
            # Insights container
            self.insights_container = ui.column().classes('w-full gap-4')
            
            # Load initial insights
            self._load_insights()
    
    def _load_insights(self):
        """Load and display psychological insights"""
        # Sample insights - in real implementation, this would come from analysis
        sample_insights = [
            {
                'type': 'integration',
                'title': 'Shadow Integration Progress',
                'content': 'The Shadow archetype shows increased integration with the Ego, indicating healthy psychological development.',
                'confidence': 0.85,
                'timestamp': time.time() - 300
            },
            {
                'type': 'conflict',
                'title': 'Persona-Self Tension',
                'content': 'Detected tension between Persona and Self archetypes suggests potential authenticity conflicts.',
                'confidence': 0.72,
                'timestamp': time.time() - 150
            },
            {
                'type': 'growth',
                'title': 'Anima/Animus Emergence',
                'content': 'The Anima/Animus shows increased activity, indicating development of complementary psychological aspects.',
                'confidence': 0.91,
                'timestamp': time.time() - 60
            }
        ]
        
        with self.insights_container:
            for insight in sample_insights:
                self._create_insight_card(insight)
    
    def _create_insight_card(self, insight: Dict[str, Any]):
        """Create an individual insight card"""
        # Determine colors based on insight type
        type_colors = {
            'integration': '#7ED321',
            'conflict': '#D0021B', 
            'growth': '#4A90E2',
            'warning': '#F5A623'
        }
        
        color = type_colors.get(insight['type'], '#50E3C2')
        confidence_percentage = int(insight['confidence'] * 100)
        
        with ui.card().classes('w-full border-l-4').style(f'border-left-color: {color}'):
            with ui.card_section():
                # Header with title and confidence
                with ui.row().classes('w-full items-center justify-between'):
                    ui.label(insight['title']).classes('text-lg font-semibold')
                    ui.badge(f'{confidence_percentage}% confidence').style(f'background-color: {color}')
                
                # Insight content
                ui.label(insight['content']).classes('text-gray-700 mt-2')
                
                # Timestamp
                time_ago = int(time.time() - insight['timestamp'])
                ui.label(f'{time_ago} seconds ago').classes('text-xs text-gray-500 mt-2')
    
    def _refresh_insights(self):
        """Refresh the insights display"""
        # In real implementation, this would trigger new analysis
        self.insights_container.clear()
        self._load_insights()
        ui.notify('Insights refreshed', type='positive')
    
    def add_insight(self, insight_type: str, title: str, content: str, confidence: float):
        """Add a new psychological insight"""
        insight = {
            'type': insight_type,
            'title': title,
            'content': content,
            'confidence': confidence,
            'timestamp': time.time()
        }
        
        self.insights.append(insight)
        
        # Add to UI
        with self.insights_container:
            self._create_insight_card(insight)


class PsychologyDashboard:
    """Complete psychology-focused dashboard"""
    
    def __init__(self):
        self.profile_cards = {}
        self.psychodynamic_chart = None
        self.sentiment_timeline = None
        self.insights_panel = None
        
        # Sample data
        self.sample_profiles = self._create_sample_profiles()
    
    def _create_sample_profiles(self) -> Dict[ArchetypeType, PsychologicalProfile]:
        """Create sample psychological profiles"""
        return {
            ArchetypeType.EGO: PsychologicalProfile(
                archetype=ArchetypeType.EGO,
                state=PsychologicalState.DOMINANT,
                energy_level=0.8,
                integration_level=0.7,
                activity_level=0.9,
                dominant_emotions=['confident', 'focused', 'determined'],
                key_traits=['leadership', 'decision-making', 'self-awareness'],
                conflict_areas=['perfectionism', 'control'],
                growth_indicators=['increased empathy', 'better delegation']
            ),
            ArchetypeType.SHADOW: PsychologicalProfile(
                archetype=ArchetypeType.SHADOW,
                state=PsychologicalState.EMERGING,
                energy_level=0.6,
                integration_level=0.4,
                activity_level=0.5,
                dominant_emotions=['anger', 'fear', 'envy'],
                key_traits=['honesty', 'authenticity', 'raw truth'],
                conflict_areas=['suppression', 'denial'],
                growth_indicators=['conscious recognition', 'integration attempts']
            ),
            ArchetypeType.PERSONA: PsychologicalProfile(
                archetype=ArchetypeType.PERSONA,
                state=PsychologicalState.BALANCED,
                energy_level=0.75,
                integration_level=0.8,
                activity_level=0.7,
                dominant_emotions=['pleasant', 'accommodating', 'diplomatic'],
                key_traits=['social skills', 'adaptability', 'charm'],
                conflict_areas=['authenticity', 'over-adaptation'],
                growth_indicators=['authentic expression', 'boundary setting']
            ),
            ArchetypeType.ANIMA_ANIMUS: PsychologicalProfile(
                archetype=ArchetypeType.ANIMA_ANIMUS,
                state=PsychologicalState.INTEGRATED,
                energy_level=0.85,
                integration_level=0.9,
                activity_level=0.6,
                dominant_emotions=['intuitive', 'creative', 'empathetic'],
                key_traits=['creativity', 'intuition', 'emotional intelligence'],
                conflict_areas=['rationality conflicts'],
                growth_indicators=['creative expression', 'emotional balance']
            ),
            ArchetypeType.SELF: PsychologicalProfile(
                archetype=ArchetypeType.SELF,
                state=PsychologicalState.INTEGRATED,
                energy_level=0.9,
                integration_level=0.95,
                activity_level=0.8,
                dominant_emotions=['peaceful', 'wise', 'centered'],
                key_traits=['wisdom', 'integration', 'wholeness'],
                conflict_areas=['accessibility'],
                growth_indicators=['increased presence', 'guiding influence']
            )
        }
    
    def create_dashboard(self) -> ui.column:
        """Create the complete psychology dashboard"""
        with ui.column().classes('w-full p-4 gap-6') as dashboard:
            # Header
            with ui.row().classes('w-full items-center justify-between'):
                ui.label('Psychological Analysis Dashboard').classes('text-3xl font-bold')
                
                with ui.row().classes('gap-2'):
                    ui.button('Generate Report', on_click=self._generate_report).props('color=primary')
                    ui.button('Export Data', on_click=self._export_data).props('outline')
                    
                    # Add quick export buttons
                    try:
                        from analysis.analytics_export_integration import add_analytics_export_buttons
                        add_analytics_export_buttons(ui.context.slot)
                    except ImportError:
                        pass
            
            # Archetype profile cards
            with ui.expansion('Archetype Profiles', icon='psychology').classes('w-full').props('default-opened'):
                with ui.row().classes('w-full gap-4 flex-wrap'):
                    for archetype, profile in self.sample_profiles.items():
                        self.profile_cards[archetype] = ArchetypeProfileCard(
                            profile=profile,
                            on_click=lambda p=profile: self._on_profile_click(p)
                        )
            
            # Psychodynamic relationships and timeline
            with ui.row().classes('w-full gap-4'):
                # Psychodynamic chart
                with ui.column().classes('flex-1'):
                    with ui.expansion('Psychodynamic Relationships', icon='hub').classes('w-full').props('default-opened'):
                        self.psychodynamic_chart = PsychodynamicChart()
                        self._populate_relationships()
                
                # Sentiment timeline
                with ui.column().classes('flex-1'):
                    with ui.expansion('Sentiment Evolution', icon='timeline').classes('w-full').props('default-opened'):
                        self.sentiment_timeline = SentimentEvolutionTimeline()
                        self._populate_sentiment_data()
            
            # Psychological insights
            with ui.expansion('Psychological Insights', icon='lightbulb').classes('w-full').props('default-opened'):
                self.insights_panel = PsychologicalInsightsPanel()
        
        return dashboard
    
    def _populate_relationships(self):
        """Populate sample psychodynamic relationships"""
        if self.psychodynamic_chart:
            relationships = [
                (ArchetypeType.EGO, ArchetypeType.SHADOW, "tension", 0.7),
                (ArchetypeType.PERSONA, ArchetypeType.SHADOW, "conflict", 0.5),
                (ArchetypeType.ANIMA_ANIMUS, ArchetypeType.SELF, "integration", 0.9),
                (ArchetypeType.EGO, ArchetypeType.SELF, "guidance", 0.6),
                (ArchetypeType.PERSONA, ArchetypeType.EGO, "alignment", 0.8)
            ]
            
            for from_arch, to_arch, rel_type, strength in relationships:
                self.psychodynamic_chart.add_relationship(from_arch, to_arch, rel_type, strength)
    
    def _populate_sentiment_data(self):
        """Populate sample sentiment timeline data"""
        if self.sentiment_timeline:
            import random
            current_time = time.time()
            
            # Generate sample data points over the last hour
            for i in range(20):
                timestamp = current_time - (3600 - i * 180)  # Every 3 minutes
                for archetype in ArchetypeType:
                    sentiment_score = random.uniform(-1, 1)
                    emotion = random.choice(['joy', 'anger', 'fear', 'sadness', 'surprise', 'calm'])
                    
                    self.sentiment_timeline.add_sentiment_point(
                        archetype, sentiment_score, emotion, 
                        f"Context for {archetype.value}", timestamp
                    )
    
    def _on_profile_click(self, profile: PsychologicalProfile):
        """Handle profile card click"""
        ui.notify(f'Selected {profile.archetype.value} archetype', type='info')
        
        # In a real implementation, this could open detailed analysis
        # or update other dashboard components
    
    def _generate_report(self):
        """Generate psychological analysis report"""
        ui.notify('Generating comprehensive psychological report...', type='positive')
        # In real implementation, this would compile all data into a report
    
    def _export_data(self):
        """Export psychological data"""
        try:
            from ui.export_components import ExportDialog, ExportFormat
            dialog = ExportDialog()
            # Pre-configure for psychology data
            dialog.selected_data_types = ["analytics", "conversations", "performance"]
            dialog.selected_format = ExportFormat.JSON
            dialog.show()
        except ImportError:
            ui.notify('Export functionality not available', type='warning')
        except Exception as e:
            ui.notify(f'Export error: {str(e)}', type='negative')


# Example usage and testing
def create_psychology_dashboard_demo():
    """Create a demo of the psychology dashboard"""
    dashboard = PsychologyDashboard()
    return dashboard.create_dashboard()


if __name__ == "__main__":
    # Create demo page
    ui.page_title("Psychology Modeling Dashboard")
    
    create_psychology_dashboard_demo()
    
    ui.run(
        title='Psychology Modeling Components Demo',
        favicon='🧠',
        dark=False,
        port=8081
    )